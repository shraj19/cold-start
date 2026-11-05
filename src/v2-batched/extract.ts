// Phase 1: Batch extraction

import type { Chat, Message, Seed } from "../types/index.js";
import type { BatchPlan, BatchInfo } from "./plan.js";
import type { Phase1Output } from "./schemas.js";
import { phase1OutputSchema } from "./schemas.js";
import { RateLimiter, formatTime } from "./rate-limit.js";
import { generate } from "../llm/index.js";
import { createDeepSeekModel } from "../llm/client.js";

/**
 * Build the extraction prompt for a single batch
 */
function buildBatchPrompt(
  batchId: number,
  chats: Chat[],
  messages: Message[],
  seed: Seed
): string {
  // Format messages with timestamps
  const formattedMessages = messages
    .sort((a, b) => a.ts - b.ts)
    .map(m => {
      const date = new Date(m.ts * 1000).toISOString().split('T')[0];
      return `[${m.id}] ${date} | ${m.chat_id} | ${m.sender_name}: ${m.body}`;
    })
    .join('\n');
  
  // Format chats
  const formattedChats = chats.map(c => {
    const participants = c.participants.filter(p => p !== "ME").join(", ");
    return `- ${c.chat_id}: "${c.name}" (${c.is_group ? 'group' : '1:1'}) - Participants: ${participants || 'ME only'}`;
  }).join('\n');
  
  // Seed circles info
  const knownPeople = Object.entries(seed.circles)
    .map(([id, circle]) => `- ${id}: ${circle}`)
    .join('\n');
  
  const knownOrgs = seed.organisations.length > 0 
    ? seed.organisations.join(', ')
    : 'None specified';
  
  const seedGoals = seed.goals.length > 0
    ? seed.goals.map(g => `- ${g.title} (${g.type}, ${g.area}, ${g.horizon})`).join('\n')
    : 'None specified';

  return `You are extracting structured data from WhatsApp chats. This is batch ${batchId}.

=== CRITICAL RULES ===
- ME is the person whose chats we're analyzing - NEVER include ME in the people array
- NEVER fabricate or invent details - only extract what's explicitly in the messages
- Use seed data as ground truth when available
- loop.title MUST be ≤60 characters (truncate if needed)

=== ORGANISATION IDs ===
- For residence: use "home" (NOT "ghar", "house", etc.)
- For company: use lowercase name like "brightside", "acme"

=== HELP ACTION LOGIC (for OPEN loops) ===
"assist" - Assistant can move it forward WITHOUT user doing the work:
  - Research options (flights, hotels, restaurants), draft messages, find information
  - Example: "Book Coorg tickets" → assist

"remind" - Only the user can do the actual work:
  - Personal decisions, work only user can do (pitch deck, design work)
  - Example: "Halcyon pitch deck due Friday" → remind

"leave" - Stay OUT, do not remind or assist:
  - Someone ELSE (not ME) owns the task
  - Spouse's/colleague's commitments - not assistant's place to nag
  - Example: "Vikram sends invoice" → leave (colleague owns it)

=== OPEN LOOPS ===
Extract ALL tasks/commitments/questions, including COMPLETED ones:
- "open" = still needs action
- "done" = completed (find the closing message)
- "dropped" = abandoned/cancelled

Patterns:
- Questions asked: "What should I make?" → question
- Commitments made: "I'll book it" → commitment  
- Tasks delegated: "Can you pick her up?" → commitment by that person
- Deadlines mentioned: "Due Friday" → deadline

## Known Information (from seed)
### Pre-tagged People: ${knownPeople || 'None'}
### Organizations: ${knownOrgs}
### User's Goals: ${seedGoals}

## Chats in This Batch
${formattedChats}

## Messages
${formattedMessages}

## EXACT OUTPUT SCHEMA:
{
  "batch_id": ${batchId},
  "people": [{"id": "P123", "name": "string", "phone": "string|null", "circle": "spouse|child|parent|in-law|sibling|relative|friend|colleague|client|vendor|partner|staff|unknown", "relation_notes": "string|null"}],
  "organizations": [{"id": "home", "name": "string", "type": "company|residence|vacation home|workspace|society|school|other", "side": "home|work", "role": "owner|partner|helper|resident|parent|member|other", "member_ids": ["P1"]}],
  "loops": [{"id": "L1", "title": "≤60 chars", "type": "commitment|followup|deadline|question", "status": "open|done|dropped", "owner_id": "ME|person_id", "chat_id": "C1", "source_msg_id": "M1", "due": "YYYY-MM-DD|null", "closed_by_msg_id": "M2|null", "helper_action": "assist|remind|leave"}],
  "goals": [{"id": "G1", "title": "string", "person_id": "ME|person_id", "area": "self|spouse|kids|parents|work|friends|experiences|finances|health|home", "type": "habit|milestone|experience", "horizon": "3mo|1yr|3yr|5yr", "evidence_msg_ids": ["M1"]}],
  "chat_assignments": [{"chat_id": "C1", "person_id": "P123"} or {"chat_id": "C2", "org_id": "home"}]
}

Output ONLY valid JSON:`;
}

/**
 * Run Phase 1 extraction on all batches
 */
export async function runPhase1(
  chats: Chat[],
  messages: Message[],
  seed: Seed,
  plan: BatchPlan
): Promise<Phase1Output[]> {
  const rateLimiter = new RateLimiter({ requestsPerMinute: 10 });
  const results: Phase1Output[] = [];
  
  // Build lookup maps
  const chatMap = new Map(chats.map(c => [c.chat_id, c]));
  const messagesByChat = new Map<string, Message[]>();
  for (const msg of messages) {
    const list = messagesByChat.get(msg.chat_id) || [];
    list.push(msg);
    messagesByChat.set(msg.chat_id, list);
  }
  
  console.error(`\nPhase 1: Extracting from ${plan.numBatches} batches...`);
  const startTime = Date.now();
  
  for (const batch of plan.batches) {
    const batchStart = Date.now();
    const remaining = plan.numBatches - batch.batchId;
    const eta = formatTime(rateLimiter.estimateTimeRemaining(remaining));
    
    console.error(`  Batch ${batch.batchId + 1}/${plan.numBatches} (${batch.chatIds.length} chats, ~${Math.round(batch.estimatedTokens/1000)}K tokens) ETA: ${eta}`);
    
    // Get chats and messages for this batch
    const batchChats = batch.chatIds
      .map(id => chatMap.get(id))
      .filter((c): c is Chat => c !== undefined);
    
    const batchMessages = batch.chatIds
      .flatMap(id => messagesByChat.get(id) || []);
    
    // Build prompt
    const prompt = buildBatchPrompt(batch.batchId, batchChats, batchMessages, seed);
    
    // Use DeepSeek (no rate limit rotation needed - generous limits)
    const customModel = createDeepSeekModel("deepseek-chat");
    console.error(`    Using: deepseek-chat`);
    
    try {
      // Generate with DeepSeek
      const result = await generate(prompt, phase1OutputSchema, {
        maxFixAttempts: 2,
        temperature: 0,
        customModel,
      });
      
      results.push(result);
      console.error(`    ✓ Done in ${Date.now() - batchStart}ms - ${result.people.length} people, ${result.loops.length} loops`);
    } catch (error) {
      console.error(`    ✗ Failed: ${error instanceof Error ? error.message : error}`);
      // Continue with other batches, don't fail completely
      results.push({
        batch_id: batch.batchId,
        people: [],
        organizations: [],
        loops: [],
        goals: [],
        chat_assignments: batch.chatIds.map(id => ({ chat_id: id })),
      });
    }
  }
  
  const totalTime = Date.now() - startTime;
  console.error(`Phase 1 complete in ${formatTime(totalTime)}`);
  
  return results;
}

// Single batch extraction - circles, orgs, chats, goals with confidence

import type { Message, Chat, Seed } from "../types/index.js";
import type { Batch } from "./batch.js";
import type { BatchOutput } from "./types.js";
import { batchOutputSchema } from "./types.js";
import { generate } from "../llm/index.js";

function formatMessages(messages: Message[]): string {
  return messages
    .map(m => {
      const date = new Date(m.ts * 1000).toISOString().slice(0, 10);
      return `[${m.id}] ${date} ${m.chat_id} | ${m.sender_name}: ${m.body}`;
    })
    .join('\n');
}

function formatChats(chats: Chat[]): string {
  return chats
    .map(c => {
      const participants = c.participants.filter(p => p !== "ME").join(", ");
      return `${c.chat_id}: "${c.name}" (${c.is_group ? 'group' : '1:1'}) [${participants}]`;
    })
    .join('\n');
}

function buildPrompt(batch: Batch, seed: Seed): string {
  const knownCircles = Object.entries(seed.circles)
    .map(([id, circle]) => `${id}: ${circle}`)
    .join(', ') || 'none';
  
  const knownOrgs = seed.organisations.join(', ') || 'none';
  
  const seedGoals = (seed.goals || [])
    .map(g => `"${g.title}" (${g.area})`)
    .join(', ') || 'none';

  return `Extract structured data from WhatsApp messages.

SEED (ground truth - use these exactly):
- Known circles: ${knownCircles}
- Known organizations: ${knownOrgs}
- Known goals: ${seedGoals}

CHATS:
${formatChats(batch.chats)}

MESSAGES:
${formatMessages(batch.messages)}

Extract with confidence scores (0.0-1.0) and evidence (message IDs):

1. CIRCLES: Each person's relationship to ME
   - spouse, child, parent, in-law, sibling, relative, friend, colleague, client, vendor, partner, staff
   - NEVER include ME
   - Use seed circles as ground truth (confidence: 1.0)
   - Infer from context: "driver"/"maid" = staff, work discussion = colleague, etc.

2. ORGS: Organizations ME is part of
   - Use "home" as ID for residence
   - type: company, residence, school, society, other
   - side: home or work
   - role: owner, partner, member, resident, other

3. CHATS: Assign each chat to a person OR org
   - 1:1 chats → person_id
   - Group chats → org_id (or primary contact person_id)

4. GOALS: Long-term aspirations mentioned
   - area: self, spouse, kids, parents, work, friends, experiences, finances, health, home
   - type: habit, milestone, experience
   - horizon: 3mo, 1yr, 3yr, 5yr

Higher confidence = more certain from evidence. Lower if inferring.

Output JSON only.`;
}

/**
 * Extract circles, orgs, chats, goals from a single batch
 */
export async function extractBatch(
  batch: Batch,
  seed: Seed,
  batchNum: number,
  totalBatches: number
): Promise<BatchOutput> {
  console.error(`  Batch ${batchNum}/${totalBatches}: ${batch.messages.length} msgs, ${batch.chats.length} chats`);
  
  const prompt = buildPrompt(batch, seed);
  
  try {
    const result = await generate(prompt, batchOutputSchema, {
      maxFixAttempts: 2,
      temperature: 0,
    });
    
    console.error(`    ✓ ${result.circles.length} circles, ${result.orgs.length} orgs, ${result.chats.length} chats, ${result.goals.length} goals`);
    return result;
  } catch (err) {
    console.error(`    ✗ ${err instanceof Error ? err.message : err}`);
    return { circles: [], orgs: [], chats: [], goals: [], loops: [] };
  }
}

// Pass 1: Per-chat extraction
// Processes MULTIPLE chats in ONE LLM call to reduce API calls
// Extracts: relationship signals, loop candidates, topics, goal hints

import { z } from "zod";
import { generate } from "../llm.js";
import { pass1OutputSchema, type Pass1Output } from "./schemas.js";
import type { Chat, Message } from "../types.js";

// Will be set by runPass1 if examples are provided
let fewShotExamples: string = "";

// Schema for batch output (multiple chats at once)
const batchPass1Schema = z.object({
  extractions: z.array(pass1OutputSchema),
});

const SYSTEM_PROMPT = `You are extracting structured information from WhatsApp chats.
For EACH chat provided, identify:

1. RELATIONSHIP SIGNALS - Evidence about who each person is relative to the chat owner (ME)
   - Look for: how they address ME, what they discuss, tone, context clues
   - Suggest a circle: spouse, child, parent, in-law, sibling, relative, friend, colleague, client, vendor, partner, staff
   - Rate confidence 0-1 (0.9+ = very clear, 0.5-0.7 = some signals, <0.5 = just guessing)

2. LOOP CANDIDATES - Extract ALL trackable items. Be thorough!
   Types of loops to detect:
   - commitment: "I'll do X", "Will send", "I'll handle it", "pick kar lunga", "bhej dunga"
   - question: Questions that need answering ("kya banana hai?", "what should we do?")
   - deadline: Explicit dates/times for deliverables ("due Friday", "by Monday", "kal tak")
   - followup: "Did you check...?", "Any update on...?", "kab tak?"

   For EACH loop, track the FULL LIFECYCLE:
   - source_msg: The message that creates the loop
   - owner: Who must act (ME or person_id)
   - status: open | done | dropped
   - closing_msg: The message that closes the loop (if any)

3. TOPICS - Main subjects discussed (max 5 per chat)

4. GOAL HINTS - Any explicit goals or aspirations mentioned

CRITICAL STATUS DETECTION - Look for these patterns:

DONE (commitment was fulfilled):
- "Proofs attached", "Sent the file", "Done", "Booked"
- Hindi: "chhod diya" (dropped off), "kar diya" (done), "bhej diya" (sent), "aa jayega" (it'll come/booked)
- Question answered with specific information (Q: "kya banana hai?" A: "Paneer butter masala" → DONE)

DROPPED (commitment was cancelled/superseded):
- "Never mind", "Don't worry about it", "No need", "Got it elsewhere"
- "coach gave me one" after "I'll send you my plan" → the plan is no longer needed = DROPPED
- When someone else handles it before the owner could

OPEN (still needs action):
- No confirmation or cancellation message after the commitment

COMMON HINDI/HINGLISH:
- "bhej dunga" / "bhejta hu" = will send → commitment created
- "bhej diya" / "attached" = sent → commitment DONE
- "pick kar lunga" = will pick up → commitment created
- "chhod diya" / "drop kar diya" = dropped off → commitment DONE
- "khatam" = finished/ending → context-dependent
- "kal" / "parso" = tomorrow / day after
- "theek hai" = ok (acknowledgment)

IMPORTANT: Extract ALL loops, including those that are already resolved. Don't skip loops just because they're done.

Return an extraction object for EACH chat in the input, in the same order.
Keep text_snippet under 150 characters. Be thorough but precise.`;

function buildBatchPrompt(chatsWithMessages: Array<{ chat: Chat; messages: Message[] }>): string {
  const lines: string[] = [];
  
  // Add few-shot examples if available
  if (fewShotExamples) {
    lines.push(fewShotExamples);
    lines.push("\n=== NOW EXTRACT FROM THESE CHATS ===\n");
  }
  
  for (let i = 0; i < chatsWithMessages.length; i++) {
    const { chat, messages } = chatsWithMessages[i]!;
    
    lines.push(`\n--- CHAT ${i + 1}: ${chat.chat_id} "${chat.name}" ---`);
    lines.push(`Type: ${chat.is_group ? "Group" : "1:1 chat"}`);
    lines.push(`Participants: ${chat.participants.filter(p => p !== "ME").join(", ")}`);
    lines.push("Messages:");
    
    for (const msg of messages) {
      const date = new Date(msg.ts * 1000).toISOString().split("T")[0];
      const sender = msg.sender_id === "ME" ? "ME" : `${msg.sender_name} (${msg.sender_id})`;
      // Truncate long messages to save tokens
      const body = msg.body.length > 300 ? msg.body.slice(0, 297) + "..." : msg.body;
      lines.push(`[${msg.id}] ${date} ${sender}: ${body}`);
    }
  }
  
  lines.push(`\n=== OUTPUT ===`);
  lines.push(`Return extractions for all ${chatsWithMessages.length} chats in order.`);
  
  return lines.join("\n");
}

/**
 * Extract information from a batch of chats in ONE LLM call
 */
async function extractFromBatch(
  chatsWithMessages: Array<{ chat: Chat; messages: Message[] }>
): Promise<Pass1Output[]> {
  if (chatsWithMessages.length === 0) return [];
  
  const prompt = buildBatchPrompt(chatsWithMessages);
  
  try {
    const result = await generate(prompt, batchPass1Schema, {
      system: SYSTEM_PROMPT,
      temperature: 0,
    });
    
    // Validate and fix chat_ids (LLM might hallucinate)
    const outputs: Pass1Output[] = [];
    for (let i = 0; i < chatsWithMessages.length; i++) {
      const { chat } = chatsWithMessages[i]!;
      const extraction = result.extractions[i];
      
      if (extraction) {
        outputs.push({
          ...extraction,
          chat_id: chat.chat_id, // Force correct chat_id
          participants: chat.participants.filter(p => p !== "ME"),
        });
      } else {
        // LLM didn't return extraction for this chat
        console.error(`  Warning: No extraction returned for chat ${chat.chat_id}`);
        outputs.push({
          chat_id: chat.chat_id,
          participants: chat.participants.filter(p => p !== "ME"),
          relationship_signals: [],
          loop_candidates: [],
          topics: [],
          goal_hints: [],
        });
      }
    }
    
    return outputs;
  } catch (error) {
    console.error(`  Warning: Batch extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    // Return empty structures for all chats in batch
    return chatsWithMessages.map(({ chat }) => ({
      chat_id: chat.chat_id,
      participants: chat.participants.filter(p => p !== "ME"),
      relationship_signals: [],
      loop_candidates: [],
      topics: [],
      goal_hints: [],
    }));
  }
}

/**
 * Run Pass 1 on all chats in batches (multiple chats per LLM call)
 */
export async function runPass1(
  chats: Chat[],
  messagesByChat: Map<string, Message[]>,
  options: { batchSize?: number; examples?: string; delayMs?: number } = {}
): Promise<Pass1Output[]> {
  const { batchSize = 10, examples = "", delayMs = 0 } = options;
  
  // Set few-shot examples for this run
  fewShotExamples = examples;
  
  const results: Pass1Output[] = [];
  
  // Prepare chats with their messages
  const chatsWithMessages = chats.map(chat => ({
    chat,
    messages: messagesByChat.get(chat.chat_id) ?? [],
  }));
  
  // Process in batches (multiple chats per LLM call)
  for (let i = 0; i < chatsWithMessages.length; i += batchSize) {
    const batch = chatsWithMessages.slice(i, i + batchSize);
    const batchEnd = Math.min(i + batchSize, chatsWithMessages.length);
    console.error(`Pass 1: Processing chats ${i + 1}-${batchEnd} of ${chatsWithMessages.length} (batch of ${batch.length})`);
    
    const batchResults = await extractFromBatch(batch);
    results.push(...batchResults);
    
    // Add delay between batches to respect rate limits
    if (delayMs > 0 && i + batchSize < chatsWithMessages.length) {
      console.error(`  Waiting ${delayMs / 1000}s to respect rate limits...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  // Clear examples after run
  fewShotExamples = "";
  
  return results;
}

// Keep old function for compatibility but it just calls the batch version
export async function extractFromChat(
  chat: Chat,
  messages: Message[]
): Promise<Pass1Output> {
  const results = await extractFromBatch([{ chat, messages }]);
  return results[0]!;
}

// Extract module - chat-based batched extraction with Chain of Thought

import type { Chat, Message, Seed, Output } from "../types/index.js";
import { createChatBasedBatches } from "./batch-by-chat.js";
import { extractBatchCot, type PriorLoop } from "./extract-cot.js";
import { mergeBatches } from "./merge.js";
import type { BatchOutput } from "./types.js";
import type { ExampleData } from "../io/types.js";
import { buildFewShotPrompt, estimateFewShotTokens } from "./few-shot.js";

export { createChatBasedBatches } from "./batch-by-chat.js";
export { extractBatchCot } from "./extract-cot.js";
export { mergeBatches } from "./merge.js";
export type { BatchOutput } from "./types.js";

/**
 * Run full extraction pipeline with Chain of Thought and chat-based batching
 * 
 * 1. Create chat-based batches (complete conversations per batch)
 * 2. Extract with CoT reasoning (shows thinking, then extracts)
 * 3. Pass open loops forward to help later batches recognize closures
 * 4. Merge using confidence scores
 * 
 * @param chats - All chats
 * @param messages - All messages
 * @param seed - Seed data (known circles, orgs, goals)
 * @param exampleData - Optional few-shot example for better accuracy
 */
export async function extract(
  chats: Chat[],
  messages: Message[],
  seed: Seed,
  exampleData?: ExampleData
): Promise<Output> {
  console.error(`\n=== Extraction Pipeline (Chain of Thought + Chat-Based Batching) ===`);
  console.error(`Input: ${chats.length} chats, ${messages.length} messages`);
  console.error(`Seed: ${Object.keys(seed.circles).length} circles, ${seed.organisations.length} orgs`);
  
  if (exampleData) {
    const tokens = estimateFewShotTokens(exampleData);
    console.error(`Few-shot: Enabled (~${tokens} tokens overhead)`);
  } else {
    console.error(`Few-shot: Disabled`);
  }
  console.error('');

  // Create chat-based batches (complete conversations)
  const batches = createChatBasedBatches(messages, chats);
  console.error(`Created ${batches.length} batches\n`);

  // Build few-shot prompt if example provided (used for all batches)
  const fewShotPrompt = exampleData ? buildFewShotPrompt(exampleData) : undefined;

  // Extract from each batch with CoT
  console.error(`--- Extracting (with reasoning) ---`);
  const results: BatchOutput[] = [];
  const allThinking: string[] = [];
  
  // Track open loops to pass forward to later batches
  let openLoops: PriorLoop[] = [];
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const batchMsgIds = new Set(batch.messages.map(m => m.id));
    
    // Filter prior loops to those whose source_msg is NOT in this batch
    // (if source is in this batch, the LLM will see it directly)
    const relevantPriorLoops = openLoops.filter(l => !batchMsgIds.has(l.source_msg));
    
    const { output, thinking } = await extractBatchCot(
      batch, 
      seed, 
      i + 1, 
      batches.length,
      relevantPriorLoops.length > 0 ? relevantPriorLoops : undefined,
      fewShotPrompt
    );
    results.push(output);
    if (thinking) allThinking.push(`=== Batch ${i + 1} ===\n${thinking}`);
    
    // Update open loops: add new opens, remove closed ones
    const closedSourceMsgs = new Set(
      output.loops
        .filter(l => l.status === 'done' || l.status === 'dropped')
        .map(l => l.source_msg)
    );
    
    // Remove loops that got closed in this batch
    openLoops = openLoops.filter(l => !closedSourceMsgs.has(l.source_msg));
    
    // Add new open loops from this batch
    for (const loop of output.loops) {
      if (loop.status === 'open') {
        // Only add if not already tracked (dedupe by source_msg)
        if (!openLoops.some(l => l.source_msg === loop.source_msg)) {
          openLoops.push({
            source_msg: loop.source_msg,
            title: loop.title,
            owner: loop.owner,
          });
        }
      }
    }
    
    console.error(`    → Open loops tracked: ${openLoops.length}`);
  }

  // Merge results
  console.error(`\n--- Merging ---`);
  const merged = mergeBatches(results, seed);

  // Build final output
  const output: Output = {
    people: merged.people,
    organisations: merged.organisations,
    chats: merged.chats,
    goals: merged.goals,
    open_loops: merged.loops,
  };

  console.error(`\n=== Final Output ===`);
  console.error(`People: ${output.people.length}`);
  console.error(`Organisations: ${output.organisations.length}`);
  console.error(`Chats: ${output.chats.length}`);
  console.error(`Goals: ${output.goals.length}`);
  console.error(`Open Loops: ${output.open_loops.length}\n`);

  // Optionally log thinking
  if (allThinking.length > 0) {
    console.error(`\n--- Model Reasoning ---`);
    console.error(allThinking.join('\n\n').slice(0, 2000) + '...\n');
  }

  return output;
}

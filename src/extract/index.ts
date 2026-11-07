// Extract module - sliding window batched extraction with Chain of Thought

import type { Chat, Message, Seed, Output } from "../types/index.js";
import { createBatches } from "./batch.js";
import { extractBatchCot } from "./extract-cot.js";
import { mergeBatches } from "./merge.js";
import type { BatchOutput } from "./types.js";

export { createBatches } from "./batch.js";
export { extractBatch } from "./extract.js";
export { extractBatchCot } from "./extract-cot.js";
export { mergeBatches } from "./merge.js";
export type { BatchOutput } from "./types.js";

/**
 * Run full extraction pipeline with Chain of Thought
 * 
 * 1. Create sliding window batches (sorted by time)
 * 2. Extract with CoT reasoning (shows thinking, then extracts)
 * 3. Merge using confidence scores
 */
export async function extract(
  chats: Chat[],
  messages: Message[],
  seed: Seed
): Promise<Output> {
  console.error(`\n=== Extraction Pipeline (Chain of Thought) ===`);
  console.error(`Input: ${chats.length} chats, ${messages.length} messages`);
  console.error(`Seed: ${Object.keys(seed.circles).length} circles, ${seed.organisations.length} orgs\n`);

  // Create batches
  const batches = createBatches(messages, chats, {
    windowSize: 50,
    overlap: 10,
  });
  console.error(`Created ${batches.length} batches\n`);

  // Extract from each batch with CoT
  console.error(`--- Extracting (with reasoning) ---`);
  const results: BatchOutput[] = [];
  const allThinking: string[] = [];
  
  for (let i = 0; i < batches.length; i++) {
    const { output, thinking } = await extractBatchCot(batches[i]!, seed, i + 1, batches.length);
    results.push(output);
    if (thinking) allThinking.push(`=== Batch ${i + 1} ===\n${thinking}`);
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

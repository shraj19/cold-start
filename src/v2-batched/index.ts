// V2 Batched Extraction - Main orchestrator

import type { Chat, Message, Seed, Output } from "../types/index.js";
import { planBatches, printBatchPlan } from "./plan.js";
import { runPhase1 } from "./extract.js";
import { runPhase2 } from "./merge.js";

export interface V2Options {
  /** Use example data for few-shot (optional) */
  exampleInput?: { chats: Chat[]; messages: Message[]; seed: Seed };
  exampleOutput?: Output;
}

/**
 * Run V2 batched extraction
 */
export async function runV2(
  chats: Chat[],
  messages: Message[],
  seed: Seed,
  _options: V2Options = {}
): Promise<Output> {
  console.error(`\nV2: Batched extraction approach`);
  console.error(`  ${chats.length} chats, ${messages.length} messages`);
  
  // Phase 0: Plan batches
  const plan = planBatches(chats, messages);
  printBatchPlan(plan);
  
  // Phase 1: Extract from each batch
  const batchResults = await runPhase1(chats, messages, seed, plan);
  
  // Summary of Phase 1
  const totalPeople = batchResults.reduce((s, r) => s + r.people.length, 0);
  const totalLoops = batchResults.reduce((s, r) => s + r.loops.length, 0);
  const totalOrgs = batchResults.reduce((s, r) => s + r.organizations.length, 0);
  
  console.error(`\nPhase 1 Summary:`);
  console.error(`  Extracted: ${totalPeople} people, ${totalOrgs} orgs, ${totalLoops} loops`);
  
  // Phase 2: Merge all results
  const output = await runPhase2(batchResults, seed);
  
  console.error(`\nFinal Output:`);
  console.error(`  ${output.people.length} people`);
  console.error(`  ${output.organisations.length} organisations`);
  console.error(`  ${output.chats.length} chats`);
  console.error(`  ${output.goals.length} goals`);
  console.error(`  ${output.open_loops.length} open loops`);
  
  return output;
}

// Re-export types
export type { Phase1Output } from "./schemas.js";
export type { BatchPlan, BatchInfo } from "./plan.js";

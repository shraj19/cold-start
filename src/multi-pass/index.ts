// Multi-pass extraction pipeline
// Pass 1: Per-chat extraction (parallel)
// Pass 2: Global synthesis
// Pass 3: Deep-dive investigation (optional, for low-confidence items)

import { runPass1 } from "./pass1.js";
import { runPass2 } from "./pass2.js";
import { runPass3 } from "./pass3.js";
import { buildFinalOutput } from "./merge.js";
import { loadExampleData, buildPass1Examples, buildPass2Examples } from "./examples.js";
import type { Chat, Message, Seed, Output } from "../types.js";
import type { Pass1Output, Pass2Output, Pass3Output } from "./schemas.js";

export interface PipelineOptions {
  /** Max concurrent Pass 1 extractions (default: 10) */
  concurrency?: number;
  /** Delay between batches in ms (default: 0, use 5000+ for rate-limited APIs) */
  delayMs?: number;
  /** Confidence threshold for Pass 3 investigation (default: 0.6) */
  investigationThreshold?: number;
  /** Skip Pass 3 entirely (default: false) */
  skipPass3?: boolean;
  /** Path to example data folder for few-shot learning */
  exampleDir?: string;
  /** Callback for progress updates */
  onProgress?: (stage: string, progress: number, total: number) => void;
}

export interface PipelineResult {
  output: Output;
  pass1: Pass1Output[];
  pass2: Pass2Output;
  pass3: Pass3Output | null;
  stats: {
    totalChats: number;
    totalMessages: number;
    totalPeople: number;
    pass1Time: number;
    pass2Time: number;
    pass3Time: number;
    investigationsRequested: number;
    usedExamples: boolean;
  };
}

/**
 * Run the full multi-pass extraction pipeline
 */
export async function runPipeline(
  chats: Chat[],
  messages: Message[],
  seed: Seed,
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const {
    concurrency = 10,
    delayMs = 0,
    skipPass3 = false,
    exampleDir,
    onProgress,
  } = options;

  // Build message index
  const messagesByChat = new Map<string, Message[]>();
  for (const msg of messages) {
    const chatMsgs = messagesByChat.get(msg.chat_id) ?? [];
    chatMsgs.push(msg);
    messagesByChat.set(msg.chat_id, chatMsgs);
  }

  // Load few-shot examples if provided
  let pass1Examples = "";
  let pass2Examples = "";
  let usedExamples = false;
  
  if (exampleDir) {
    console.error(`Loading few-shot examples from ${exampleDir}...`);
    const exampleData = loadExampleData(exampleDir);
    if (exampleData) {
      pass1Examples = buildPass1Examples(exampleData);
      pass2Examples = buildPass2Examples(exampleData);
      usedExamples = true;
      console.error("Few-shot examples loaded successfully");
    }
  }

  // ----- PASS 1 -----
  console.error("\n=== PASS 1: Per-chat extraction ===");
  const pass1Start = Date.now();
  
  const pass1 = await runPass1(chats, messagesByChat, { 
    concurrency,
    delayMs,
    examples: pass1Examples,
  });
  
  const pass1Time = Date.now() - pass1Start;
  console.error(`Pass 1 complete: ${pass1.length} chats processed in ${(pass1Time / 1000).toFixed(1)}s`);

  // ----- PASS 2 -----
  console.error("\n=== PASS 2: Global synthesis ===");
  const pass2Start = Date.now();
  
  const pass2 = await runPass2(pass1, seed, { examples: pass2Examples });
  
  const pass2Time = Date.now() - pass2Start;
  console.error(`Pass 2 complete in ${(pass2Time / 1000).toFixed(1)}s`);
  console.error(`  - ${pass2.circle_decisions.length} circle decisions`);
  console.error(`  - ${pass2.org_decisions.length} organisations`);
  console.error(`  - ${pass2.loop_decisions.length} loops`);
  console.error(`  - ${pass2.goal_decisions.length} goals`);
  console.error(`  - ${pass2.needs_investigation.length} items flagged for investigation`);

  // ----- PASS 3 (optional) -----
  let pass3: Pass3Output | null = null;
  let pass3Time = 0;

  if (!skipPass3 && pass2.needs_investigation.length > 0) {
    console.error("\n=== PASS 3: Deep-dive investigation ===");
    const pass3Start = Date.now();
    
    pass3 = await runPass3(pass2.needs_investigation, chats, messages);
    
    pass3Time = Date.now() - pass3Start;
    console.error(`Pass 3 complete in ${(pass3Time / 1000).toFixed(1)}s`);
    console.error(`  - ${pass3.circle_refinements.length} circle refinements`);
    console.error(`  - ${pass3.loop_refinements.length} loop refinements`);
    console.error(`  - ${pass3.goal_refinements.length} goal refinements`);
  } else if (skipPass3) {
    console.error("\n=== PASS 3: Skipped ===");
  } else {
    console.error("\n=== PASS 3: Not needed (no low-confidence items) ===");
  }

  // ----- MERGE -----
  console.error("\n=== Building final output ===");
  const output = buildFinalOutput({
    pass1,
    pass2,
    pass3,
    seed,
    chats,
  });

  // Collect all person IDs for stats
  const allPersonIds = new Set<string>();
  for (const p1 of pass1) {
    p1.participants.forEach(p => allPersonIds.add(p));
  }

  return {
    output,
    pass1,
    pass2,
    pass3,
    stats: {
      totalChats: chats.length,
      totalMessages: messages.length,
      totalPeople: allPersonIds.size,
      pass1Time,
      pass2Time,
      pass3Time,
      investigationsRequested: pass2.needs_investigation.length,
      usedExamples,
    },
  };
}

// Re-export types
export type { Pass1Output, Pass2Output, Pass3Output } from "./schemas.js";

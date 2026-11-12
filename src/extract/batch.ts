// Token-aware sliding window batching for messages

import type { Message, Chat } from "../types/index.js";
import { env } from "../env.js";

export interface Batch {
  messages: Message[];
  chats: Chat[];  // chats that appear in this batch
}

export interface BatchOptions {
  maxTokens: number;      // max tokens per batch
  overlapTokens: number;  // overlap in tokens between batches
}

// Model presets - conservative token limits leaving room for system prompt + output
const MODEL_PRESETS: Record<string, BatchOptions> = {
  // OpenRouter FREE 1M context models (best for testing)
  'baidu/ernie-5.5-flash-preview:free':         { maxTokens: 800_000, overlapTokens: 50_000 },
  'baidu/ernie-5.5-flash-preview':              { maxTokens: 800_000, overlapTokens: 50_000 },
  'nvidia/nemotron-3.5-super-vl:free':          { maxTokens: 800_000, overlapTokens: 50_000 },
  'nvidia/nemotron-3-ultra-550b-a55b:free':     { maxTokens: 800_000, overlapTokens: 50_000 },
  'nvidia/nemotron-3.5-lightning:free':         { maxTokens: 800_000, overlapTokens: 50_000 },
  'thinkingmachines/inkling:free':              { maxTokens: 800_000, overlapTokens: 50_000 },
  'thinkingmachines/inkling-2-small:free':      { maxTokens: 800_000, overlapTokens: 50_000 },
  
  // DeepSeek V4.1 Flash 1017 - submission model, 1M context, ~0.24x baseline cost
  'deepseek/deepseek-v4.1-flash-1017':          { maxTokens: 800_000, overlapTokens: 50_000 },
  'deepseek/deepseek-v4.1-flash':               { maxTokens: 800_000, overlapTokens: 50_000 },
  
  // OpenRouter paid 1M context models
  'google/gemini-3.8-flash':     { maxTokens: 800_000, overlapTokens: 50_000 },
  'google/gemini-3.1-flash-lite':{ maxTokens: 800_000, overlapTokens: 50_000 },
  'google/gemini-2.5-flash':     { maxTokens: 800_000, overlapTokens: 50_000 },
  'google/gemini-flash-1.5':     { maxTokens: 800_000, overlapTokens: 50_000 },
  'google/gemini-pro-1.5':       { maxTokens: 800_000, overlapTokens: 50_000 },
  
  // Direct Gemini API (1M context)
  'gemini-3.8-flash':            { maxTokens: 800_000, overlapTokens: 50_000 },
  'gemini-3.5-flash':            { maxTokens: 800_000, overlapTokens: 50_000 },
  'gemini-3.1-flash-lite':       { maxTokens: 800_000, overlapTokens: 50_000 },
  'gemini-2.0-flash':            { maxTokens: 800_000, overlapTokens: 50_000 },
  'gemini-1.5-flash':            { maxTokens: 800_000, overlapTokens: 50_000 },
  'gemini-1.5-pro':              { maxTokens: 800_000, overlapTokens: 50_000 },
  
  // Medium context models (128K-200K)
  'anthropic/claude-3.5-sonnet': { maxTokens: 120_000, overlapTokens: 12_000 },
  'anthropic/claude-3-sonnet':   { maxTokens: 120_000, overlapTokens: 12_000 },
  'openai/gpt-4o':               { maxTokens: 80_000,  overlapTokens: 8_000 },
  'openai/gpt-4o-mini':          { maxTokens: 80_000,  overlapTokens: 8_000 },
  
  // Smaller context models (64K)
  'deepseek/deepseek-chat':      { maxTokens: 45_000,  overlapTokens: 5_000 },
  'deepseek-chat':               { maxTokens: 45_000,  overlapTokens: 5_000 },
};

// Conservative fallback for unknown models (assumes 64K context)
const DEFAULT_OPTIONS: BatchOptions = {
  maxTokens: 45_000,
  overlapTokens: 5_000,
};

/**
 * Get batch options based on configured model
 */
export function getBatchOptions(): BatchOptions {
  
  const model = env.LLM_MODEL;
  const preset = MODEL_PRESETS[model];
  
  if (preset) {
    console.error(`  [Batch config] Using preset for ${model}: ${preset.maxTokens} tokens`);
  } else {
    console.error(`  [Batch config] Unknown model ${model}, using default: ${DEFAULT_OPTIONS.maxTokens} tokens`);
  }
  
  return preset ?? DEFAULT_OPTIONS;
}

/**
 * Estimate tokens for a message (conservative: ~3 chars per token + formatting overhead)
 */
export function estimateMessageTokens(message: Message): number {
  // Message format: "[M001] 2026-10-20 C01 | P01 (Name): body"
  const formatOverhead = 50; // ID, date, chat, sender formatting
  const bodyTokens = Math.ceil(message.body.length / 3);
  return formatOverhead + bodyTokens;
}

/**
 * Estimate tokens for chat metadata
 */
export function estimateChatTokens(chat: Chat): number {
  // Format: "C01: "Name" (group) [P01, P02, P03]"
  const baseTokens = 20;
  const nameTokens = Math.ceil(chat.name.length / 3);
  const participantTokens = chat.participants.length * 5;
  return baseTokens + nameTokens + participantTokens;
}

/**
 * Create token-aware sliding window batches from messages sorted by time
 */
export function createBatches(
  messages: Message[],
  chats: Chat[],
  options?: Partial<BatchOptions>
): Batch[] {
  const opts = { ...getBatchOptions(), ...options };
  const { maxTokens, overlapTokens } = opts;
  
  // Sort messages by timestamp
  const sorted = [...messages].sort((a, b) => a.ts - b.ts);
  
  // Pre-calculate token estimates for all messages
  const msgTokens = sorted.map(m => estimateMessageTokens(m));
  
  // Create chat lookup
  const chatMap = new Map(chats.map(c => [c.chat_id, c]));
  
  // Reserve tokens for system prompt, output, and priorLoops context
  const systemPromptTokens = 1500;  // ~800 actual + buffer
  const outputTokens = 3000;        // JSON output buffer
  const priorLoopsBuffer = 2000;    // ~100 loops × 20 tokens each (conservative)
  const availableTokens = maxTokens - systemPromptTokens - outputTokens - priorLoopsBuffer;
  
  const batches: Batch[] = [];
  let startIdx = 0;
  
  while (startIdx < sorted.length) {
    let batchTokens = 0;
    let endIdx = startIdx;
    
    // Add messages until we hit token limit
    while (endIdx < sorted.length && batchTokens + msgTokens[endIdx]! < availableTokens) {
      batchTokens += msgTokens[endIdx]!;
      endIdx++;
    }
    
    // Ensure we make progress (at least 1 message per batch)
    if (endIdx === startIdx) {
      console.error(`Warning: Message ${sorted[startIdx]!.id} exceeds token limit, including anyway`);
      endIdx = startIdx + 1;
    }
    
    const batchMsgs = sorted.slice(startIdx, endIdx);
    
    // Find unique chats in this batch and estimate their tokens
    const chatIds = new Set(batchMsgs.map(m => m.chat_id));
    const batchChats = [...chatIds]
      .map(id => chatMap.get(id))
      .filter((c): c is Chat => c !== undefined);
    
    batches.push({
      messages: batchMsgs,
      chats: batchChats,
    });
    
    // Calculate overlap: go back by overlapTokens worth of messages
    let overlapMsgs = 0;
    let overlapTokenCount = 0;
    for (let i = endIdx - 1; i >= startIdx && overlapTokenCount < overlapTokens; i--) {
      overlapTokenCount += msgTokens[i]!;
      overlapMsgs++;
    }
    
    // Next batch starts with overlap
    startIdx = endIdx - overlapMsgs;
    
    // Prevent infinite loop if overlap is too large
    if (startIdx <= batches[batches.length - 1]!.messages.length && batches.length > 1) {
      startIdx = endIdx;
    }
    
    // Stop if we've covered all messages
    if (endIdx >= sorted.length) break;
  }
  
  return batches;
}

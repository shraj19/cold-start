// Batch planning - dynamic sizing based on data

import type { Chat, Message } from "../types/index.js";

export interface BatchPlan {
  numBatches: number;
  chatsPerBatch: number;
  batches: BatchInfo[];
  estimatedTokensPerBatch: number;
  totalEstimatedTokens: number;
}

export interface BatchInfo {
  batchId: number;
  chatIds: string[];
  messageCount: number;
  estimatedTokens: number;
}

// Tuning constants
const TARGET_TOKENS_PER_BATCH = 8_000;  // Conservative - leave room for prompt overhead
const MAX_TOKENS_PER_BATCH = 15_000;    // Hard limit
const MIN_CHATS_PER_BATCH = 2;
const MAX_CHATS_PER_BATCH = 10;
const TOKENS_PER_CHAR = 0.25;           // Rough estimate: ~4 chars per token

/**
 * Estimate token count for a set of messages
 */
function estimateTokens(messages: Message[]): number {
  const totalChars = messages.reduce((sum, m) => sum + m.body.length + m.sender_name.length + 20, 0);
  return Math.ceil(totalChars * TOKENS_PER_CHAR);
}

/**
 * Create a dynamic batch plan based on actual data size
 */
export function planBatches(chats: Chat[], messages: Message[]): BatchPlan {
  const totalMessages = messages.length;
  const totalChats = chats.length;
  
  // Build message count per chat
  const messagesByChat = new Map<string, Message[]>();
  for (const msg of messages) {
    const list = messagesByChat.get(msg.chat_id) || [];
    list.push(msg);
    messagesByChat.set(msg.chat_id, list);
  }
  
  // Calculate tokens per chat
  const chatTokens = new Map<string, number>();
  for (const chat of chats) {
    const chatMessages = messagesByChat.get(chat.chat_id) || [];
    chatTokens.set(chat.chat_id, estimateTokens(chatMessages));
  }
  
  // Greedy batching: add chats until we hit token limit
  const batches: BatchInfo[] = [];
  let currentBatch: string[] = [];
  let currentTokens = 0;
  let currentMessages = 0;
  
  // Sort chats by message count (smaller first) for more even distribution
  const sortedChats = [...chats].sort((a, b) => {
    const aCount = messagesByChat.get(a.chat_id)?.length || 0;
    const bCount = messagesByChat.get(b.chat_id)?.length || 0;
    return aCount - bCount;
  });
  
  for (const chat of sortedChats) {
    const tokens = chatTokens.get(chat.chat_id) || 0;
    const msgCount = messagesByChat.get(chat.chat_id)?.length || 0;
    
    // Check if adding this chat would exceed limits
    const wouldExceed = (currentTokens + tokens > TARGET_TOKENS_PER_BATCH && currentBatch.length >= MIN_CHATS_PER_BATCH)
                     || (currentBatch.length >= MAX_CHATS_PER_BATCH)
                     || (currentTokens + tokens > MAX_TOKENS_PER_BATCH);
    
    if (wouldExceed && currentBatch.length > 0) {
      // Finalize current batch
      batches.push({
        batchId: batches.length,
        chatIds: currentBatch,
        messageCount: currentMessages,
        estimatedTokens: currentTokens,
      });
      currentBatch = [];
      currentTokens = 0;
      currentMessages = 0;
    }
    
    // Add chat to current batch
    currentBatch.push(chat.chat_id);
    currentTokens += tokens;
    currentMessages += msgCount;
  }
  
  // Don't forget the last batch
  if (currentBatch.length > 0) {
    batches.push({
      batchId: batches.length,
      chatIds: currentBatch,
      messageCount: currentMessages,
      estimatedTokens: currentTokens,
    });
  }
  
  // Calculate stats
  const avgChatsPerBatch = Math.round(totalChats / batches.length * 10) / 10;
  const avgTokensPerBatch = Math.round(batches.reduce((s, b) => s + b.estimatedTokens, 0) / batches.length);
  const totalTokens = batches.reduce((s, b) => s + b.estimatedTokens, 0);
  
  return {
    numBatches: batches.length,
    chatsPerBatch: avgChatsPerBatch,
    batches,
    estimatedTokensPerBatch: avgTokensPerBatch,
    totalEstimatedTokens: totalTokens,
  };
}

/**
 * Print batch plan summary
 */
export function printBatchPlan(plan: BatchPlan): void {
  console.error(`Batch Plan:`);
  console.error(`  Total batches: ${plan.numBatches}`);
  console.error(`  Avg chats/batch: ${plan.chatsPerBatch}`);
  console.error(`  Avg tokens/batch: ~${Math.round(plan.estimatedTokensPerBatch / 1000)}K`);
  console.error(`  Total tokens: ~${Math.round(plan.totalEstimatedTokens / 1000)}K`);
  console.error(`  Batch sizes: ${plan.batches.map(b => b.chatIds.length).join(', ')}`);
}

// Sliding window batching for messages

import type { Message, Chat } from "../types/index.js";

export interface Batch {
  messages: Message[];
  chats: Chat[];  // chats that appear in this batch
}

export interface BatchOptions {
  windowSize: number;  // messages per batch
  overlap: number;     // overlap between batches
}

const DEFAULT_OPTIONS: BatchOptions = {
  windowSize: 1000,  // ~40K tokens input, safe for 128K context
  overlap: 100,      // 10% overlap for continuity
};

/**
 * Create sliding window batches from messages sorted by time
 */
export function createBatches(
  messages: Message[],
  chats: Chat[],
  options: Partial<BatchOptions> = {}
): Batch[] {
  const { windowSize, overlap } = { ...DEFAULT_OPTIONS, ...options };
  
  // Sort messages by timestamp
  const sorted = [...messages].sort((a, b) => a.ts - b.ts);
  
  // Create chat lookup
  const chatMap = new Map(chats.map(c => [c.chat_id, c]));
  
  const batches: Batch[] = [];
  const step = windowSize - overlap;
  
  for (let i = 0; i < sorted.length; i += step) {
    const batchMsgs = sorted.slice(i, i + windowSize);
    
    // Find unique chats in this batch
    const chatIds = new Set(batchMsgs.map(m => m.chat_id));
    const batchChats = [...chatIds]
      .map(id => chatMap.get(id))
      .filter((c): c is Chat => c !== undefined);
    
    batches.push({
      messages: batchMsgs,
      chats: batchChats,
    });
    
    // Stop if we've covered all messages
    if (i + windowSize >= sorted.length) break;
  }
  
  return batches;
}

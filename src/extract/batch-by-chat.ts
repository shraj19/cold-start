// Chat-based batching - groups complete conversations together
// Better context quality for relationship/org/loop extraction

import type { Message, Chat } from "../types/index.js";
import type { Batch } from "./batch.js";
import { getBatchOptions, estimateMessageTokens, estimateChatTokens } from "./batch.js";

// ============================================================
// Types
// ============================================================

interface ChatWithMetadata {
  chat: Chat;
  messages: Message[];
  firstTimestamp: number;
  tokenCount: number;
}

// ============================================================
// Helper Functions (single responsibility each)
// ============================================================

/**
 * Group messages by chat_id
 */
function groupMessagesByChat(messages: Message[]): Map<string, Message[]> {
  const messagesByChat = new Map<string, Message[]>();
  
  for (const message of messages) {
    const chatMessages = messagesByChat.get(message.chat_id) ?? [];
    chatMessages.push(message);
    messagesByChat.set(message.chat_id, chatMessages);
  }
  
  return messagesByChat;
}

/**
 * Sort messages in each chat chronologically
 */
function sortMessagesChronologically(messagesByChat: Map<string, Message[]>): void {
  for (const chatMessages of messagesByChat.values()) {
    chatMessages.sort((a, b) => a.ts - b.ts);
  }
}

/**
 * Calculate metadata for a single chat (tokens, timestamp)
 */
function calculateChatMetadata(chat: Chat, messages: Message[]): ChatWithMetadata {
  const firstTimestamp = messages.length > 0 
    ? Math.min(...messages.map(m => m.ts))
    : 0;
  
  const messageTokens = messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
  const chatMetadataTokens = estimateChatTokens(chat);
  const tokenCount = messageTokens + chatMetadataTokens;
  
  return {
    chat,
    messages,
    firstTimestamp,
    tokenCount,
  };
}

/**
 * Build metadata for all chats, filtering empty ones
 */
function buildChatsWithMetadata(
  chats: Chat[], 
  messagesByChat: Map<string, Message[]>
): ChatWithMetadata[] {
  return chats
    .map(chat => {
      const chatMessages = messagesByChat.get(chat.chat_id) ?? [];
      return calculateChatMetadata(chat, chatMessages);
    })
    .filter(c => c.messages.length > 0);
}

/**
 * Pack chats into token-limited batches
 */
function packIntoBatches(
  chatsWithMetadata: ChatWithMetadata[], 
  maxTokens: number
): Batch[] {
  const batches: Batch[] = [];
  let currentBatch: Batch = { messages: [], chats: [] };
  let currentTokens = 0;
  
  for (const chatData of chatsWithMetadata) {
    // Start new batch if this chat would exceed limit (unless batch is empty)
    if (currentTokens + chatData.tokenCount > maxTokens && currentBatch.chats.length > 0) {
      batches.push(currentBatch);
      currentBatch = { messages: [], chats: [] };
      currentTokens = 0;
    }
    
    // Add complete chat to current batch
    currentBatch.messages.push(...chatData.messages);
    currentBatch.chats.push(chatData.chat);
    currentTokens += chatData.tokenCount;
  }
  
  // Push final batch if not empty
  if (currentBatch.chats.length > 0) {
    batches.push(currentBatch);
  }
  
  return batches;
}

/**
 * Log batch statistics
 */
function logBatchStats(chatsWithMetadata: ChatWithMetadata[], batches: Batch[]): void {
  console.error(`\nChat-based batching:`);
  console.error(`  Total chats: ${chatsWithMetadata.length}`);
  console.error(`  Created ${batches.length} batches`);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    console.error(`  Batch ${i + 1}: ${batch.chats.length} chats, ${batch.messages.length} messages`);
  }
  console.error('');
}

// ============================================================
// Main Function (orchestrates helpers)
// ============================================================

/**
 * Create batches by grouping complete chats (not splitting conversations)
 * 
 * Strategy:
 * 1. Group all messages by chat_id
 * 2. Sort each chat's messages chronologically
 * 3. Sort chats by their first message timestamp
 * 4. Pack complete chats into token-limited batches
 * 
 * Pros:
 * - LLM sees complete conversation context
 * - Better relationship/circle inference
 * - Better org extraction (full participant lists)
 * - Better within-chat loop detection
 * 
 * Cons:
 * - May miss cross-chat loop closures (~10% of loops)
 * - No strict temporal ordering across chats
 */
export function createChatBasedBatches(messages: Message[], chats: Chat[]): Batch[] {
  const options = getBatchOptions();
  
  // Step 1: Group messages by chat
  const messagesByChat = groupMessagesByChat(messages);
  
  // Step 2: Sort each chat's messages chronologically
  sortMessagesChronologically(messagesByChat);
  
  // Step 3: Build metadata for all chats
  const chatsWithMetadata = buildChatsWithMetadata(chats, messagesByChat);
  
  // Step 4: Sort chats by first message timestamp
  chatsWithMetadata.sort((a, b) => a.firstTimestamp - b.firstTimestamp);
  
  // Step 5: Pack into token-limited batches
  const batches = packIntoBatches(chatsWithMetadata, options.maxTokens);
  
  // Log stats
  logBatchStats(chatsWithMetadata, batches);
  
  return batches;
}

/**
 * Export time-based batching for comparison testing
 */
export { createBatches as createTimeBasedBatches } from "./batch.js";

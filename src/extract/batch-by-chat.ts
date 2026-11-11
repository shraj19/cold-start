// Chat-based batching - groups complete conversations together
// Better context quality for relationship/org/loop extraction

import type { Message, Chat } from "../types/index.js";
import type { Batch, BatchOptions } from "./batch.js";
import { getBatchOptions, estimateMessageTokens, estimateChatTokens } from "./batch.js";

/**
 * Create batches by grouping complete chats (not splitting conversations)
 * 
 * Strategy:
 * 1. Group all messages by chat_id
 * 2. Sort each chat's messages chronologically (preserve conversation flow)
 * 3. Sort chats by their first message timestamp (rough temporal ordering)
 * 4. Pack complete chats into token-limited batches
 * 
 * Pros:
 * - LLM sees complete conversation context
 * - Better relationship/circle inference
 * - Better org extraction (full participant lists)
 * - Better within-chat loop detection
 * - Simpler entity merging (less duplication)
 * 
 * Cons:
 * - May miss cross-chat loop closures (~10% of loops)
 * - No strict temporal ordering across chats
 */
export function createChatBasedBatches(messages: Message[], chats: Chat[]): Batch[] {
  const options = getBatchOptions();
  
  // Group messages by chat_id
  const messagesByChat = new Map<string, Message[]>();
  for (const message of messages) {
    const chatMessages = messagesByChat.get(message.chat_id) ?? [];
    chatMessages.push(message);
    messagesByChat.set(message.chat_id, chatMessages);
  }
  
  // Sort each chat's messages chronologically
  for (const chatMessages of messagesByChat.values()) {
    chatMessages.sort((a, b) => a.ts - b.ts);
  }
  
  // Calculate chat metadata for batching
  interface ChatWithMetadata {
    chat: Chat;
    messages: Message[];
    firstTimestamp: number;
    tokenCount: number;
  }
  
  const chatsWithMetadata: ChatWithMetadata[] = chats
    .map(chat => {
      const chatMessages = messagesByChat.get(chat.chat_id) ?? [];
      const firstTimestamp = chatMessages.length > 0 
        ? Math.min(...chatMessages.map(m => m.ts))
        : 0;
      
      // Calculate tokens for this complete chat
      const messageTokens = chatMessages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
      const chatMetadataTokens = estimateChatTokens(chat);
      const tokenCount = messageTokens + chatMetadataTokens;
      
      return {
        chat,
        messages: chatMessages,
        firstTimestamp,
        tokenCount,
      };
    })
    .filter(c => c.messages.length > 0); // Skip empty chats
  
  // Sort chats by first message timestamp (rough chronological ordering)
  chatsWithMetadata.sort((a, b) => a.firstTimestamp - b.firstTimestamp);
  
  // Pack chats into token-limited batches
  const batches: Batch[] = [];
  let currentBatch: Batch = { messages: [], chats: [] };
  let currentTokens = 0;
  
  for (const chatData of chatsWithMetadata) {
    // If adding this chat would exceed token limit, start new batch
    // (unless current batch is empty - then we must include it even if over limit)
    if (currentTokens + chatData.tokenCount > options.maxTokens && currentBatch.chats.length > 0) {
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
  
  // Log batch statistics
  console.error(`\nChat-based batching:`);
  console.error(`  Total chats: ${chatsWithMetadata.length}`);
  console.error(`  Created ${batches.length} batches`);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    console.error(`  Batch ${i + 1}: ${batch.chats.length} chats, ${batch.messages.length} messages`);
  }
  console.error('');
  
  return batches;
}

/**
 * Export both functions for easy comparison testing
 */
export { createBatches as createTimeBasedBatches } from "./batch.js";

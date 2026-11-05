// Store types

import type { Chat, Message, Seed } from "../types/index.js";

/** Input to create a DataStore */
export interface StoreInput {
  chats: Chat[];
  messages: Message[];
  seed: Seed;
}

/** Options for semantic search */
export interface SemanticSearchOptions {
  limit?: number;
  chatIds?: string[];
  senderIds?: string[];
  minScore?: number;
}

/** Result from semantic search with relevance score */
export interface SearchResult {
  message: Message;
  score: number;
}

/** Stats about the store */
export interface StoreStats {
  totalChats: number;
  totalMessages: number;
  totalParticipants: number;
  messagesPerChat: Record<string, number>;
  avgMessagesPerChat: number;
  maxMessagesInChat: number;
  minMessagesInChat: number;
  embeddingsBuilt: boolean;
}

/** Embedding stats */
export interface EmbeddingStats {
  indexed: number;
  total: number;
}

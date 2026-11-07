// Store types

import type { Chat, Message, Seed } from "../types/index.js";

/** Input to create a DataStore */
export interface StoreInput {
  chats: Chat[];
  messages: Message[];
  seed: Seed;
}

/** Stats about the store */
export interface StoreStats {
  totalChats: number;
  totalMessages: number;
  avgMessagesPerChat: number;
}

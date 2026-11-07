// DataStore - indexed access to chats/messages/seed

import type { Chat, Message, Seed } from "../types/index.js";
import type { StoreInput, StoreStats } from "./types.js";

export class DataStore {
  readonly chats: Chat[];
  readonly messages: Message[];
  readonly seed: Seed;

  private readonly _messagesByChat: Map<string, Message[]>;
  private readonly _messagesById: Map<string, Message>;
  private readonly _chatById: Map<string, Chat>;

  constructor(input: StoreInput) {
    this.chats = input.chats;
    this.messages = input.messages;
    this.seed = input.seed;

    this._messagesByChat = new Map();
    this._messagesById = new Map();
    this._chatById = new Map();

    // Build indexes
    for (const chat of this.chats) {
      this._chatById.set(chat.chat_id, chat);
    }

    for (const msg of this.messages) {
      this._messagesById.set(msg.id, msg);
      const chatMsgs = this._messagesByChat.get(msg.chat_id) ?? [];
      chatMsgs.push(msg);
      this._messagesByChat.set(msg.chat_id, chatMsgs);
    }

    // Sort messages by timestamp
    for (const msgs of this._messagesByChat.values()) {
      msgs.sort((a, b) => a.ts - b.ts);
    }
  }

  getChat(chatId: string): Chat | undefined {
    return this._chatById.get(chatId);
  }

  getMessage(msgId: string): Message | undefined {
    return this._messagesById.get(msgId);
  }

  getMessages(chatId: string): Message[] {
    return this._messagesByChat.get(chatId) ?? [];
  }

  /** Keyword search (case-insensitive) */
  searchMessages(query: string, chatId?: string): Message[] {
    const q = query.toLowerCase();
    const chats = chatId ? [chatId] : Array.from(this._messagesByChat.keys());
    const results: Message[] = [];
    
    for (const cid of chats) {
      for (const msg of this._messagesByChat.get(cid) ?? []) {
        if (msg.body.toLowerCase().includes(q)) {
          results.push(msg);
        }
      }
    }
    return results;
  }

  /** Get context around a message */
  getContext(msgId: string, before = 3, after = 3): Message[] {
    const msg = this._messagesById.get(msgId);
    if (!msg) return [];
    
    const messages = this._messagesByChat.get(msg.chat_id) ?? [];
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx === -1) return [];
    
    return messages.slice(Math.max(0, idx - before), idx + after + 1);
  }

  getKnownCircle(personId: string): string | undefined {
    return this.seed.circles[personId];
  }

  get stats(): StoreStats {
    return {
      totalChats: this.chats.length,
      totalMessages: this.messages.length,
      avgMessagesPerChat: this.messages.length / (this.chats.length || 1),
    };
  }
}

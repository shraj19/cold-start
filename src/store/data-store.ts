// Core DataStore - structured queries only (no vector/embedding deps)

import type { Chat, Message, Seed } from "../types/index.js";
import type { StoreInput, StoreStats } from "./types.js";

export class DataStore {
  // Raw data
  readonly chats: Chat[];
  readonly messages: Message[];
  readonly seed: Seed;

  // Indexes
  protected readonly _messagesByChat: Map<string, Message[]>;
  protected readonly _messagesById: Map<string, Message>;
  protected readonly _chatById: Map<string, Chat>;
  protected readonly _chatIdByMsgId: Map<string, string>;
  protected readonly _participantsByChat: Map<string, Set<string>>;

  constructor(input: StoreInput) {
    this.chats = input.chats;
    this.messages = input.messages;
    this.seed = input.seed;

    this._messagesByChat = new Map();
    this._messagesById = new Map();
    this._chatById = new Map();
    this._chatIdByMsgId = new Map();
    this._participantsByChat = new Map();

    this._buildIndexes();
  }

  private _buildIndexes(): void {
    // Index chats
    for (const chat of this.chats) {
      this._chatById.set(chat.chat_id, chat);
      this._participantsByChat.set(chat.chat_id, new Set(chat.participants));
    }

    // Index messages
    for (const msg of this.messages) {
      this._messagesById.set(msg.id, msg);

      const chatMsgs = this._messagesByChat.get(msg.chat_id) ?? [];
      chatMsgs.push(msg);
      this._messagesByChat.set(msg.chat_id, chatMsgs);

      this._chatIdByMsgId.set(msg.id, msg.chat_id);
    }

    // Sort messages by timestamp
    for (const msgs of this._messagesByChat.values()) {
      msgs.sort((a, b) => a.ts - b.ts);
    }
  }

  // ============================================================
  // Chat queries
  // ============================================================

  getChat(chatId: string): Chat | undefined {
    return this._chatById.get(chatId);
  }

  getChatByMessageId(msgId: string): Chat | undefined {
    const chatId = this._chatIdByMsgId.get(msgId);
    return chatId ? this._chatById.get(chatId) : undefined;
  }

  getParticipants(chatId: string): string[] {
    const participants = this._participantsByChat.get(chatId);
    return participants ? Array.from(participants) : [];
  }

  // ============================================================
  // Message queries
  // ============================================================

  getMessage(msgId: string): Message | undefined {
    return this._messagesById.get(msgId);
  }

  getMessages(chatId: string): Message[] {
    return this._messagesByChat.get(chatId) ?? [];
  }

  getChatIdForMessage(msgId: string): string | undefined {
    return this._chatIdByMsgId.get(msgId);
  }

  getMessageContext(msgId: string, before = 5, after = 5): Message[] {
    const chatId = this._chatIdByMsgId.get(msgId);
    if (!chatId) return [];

    const messages = this._messagesByChat.get(chatId) ?? [];
    const index = messages.findIndex((m) => m.id === msgId);
    if (index === -1) return [];

    const start = Math.max(0, index - before);
    const end = Math.min(messages.length, index + after + 1);
    return messages.slice(start, end);
  }

  getMessageWindow(chatId: string, startIndex: number, count: number): Message[] {
    const messages = this._messagesByChat.get(chatId) ?? [];
    return messages.slice(startIndex, startIndex + count);
  }

  /** Keyword search (case-insensitive substring) */
  searchMessages(query: string, chatIds?: string[]): Message[] {
    const lowerQuery = query.toLowerCase();
    const results: Message[] = [];
    const chatsToSearch = chatIds ?? Array.from(this._messagesByChat.keys());

    for (const chatId of chatsToSearch) {
      const messages = this._messagesByChat.get(chatId) ?? [];
      for (const msg of messages) {
        if (msg.body.toLowerCase().includes(lowerQuery)) {
          results.push(msg);
        }
      }
    }
    return results;
  }

  /** Regex search */
  searchMessagesRegex(pattern: RegExp, chatIds?: string[]): Message[] {
    const results: Message[] = [];
    const chatsToSearch = chatIds ?? Array.from(this._messagesByChat.keys());

    for (const chatId of chatsToSearch) {
      const messages = this._messagesByChat.get(chatId) ?? [];
      for (const msg of messages) {
        if (pattern.test(msg.body)) {
          results.push(msg);
        }
      }
    }
    return results;
  }

  // ============================================================
  // Batching helpers
  // ============================================================

  getChatBatches(batchSize: number): Chat[][] {
    if (batchSize <= 0) return [this.chats];

    const batches: Chat[][] = [];
    for (let i = 0; i < this.chats.length; i += batchSize) {
      batches.push(this.chats.slice(i, i + batchSize));
    }
    return batches;
  }

  getChatsByMessageCount(descending = true): Chat[] {
    return [...this.chats].sort((a, b) => {
      const countA = this._messagesByChat.get(a.chat_id)?.length ?? 0;
      const countB = this._messagesByChat.get(b.chat_id)?.length ?? 0;
      return descending ? countB - countA : countA - countB;
    });
  }

  getBalancedBatches(batchCount: number): Chat[][] {
    if (batchCount <= 0) return [];

    const sorted = this.getChatsByMessageCount(true);
    const batches: Chat[][] = [];
    const batchSizes: number[] = [];

    // Initialize batches
    for (let i = 0; i < batchCount; i++) {
      batches.push([]);
      batchSizes.push(0);
    }

    // Greedy assignment
    for (const chat of sorted) {
      const msgCount = this._messagesByChat.get(chat.chat_id)?.length ?? 0;

      // Find smallest batch
      let smallestIdx = 0;
      let smallestSize = batchSizes[0] ?? 0;
      for (let i = 1; i < batchSizes.length; i++) {
        const size = batchSizes[i] ?? 0;
        if (size < smallestSize) {
          smallestSize = size;
          smallestIdx = i;
        }
      }

      // Add to smallest batch
      const batch = batches[smallestIdx];
      if (batch) {
        batch.push(chat);
        batchSizes[smallestIdx] = (batchSizes[smallestIdx] ?? 0) + msgCount;
      }
    }

    return batches.filter((b) => b.length > 0);
  }

  // ============================================================
  // Statistics
  // ============================================================

  get stats(): StoreStats {
    const msgCounts = Array.from(this._messagesByChat.values()).map((m) => m.length);
    return {
      totalChats: this.chats.length,
      totalMessages: this.messages.length,
      totalParticipants: new Set(this.chats.flatMap((c) => c.participants)).size,
      messagesPerChat: Object.fromEntries(
        Array.from(this._messagesByChat.entries()).map(([id, msgs]) => [id, msgs.length])
      ),
      avgMessagesPerChat: this.messages.length / (this.chats.length || 1),
      maxMessagesInChat: msgCounts.length > 0 ? Math.max(...msgCounts) : 0,
      minMessagesInChat: msgCounts.length > 0 ? Math.min(...msgCounts) : 0,
      embeddingsBuilt: false, // Override in VectorStore
    };
  }

  // ============================================================
  // Seed data helpers
  // ============================================================

  getKnownCircle(personId: string): string | undefined {
    return this.seed.circles[personId];
  }

  getKnownOrganisations(): string[] {
    return this.seed.organisations;
  }

  getKnownGoals(): typeof this.seed.goals {
    return this.seed.goals;
  }

  isPersonKnown(personId: string): boolean {
    return personId in this.seed.circles;
  }
}

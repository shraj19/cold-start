// VectorStore - extends DataStore with semantic search capabilities

import { embed, embedMany } from "ai";
import { openai } from "@ai-sdk/openai";
import type { Message } from "../types/index.js";
import type { SemanticSearchOptions, SearchResult, EmbeddingStats, StoreInput } from "./types.js";
import { DataStore } from "./data-store.js";
import { cosine, chunk } from "./utils.js";

export class VectorStore extends DataStore {
  // Vector index (lazy-loaded)
  private _embeddings: Map<string, number[]> | null = null;
  private _embeddingModel = openai.embedding("text-embedding-3-small");
  private _isIndexing = false;

  constructor(input: StoreInput) {
    super(input);
  }

  // ============================================================
  // Embedding state
  // ============================================================

  get hasEmbeddings(): boolean {
    return this._embeddings !== null;
  }

  get embeddingStats(): EmbeddingStats | null {
    if (!this._embeddings) return null;
    return { indexed: this._embeddings.size, total: this.messages.length };
  }

  override get stats() {
    return {
      ...super.stats,
      embeddingsBuilt: this._embeddings !== null,
    };
  }

  // ============================================================
  // Build embeddings
  // ============================================================

  /**
   * Build embeddings for all messages
   * Called automatically by semantic search, or call explicitly for control
   */
  async buildEmbeddings(onProgress?: (done: number, total: number) => void): Promise<void> {
    if (this._embeddings || this._isIndexing) return;

    this._isIndexing = true;
    this._embeddings = new Map();

    const BATCH_SIZE = 2000; // OpenAI limit
    const batches = chunk(this.messages, BATCH_SIZE);
    let done = 0;

    console.error(`Building embeddings for ${this.messages.length} messages...`);

    for (const batch of batches) {
      // Filter out empty messages
      const validMessages = batch.filter((m) => m.body.trim().length > 0);

      if (validMessages.length === 0) {
        done += batch.length;
        continue;
      }

      const { embeddings } = await embedMany({
        model: this._embeddingModel,
        values: validMessages.map((m) => m.body),
      });

      for (let i = 0; i < validMessages.length; i++) {
        const msg = validMessages[i];
        const vec = embeddings[i];
        if (msg && vec) {
          this._embeddings.set(msg.id, vec);
        }
      }

      done += batch.length;
      onProgress?.(done, this.messages.length);
      console.error(`  Embedded ${done}/${this.messages.length} messages`);
    }

    this._isIndexing = false;
    console.error(`Embeddings complete: ${this._embeddings.size} vectors`);
  }

  // ============================================================
  // Semantic search
  // ============================================================

  /**
   * Search messages by meaning (builds embeddings on first call)
   */
  async semanticSearch(query: string, options: SemanticSearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 10, chatIds, senderIds, minScore = 0 } = options;

    // Build embeddings lazily
    if (!this._embeddings) {
      await this.buildEmbeddings();
    }

    // Get query embedding
    const { embedding: queryVector } = await embed({
      model: this._embeddingModel,
      value: query,
    });

    // Score all messages
    const scores: SearchResult[] = [];

    for (const msg of this.messages) {
      // Apply filters
      if (chatIds && !chatIds.includes(msg.chat_id)) continue;
      if (senderIds && !senderIds.includes(msg.sender_id)) continue;

      const msgVector = this._embeddings!.get(msg.id);
      if (!msgVector) continue;

      const score = cosine(queryVector, msgVector);
      if (score >= minScore) {
        scores.push({ message: msg, score });
      }
    }

    return scores.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Find messages similar to a given message
   */
  async findSimilar(msgId: string, options: SemanticSearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 10, chatIds, senderIds, minScore = 0 } = options;

    if (!this._embeddings) {
      await this.buildEmbeddings();
    }

    const sourceVector = this._embeddings!.get(msgId);
    if (!sourceVector) return [];

    const scores: SearchResult[] = [];

    for (const msg of this.messages) {
      if (msg.id === msgId) continue;
      if (chatIds && !chatIds.includes(msg.chat_id)) continue;
      if (senderIds && !senderIds.includes(msg.sender_id)) continue;

      const msgVector = this._embeddings!.get(msg.id);
      if (!msgVector) continue;

      const score = cosine(sourceVector, msgVector);
      if (score >= minScore) {
        scores.push({ message: msg, score });
      }
    }

    return scores.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Hybrid search: keyword boost + semantic
   */
  async hybridSearch(
    query: string,
    options: SemanticSearchOptions & { keywordWeight?: number } = {}
  ): Promise<SearchResult[]> {
    const { limit = 10, keywordWeight = 0.3, ...semanticOptions } = options;

    // Get keyword matches
    const keywordMatches = new Set(
      this.searchMessages(query, semanticOptions.chatIds).map((m) => m.id)
    );

    // Get semantic matches
    const semanticResults = await this.semanticSearch(query, {
      ...semanticOptions,
      limit: limit * 2,
    });

    // Boost keyword matches
    const boosted = semanticResults.map((r) => ({
      message: r.message,
      score: keywordMatches.has(r.message.id) ? r.score + keywordWeight : r.score,
    }));

    return boosted.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

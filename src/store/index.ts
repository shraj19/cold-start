// Store module - re-exports everything

export { DataStore } from "./data-store.js";
export { VectorStore } from "./vector-store.js";
export { cosine, chunk } from "./utils.js";
export type {
  StoreInput,
  SemanticSearchOptions,
  SearchResult,
  StoreStats,
  EmbeddingStats,
} from "./types.js";

// Factory functions
import type { StoreInput } from "./types.js";
import { DataStore } from "./data-store.js";
import { VectorStore } from "./vector-store.js";

/** Create a basic DataStore (no vector search) */
export function createStore(input: StoreInput): DataStore {
  return new DataStore(input);
}

/** Create a VectorStore (with semantic search capabilities) */
export function createVectorStore(input: StoreInput): VectorStore {
  return new VectorStore(input);
}

// IO module - file reading, writing, and store creation

// Types
export type { Input, RawInput, ExampleData } from "./types.js";

// Reading
export { readInput, readRawInput } from "./read.js";

// Writing
export { writeOutput } from "./write.js";

// Store creation
export { loadStore } from "./store.js";

// Example loading
export { loadExample } from "./example.js";

// Re-export store types for convenience
export {
  DataStore,
  VectorStore,
  createStore,
  createVectorStore,
  type StoreInput,
  type SemanticSearchOptions,
  type SearchResult,
  type StoreStats,
  type EmbeddingStats,
} from "../store/index.js";

// IO module - file reading, writing, and store creation

// Types
export type { Input, RawInput, ExampleData } from "./types.js";

// Reading
export { readInput, readRawInput } from "./read.js";

// Writing
export { writeOutput } from "./write.js";

// Example loading
export { loadExample } from "./example.js";

// Re-export store types for convenience
export {
  DataStore,
  createStore,
  type StoreInput,
  type StoreStats,
} from "../store/index.js";

// Store module - DataStore for message/chat access

export { DataStore } from "./data-store.js";
export type { StoreInput, StoreStats } from "./types.js";

import type { StoreInput } from "./types.js";
import { DataStore } from "./data-store.js";

/** Create a DataStore */
export function createStore(input: StoreInput): DataStore {
  return new DataStore(input);
}

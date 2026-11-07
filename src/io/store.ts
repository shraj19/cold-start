// Store creation from input directory

import { readInput } from "./read.js";
import { DataStore, createStore } from "../store/index.js";

/** Read input and create a DataStore */
export function loadStore(inputDir: string): DataStore {
  const input = readInput(inputDir);
  return createStore(input);
}

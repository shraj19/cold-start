// Store creation from input directory

import { readInput } from "./read.js";
import { VectorStore, createVectorStore } from "../store/index.js";

/** Read input and create a VectorStore */
export function loadStore(inputDir: string): VectorStore {
  const input = readInput(inputDir);
  return createVectorStore(input);
}

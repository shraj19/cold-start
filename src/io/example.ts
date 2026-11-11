// Example data loading for few-shot learning

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Output } from "../types/index.js";
import type { ExampleData } from "./types.js";
import { readRawInput, readInput } from "./read.js";
import { createStore } from "../store/index.js";

/**
 * Load example data with expected output (for few-shot learning)
 * Expects: inputDir/answers/answers.json
 */
export function loadExample(inputDir: string): ExampleData | null {
  const outputPath = join(inputDir, "answers", "answers.json");

  if (!existsSync(outputPath)) {
    console.error(`  No example output at ${outputPath}`);
    return null;
  }

  try {
    const input = readInput(inputDir);
    const store = createStore(input);
    const raw = readRawInput(inputDir);
    const outputText = readFileSync(outputPath, "utf-8");
    const output = JSON.parse(outputText) as Output;
    return { store, output, raw, outputText };
  } catch (err) {
    console.error(`  Failed to load example: ${err}`);
    return null;
  }
}

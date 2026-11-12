// Main entry point - extraction pipeline

import { readInput } from "./io/read.js";
import { writeOutput } from "./io/write.js";
import { extract } from "./extract/index.js";

// ============================================================
// Configuration - change these for testing/tuning
// ============================================================
const THINKING_MODE = 'enabled' as const;  // 'enabled' | 'disabled'
const THINKING_OUTPUT_FILE: string | undefined = undefined;  // set to 'thinking.txt' for local debugging
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error("Usage: npx tsx src/main.ts <input_dir> <output.json>");
    process.exit(2);
  }

  const [inputDir, outputPath] = args;

  try {
    // Read input
    console.error(`Reading from ${inputDir}...`);
    const input = readInput(inputDir!);

    // Run extraction
    const output = await extract(input.chats, input.messages, input.seed, {
      thinkingMode: THINKING_MODE,
      thinkingOutputFile: THINKING_OUTPUT_FILE,
    });

    // Write output
    writeOutput(outputPath!, output);
    console.error(`Output written to ${outputPath}`);
    
    // Explicit success exit
    process.exit(0);

  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();

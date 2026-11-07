// Main entry point - 2-pass extraction

import { readInput } from "./io/read.js";
import { writeOutput } from "./io/write.js";
import { extract } from "./extract/index.js";

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error("Usage: npx tsx src/main.ts <input_dir> <output.json>");
    console.error("");
    console.error("Example:");
    console.error("  npx tsx src/main.ts example output.json");
    console.error("  npx tsx src/main.ts dev output.json");
    process.exit(2);
  }

  const [inputDir, outputPath] = args;

  try {
    // Read input
    console.error(`Reading from ${inputDir}...`);
    const input = readInput(inputDir!);

    // Run extraction
    const output = await extract(input.chats, input.messages, input.seed);

    // Write output
    writeOutput(outputPath!, output);
    console.error(`Output written to ${outputPath}`);

  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();

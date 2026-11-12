// Main entry point - extraction with optional few-shot learning

import { readInput } from "./io/read.js";
import { writeOutput } from "./io/write.js";
import { loadExample } from "./io/example.js";
import { extract } from "./extract/index.js";

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error("Usage: npx tsx src/main.ts <input_dir> <output.json> [--few-shot <example_dir>]");
    console.error("");
    console.error("Example:");
    console.error("  npx tsx src/main.ts dev output.json");
    console.error("  npx tsx src/main.ts dev output.json --few-shot example");
    process.exit(2);
  }

  const [inputDir, outputPath, ...rest] = args;
  
  // Check for --few-shot flag
  let exampleDir: string | undefined;
  const fewShotIndex = rest.indexOf('--few-shot');
  if (fewShotIndex !== -1 && rest[fewShotIndex + 1]) {
    exampleDir = rest[fewShotIndex + 1];
  }

  try {
    // Read input
    console.error(`Reading from ${inputDir}...`);
    const input = readInput(inputDir!);

    // Optionally load few-shot example
    let exampleData;
    if (exampleDir) {
      console.error(`Loading few-shot example from ${exampleDir}...`);
      exampleData = loadExample(exampleDir);
      if (!exampleData) {
        console.error(`Warning: Could not load example from ${exampleDir}, continuing without few-shot`);
      }
    }

    // Run extraction (with optional few-shot)
    const output = await extract(input.chats, input.messages, input.seed, exampleData ?? undefined);

    // Write output
    writeOutput(outputPath!, output);
    console.error(`Output written to ${outputPath}`);

  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();

// V2 Batched - CLI entry point

import { writeFileSync } from "node:fs";
import { readInput } from "../io/read.js";
import { runV2 } from "./index.js";

function printUsage(): void {
  console.error("Usage: npx tsx src/v2-batched/main.ts <input_dir> <output.json>");
  console.error("");
  console.error("Arguments:");
  console.error("  input_dir    Directory containing chats.jsonl, messages.jsonl, seed.json");
  console.error("  output.json  Path to write the output file");
  console.error("");
  console.error("Example:");
  console.error("  npx tsx src/v2-batched/main.ts example output.json");
  console.error("  npx tsx src/v2-batched/main.ts dev output.json");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    printUsage();
    process.exit(2);
  }
  
  const [inputDir, outputPath] = args;
  
  if (!inputDir || !outputPath) {
    printUsage();
    process.exit(2);
  }
  
  try {
    // Load input data
    console.error(`Loading data from ${inputDir}...`);
    const { chats, messages, seed } = readInput(inputDir);
    
    // Run V2
    const output = await runV2(chats, messages, seed);
    
    // Write output
    writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.error(`\nWrote output to ${outputPath}`);
    
  } catch (error) {
    console.error(`\nError: ${error instanceof Error ? error.message : error}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();

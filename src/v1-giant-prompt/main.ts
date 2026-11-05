// V1 entry point - giant prompt approach

import { readRawInput, writeOutput } from "../io/index.js";
import { runV1 } from "./index.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Usage: npx tsx src/v1-giant-prompt/main.ts <input_dir> <output.json> [options]");
    console.error("");
    console.error("Arguments:");
    console.error("  input_dir    Directory with chats.jsonl, messages.jsonl, seed.json");
    console.error("  output.json  Output file path");
    console.error("");
    console.error("Options:");
    console.error("  --example <dir>     Directory with example data for few-shot learning");
    console.error("  --max-messages <n>  Max messages to include (default: all)");
    console.error("");
    console.error("Example:");
    console.error("  npx tsx src/v1-giant-prompt/main.ts dev out.json --example example --max-messages 2000");
    process.exit(2);
  }

  const [inputDir, outputPath, ...rest] = args;

  if(!inputDir || !outputPath) {
    console.error("Error: input_dir and output.json are required arguments.");
    process.exit(2);
  }

  // Parse options
  let exampleDir: string | undefined;
  let maxMessages: number | undefined;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const next = rest[i + 1];
    if (arg === "--example" && next) {
      exampleDir = next;
      i++;
    } else if (arg === "--max-messages" && next) {
      maxMessages = parseInt(next, 10);
      i++;
    }
  }

  console.error(`Loading raw data from ${inputDir}...`);
  const raw = readRawInput(inputDir);

  const output = await runV1(raw, { exampleDir, maxMessages });

  writeOutput(outputPath, output);
  console.error(`\nWrote output to ${outputPath}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

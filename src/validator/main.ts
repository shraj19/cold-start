// Validator CLI - check and score outputs

import { check, formatResult } from "./index.js";

function main(): void {
  const args = process.argv.slice(2);

  if (args.length !== 2) {
    console.error("Usage: npx tsx src/validator/main.ts <input_dir> <output.json>");
    console.error("");
    console.error("Arguments:");
    console.error("  input_dir    Directory with chats.jsonl, messages.jsonl, seed.json");
    console.error("               If it has answers/answers.json, the output is scored.");
    console.error("  output.json  The output file to validate/score");
    console.error("");
    console.error("Example:");
    console.error("  npx tsx src/validator/main.ts example out.json");
    process.exit(2);
  }

  const [inputDir, outputPath] = args;

  if (!inputDir || !outputPath) {
    console.error("Error: Both input_dir and output.json are required.");
    process.exit(2);
  }

  const result = check(inputDir, outputPath);
  console.log(formatResult(result));

  // Exit with error if validation failed
  if (!result.validation.valid) {
    process.exit(1);
  }
}

main();

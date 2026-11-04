// Entry point for multi-pass extraction
// Usage: tsx src/main-multipass.ts <input_dir> <output.json> [example_dir]

import { readInput, writeOutput } from "./io.js";
import { runPipeline } from "./multi-pass/index.js";

async function main(): Promise<void> {
  const [inputDir, outputPath, exampleDir] = process.argv.slice(2);
  if (!inputDir || !outputPath) {
    console.error("usage: tsx src/main-multipass.ts <input_dir> <output.json> [example_dir]");
    console.error("");
    console.error("  example_dir: Optional path to example data with answers/ folder");
    console.error("               Used for few-shot learning to improve accuracy");
    process.exit(2);
  }

  const input = readInput(inputDir);
  console.error(`Loaded ${input.chats.length} chats, ${input.messages.length} messages`);

  const result = await runPipeline(input.chats, input.messages, input.seed, {
    concurrency: 2, // Low concurrency for rate-limited APIs
    delayMs: 5000, // 5 second delay between batches (Gemini free tier: 15 req/min)
    skipPass3: false,
    exampleDir: exampleDir || undefined,
  });

  writeOutput(outputPath, result.output);

  console.error("\n=== SUMMARY ===");
  console.error(`Chats: ${result.stats.totalChats}`);
  console.error(`Messages: ${result.stats.totalMessages}`);
  console.error(`People: ${result.stats.totalPeople}`);
  console.error(`Investigations: ${result.stats.investigationsRequested}`);
  console.error(`Used examples: ${result.stats.usedExamples}`);
  console.error(`Time: Pass1=${(result.stats.pass1Time / 1000).toFixed(1)}s, Pass2=${(result.stats.pass2Time / 1000).toFixed(1)}s, Pass3=${(result.stats.pass3Time / 1000).toFixed(1)}s`);
  console.error(`\nWrote ${result.output.people.length} people, ${result.output.organisations.length} orgs, ${result.output.chats.length} chats, ${result.output.goals.length} goals, ${result.output.open_loops.length} loops to ${outputPath}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

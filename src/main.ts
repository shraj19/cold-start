// Entry point. Usage: tsx src/main.ts <input_dir> <output.json>

import { readInput, writeOutput } from "./io.js";
import { extractHybrid } from "./extractors/hybrid.js";

async function main(): Promise<void> {
  const [inputDir, outputPath] = process.argv.slice(2);
  if (!inputDir || !outputPath) {
    console.error("usage: tsx src/main.ts <input_dir> <output.json>");
    process.exit(2);
  }

  const input = readInput(inputDir);
  console.error(`Loaded ${input.chats.length} chats, ${input.messages.length} messages`);

  // Hybrid extraction: rules first, LLM only for judgment
  const output = await extractHybrid(input.chats, input.messages, input.seed);

  writeOutput(outputPath, output);

  console.error(
    `Wrote ${output.people.length} people, ${output.organisations.length} orgs, ` +
      `${output.chats.length} chats, ${output.goals.length} goals, ` +
      `${output.open_loops.length} open loops to ${outputPath}`,
  );
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

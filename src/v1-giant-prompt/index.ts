// V1 Solution: Giant prompt approach
// Sends ALL messages in one prompt, extracts everything at once
// Prompt structure: Important instructions → Raw data → Reminder instructions
// Uses raw text directly to avoid parse/serialize roundtrip

import { generate } from "../llm/index.js";
import { outputSchema, type Output } from "../types/index.js";
import { loadExample, type RawInput, type ExampleData } from "../io/index.js";
import { SYSTEM_PROMPT, EXTRACTION_RULES, OUTPUT_REMINDER } from "./prompt.js";

export interface V1Options {
  /** Path to example data for few-shot learning */
  exampleDir?: string;
  /** Max messages to include (default: all) */
  maxMessages?: number;
  /** Max messages from example (default: 100) */
  exampleMaxMessages?: number;
}

/**
 * Run V1 extraction - single giant prompt
 * @param raw - Raw input text (from readRawInput)
 */
export async function runV1(raw: RawInput, options: V1Options = {}): Promise<Output> {
  const { exampleDir, maxMessages, exampleMaxMessages = 100 } = options;

  const msgLines = raw.messagesText.split("\n").filter((l) => l.trim());
  const chatLines = raw.chatsText.split("\n").filter((l) => l.trim());

  console.error(`V1: Giant prompt approach`);
  console.error(`  ${chatLines.length} chats, ${msgLines.length} messages`);

  // Truncate if needed - take NEWEST messages (most relevant for open loops)
  let inputRaw = raw;
  if (maxMessages && msgLines.length > maxMessages) {
    console.error(`  Truncating to ${maxMessages} NEWEST messages (dropping ${msgLines.length - maxMessages} oldest)`);
    inputRaw = {
      ...raw,
      messagesText: msgLines.slice(-maxMessages).join("\n"),  // Take from END
    };
  }

  // Load few-shot example if provided
  let example: ExampleData | null = null;
  if (exampleDir) {
    console.error(`  Loading example from ${exampleDir}...`);
    example = loadExample(exampleDir);
    if (example) {
      const exMsgLines = example.raw.messagesText.split("\n").filter((l) => l.trim());
      console.error(`  Example loaded: ${exMsgLines.length} messages`);

      // Truncate example messages
      if (exMsgLines.length > exampleMaxMessages) {
        example = {
          ...example,
          raw: {
            ...example.raw,
            messagesText: exMsgLines.slice(0, exampleMaxMessages).join("\n"),
          },
        };
        console.error(`  Example truncated to ${exampleMaxMessages} messages`);
      }
    }
  }

  const prompt = buildPrompt(inputRaw, example);
  console.error(`  Prompt size: ~${Math.round(prompt.length / 4)} tokens`);

  const result = await generate(prompt, outputSchema, {
    system: SYSTEM_PROMPT,
    temperature: 0,
  });

  console.error(`  Done: ${result.people.length} people, ${result.open_loops.length} loops`);
  return result;
}

/**
 * Build prompt with structure: Instructions → Example → Data → Reminder
 * (LLMs lose attention in the middle, so important stuff at start/end)
 */
function buildPrompt(raw: RawInput, example: ExampleData | null): string {
  const sections: string[] = [];

  // ===== START: Important instructions =====
  sections.push(EXTRACTION_RULES);

  // ===== MIDDLE: Raw data (LLM pays less attention here) =====

  // Few-shot example (if any)
  if (example) {
    sections.push("\n" + "=".repeat(60));
    sections.push("EXAMPLE INPUT:");
    sections.push("=".repeat(60) + "\n");
    sections.push(formatRawInput(example.raw));
    sections.push("\n" + "=".repeat(60));
    sections.push("EXAMPLE OUTPUT:");
    sections.push("=".repeat(60) + "\n");
    sections.push(example.outputText);
  }

  // Actual input data
  sections.push("\n" + "=".repeat(60));
  sections.push("ACTUAL INPUT DATA TO EXTRACT FROM:");
  sections.push("=".repeat(60) + "\n");
  sections.push(formatRawInput(raw));

  // ===== END: Reminder of important instructions =====
  sections.push("\n" + "=".repeat(60));
  sections.push(OUTPUT_REMINDER);

  return sections.join("\n");
}

/**
 * Format raw input for prompt (minimal processing)
 */
function formatRawInput(raw: RawInput): string {
  return `SEED DATA (use as ground truth):
${raw.seedText}

CHATS (JSONL - one chat per line):
${raw.chatsText}

MESSAGES (JSONL - one message per line):
${raw.messagesText}`;
}

// Reading the input folder and writing output.json. Standard library only.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Chat, Message, Seed, Output } from "./types.js";

function readJsonl<T>(path: string): T[] {
  const text = readFileSync(path, "utf-8");
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) out.push(JSON.parse(trimmed) as T);
  }
  return out;
}

export interface Input {
  chats: Chat[];
  messages: Message[];
  seed: Seed;
}

export function readInput(inputDir: string): Input {
  const chats = readJsonl<Chat>(join(inputDir, "chats.jsonl"));
  const messages = readJsonl<Message>(join(inputDir, "messages.jsonl"));
  const seed = JSON.parse(
    readFileSync(join(inputDir, "seed.json"), "utf-8"),
  ) as Seed;
  return { chats, messages, seed };
}

export function writeOutput(outputPath: string, output: Output): void {
  writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");
}

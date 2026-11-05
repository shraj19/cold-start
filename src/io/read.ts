// Reading input files

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Chat, Message, Seed } from "../types/index.js";
import type { Input, RawInput } from "./types.js";

/** Parse JSONL file into array */
function readJsonl<T>(path: string): T[] {
  const text = readFileSync(path, "utf-8");
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) out.push(JSON.parse(trimmed) as T);
  }
  return out;
}

/** Read and parse input files from directory */
export function readInput(inputDir: string): Input {
  const chats = readJsonl<Chat>(join(inputDir, "chats.jsonl"));
  const messages = readJsonl<Message>(join(inputDir, "messages.jsonl"));
  const seed = JSON.parse(readFileSync(join(inputDir, "seed.json"), "utf-8")) as Seed;
  return { chats, messages, seed };
}

/** Read raw text files (no parsing) - for direct use in prompts */
export function readRawInput(inputDir: string): RawInput {
  return {
    chatsText: readFileSync(join(inputDir, "chats.jsonl"), "utf-8"),
    messagesText: readFileSync(join(inputDir, "messages.jsonl"), "utf-8"),
    seedText: readFileSync(join(inputDir, "seed.json"), "utf-8"),
  };
}

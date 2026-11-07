// IO-specific types

import type { Chat, Message, Seed, Output } from "../types/index.js";
import type { DataStore } from "../store/index.js";

/** Parsed input data */
export interface Input {
  chats: Chat[];
  messages: Message[];
  seed: Seed;
}

/** Raw text input (no parsing) */
export interface RawInput {
  chatsText: string;
  messagesText: string;
  seedText: string;
}

/** Example data for few-shot learning */
export interface ExampleData {
  store: DataStore;
  output: Output;
  raw: RawInput;
  outputText: string;
}

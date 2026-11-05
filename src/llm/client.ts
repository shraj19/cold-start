// LLM client - simple model creation from env

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { env } from "../env.js";

// Create model from env (created once at import time)
const provider = createOpenAI({
  baseURL: env.LLM_BASE_URL,
  apiKey: env.LLM_API_KEY,
});

export const model: LanguageModel = provider.chat(env.LLM_MODEL);

// Export env values for logging
export const modelName = env.LLM_MODEL;

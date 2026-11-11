// LLM client - OpenAI-compatible API (works with OpenRouter, Gemini via OpenRouter, etc.)

import { createOpenAI } from "@ai-sdk/openai";
import { env } from "../env.js";

function buildModel() {
  const openai = createOpenAI({
    baseURL: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
  });
  console.error(`  [LLM] ${env.LLM_MODEL} via ${env.LLM_BASE_URL}`);
  return openai.chat(env.LLM_MODEL);
}

/** Model from environment variables */
export const model = buildModel();

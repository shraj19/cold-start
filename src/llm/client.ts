// LLM client - OpenAI-compatible provider

import { createOpenAI } from "@ai-sdk/openai";
import { env } from "../env.js";

const provider = createOpenAI({
  baseURL: env.LLM_BASE_URL,
  apiKey: env.LLM_API_KEY,
});

/** Model from environment variables */
export const model = provider.chat(env.LLM_MODEL);

/** Model name for logging */
export const modelName = env.LLM_MODEL;

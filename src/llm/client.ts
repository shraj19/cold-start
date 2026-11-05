// LLM client - supports multiple providers with dynamic model creation

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { env } from "../env.js";

// ============================================================================
// Default model from env (current behavior)
// ============================================================================

const defaultProvider = createOpenAI({
  baseURL: env.LLM_BASE_URL,
  apiKey: env.LLM_API_KEY,
});

/** Default model from environment variables */
export const model: LanguageModel = defaultProvider.chat(env.LLM_MODEL);

/** Default model name for logging */
export const modelName = env.LLM_MODEL;

// ============================================================================
// Dynamic model creation
// ============================================================================

export interface ModelConfig {
  /** Base URL for the API (e.g., https://api.groq.com/openai/v1) */
  baseURL: string;
  /** API key */
  apiKey: string;
  /** Model identifier (e.g., llama-3.1-70b-versatile) */
  model: string;
}

/** Known provider presets */
export const PROVIDERS = {
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
  },
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    // Updated Nov 2026 - old llama models deprecated
    models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"],
  },
  openai: {
    baseURL: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  },
  together: {
    baseURL: "https://api.together.xyz/v1",
    models: ["meta-llama/Llama-3.1-70B-Instruct-Turbo", "mistralai/Mixtral-8x7B-Instruct-v0.1"],
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    models: ["meta-llama/llama-3.1-70b-instruct", "anthropic/claude-3.5-sonnet"],
  },
} as const;

export type ProviderName = keyof typeof PROVIDERS;

/**
 * Create a model with explicit configuration
 */
export function createModel(config: ModelConfig): LanguageModel {
  const provider = createOpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });
  return provider.chat(config.model);
}

/**
 * Create a model from a known provider preset
 */
export function createModelFromProvider(
  providerName: ProviderName,
  apiKey: string,
  modelName?: string
): LanguageModel {
  const preset = PROVIDERS[providerName];
  const model = modelName ?? preset.models[0];
  
  return createModel({
    baseURL: preset.baseURL,
    apiKey,
    model,
  });
}

/**
 * Create Groq model (convenience function)
 * Uses GROQ_API_KEY from env if no key provided
 */
export function createGroqModel(modelName?: string, apiKey?: string): LanguageModel {
  const key = apiKey ?? env.GROQ_API_KEY;
  if (!key) {
    throw new Error("GROQ_API_KEY not set in environment and no apiKey provided");
  }
  return createModelFromProvider("groq", key, modelName ?? "llama-3.1-70b-versatile");
}

/**
 * Create Gemini model (convenience function)
 */
export function createGeminiModel(modelName?: string, apiKey?: string): LanguageModel {
  const key = apiKey ?? env.LLM_API_KEY;
  return createModelFromProvider("gemini", key, modelName ?? "gemini-2.0-flash");
}

/**
 * Auto-select model based on available env vars
 * Priority: GROQ_API_KEY > LLM_API_KEY
 */
export function createAutoModel(): { model: LanguageModel; name: string; provider: string } {
  if (env.GROQ_API_KEY) {
    const name = "llama-3.1-70b-versatile";
    return {
      model: createGroqModel(name),
      name,
      provider: "groq",
    };
  }
  
  // Fall back to default from env
  return {
    model,
    name: env.LLM_MODEL,
    provider: "default",
  };
}

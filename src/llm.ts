// LLM client using Vercel AI SDK with OpenAI-compatible endpoint.
// Reads LLM_BASE_URL, LLM_API_KEY, LLM_MODEL from env (validated by env.ts).

import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { appendFileSync } from "node:fs";
import type { z } from "zod";
import { env } from "./env.js";

// Create OpenAI-compatible client (works with Gemini, Groq, OpenRouter, etc.)
const provider = createOpenAI({
  baseURL: env.LLM_BASE_URL,
  apiKey: env.LLM_API_KEY,
});

// Use .chat() to force Chat Completions API (not Responses API)
// Gemini's OpenAI-compatible endpoint only supports chat completions
const model = provider.chat(env.LLM_MODEL);

/** Export the model for direct use with generateText */
export function getModel() {
  return model;
}

// Usage logging (like the Python starter's usage.jsonl)
function logUsage(
  operation: string,
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined,
  durationMs: number,
): void {
  const entry = {
    model: env.LLM_MODEL,
    operation,
    prompt_tokens: usage?.inputTokens ?? null,
    completion_tokens: usage?.outputTokens ?? null,
    total_tokens: usage?.totalTokens ?? null,
    duration_ms: Math.round(durationMs),
    timestamp: new Date().toISOString(),
  };
  appendFileSync("usage.jsonl", JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Retry with exponential backoff for rate limit errors
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  baseDelayMs: number = 10000,
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if rate limit error (429)
      const isRateLimit = lastError.message.includes("429") || 
                          lastError.message.includes("Too Many Requests") ||
                          lastError.message.includes("rate limit");
      
      if (!isRateLimit || attempt === maxRetries) {
        throw new Error(`Failed after ${attempt + 1} attempts. Last error: ${lastError.message}`);
      }
      
      // Exponential backoff: 10s, 20s, 40s, 80s, 160s
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.error(`  Rate limited (attempt ${attempt + 1}/${maxRetries + 1}), waiting ${delay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Generate a structured object from a prompt using the LLM.
 * Uses AI SDK v6's generateText + Output.object() for type-safe, validated output.
 */
export async function generate<T>(
  prompt: string,
  schema: z.ZodType<T>,
  options?: {
    system?: string;
    temperature?: number;
  },
): Promise<T> {
  const start = Date.now();

  const result = await withRetry(async () => {
    return await generateText({
      model,
      output: Output.object({ schema }),
      prompt,
      system: options?.system,
      temperature: options?.temperature ?? 0,
    });
  });

  logUsage("generateText+Output.object", result.usage, Date.now() - start);

  // result.output is the typed object from Output.object()
  return result.output as T;
}

/**
 * Generate an array of structured objects.
 * Uses AI SDK v6's Output.array() for efficient array generation.
 */
export async function generateArray<T>(
  prompt: string,
  elementSchema: z.ZodType<T>,
  options?: {
    system?: string;
    temperature?: number;
  },
): Promise<T[]> {
  const start = Date.now();

  const result = await withRetry(async () => {
    return await generateText({
      model,
      output: Output.array({ element: elementSchema }),
      prompt,
      system: options?.system,
      temperature: options?.temperature ?? 0,
    });
  });

  logUsage("generateText+Output.array", result.usage, Date.now() - start);

  return result.output as T[];
}

/**
 * Generate plain text from a prompt (for non-structured responses).
 */
export async function generatePlainText(
  prompt: string,
  options?: {
    system?: string;
    temperature?: number;
  },
): Promise<string> {
  const start = Date.now();

  const result = await withRetry(async () => {
    return await generateText({
      model,
      prompt,
      system: options?.system,
      temperature: options?.temperature ?? 0,
    });
  });

  logUsage("generateText", result.usage, Date.now() - start);

  return result.text;
}

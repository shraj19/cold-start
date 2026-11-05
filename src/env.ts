// Type-safe environment variables using @t3-oss/env-core + Zod.
// Validates at import time — missing/invalid vars fail fast with clear errors.

// Load .env file FIRST, before anything checks process.env
import "dotenv/config";

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    // Any OpenAI-compatible endpoint (Gemini, OpenAI, Groq, OpenRouter, etc.)
    LLM_BASE_URL: z.string().min(1, "LLM_BASE_URL cannot be empty"),
    
    // API key for the LLM provider
    LLM_API_KEY: z.string().min(1, "LLM_API_KEY cannot be empty"),
    
    // Model identifier (e.g., "gemini-2.0-flash", "gpt-4o-mini")
    LLM_MODEL: z.string().min(1, "LLM_MODEL cannot be empty"),

    // Optional: Groq API key (if set, can use createGroqModel())
    GROQ_API_KEY: z.string().optional(),
    
    // Optional: DeepSeek API key
    DEEPSEEK_API_KEY: z.string().optional(),
    
    // Optional: Together AI API key
    TOGETHER_API_KEY: z.string().optional(),
    
    // Optional: OpenRouter API key  
    OPENROUTER_API_KEY: z.string().optional(),
  },
  
  // Tell the library where to find env vars (Node.js process.env)
  runtimeEnv: process.env,
  
  // Skip validation when not using LLM (e.g., naive baseline run)
  skipValidation: process.env["SKIP_ENV_VALIDATION"] === "true",
});

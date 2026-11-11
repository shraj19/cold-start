// LLM generation with structured output

import { generateText, Output } from "ai";
import { z } from "zod";
import { model } from "./client.js";
import { withRetry } from "./retry.js";

export interface GenerateOptions {
  system?: string;
  temperature?: number;
  maxRetries?: number;
  maxFixAttempts?: number;
  maxOutputTokens?: number;  // max tokens for LLM response
}

/** Extract JSON from text (handles code blocks) */
function extractJson(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  return match?.[1]?.trim() ?? text.trim();
}

/**
 * Generate structured output with schema validation
 */
export async function generate<T>(
  prompt: string,
  schema: z.ZodType<T>,
  options: GenerateOptions = {}
): Promise<T> {
  const { system, temperature = 0, maxRetries = 5, maxFixAttempts = 2 } = options;

  // Try structured output first
  try {
    console.error(`  Attempt 1/${maxFixAttempts} (structured output)...`);
    const result = await withRetry(
      () => generateText({
        model,
        prompt,
        system,
        output: Output.object({ schema }),
        temperature,
      }),
      { maxRetries }
    );
    if (result?.output !== undefined) {
      console.error(`  Success with structured output`);
      return result.output as T;
    }
  } catch (err) {
    console.error(`  Structured failed: ${(err as Error).message?.slice(0, 100)}`);
  }

  // Fallback to text + parse
  console.error(`  Falling back to text mode...`);
  const jsonSystem = (system ? system + "\n\n" : "") + "Respond with ONLY valid JSON.";

  for (let attempt = 0; attempt < maxFixAttempts; attempt++) {
    try {
      const result = await withRetry(
        () => generateText({ model, prompt, system: jsonSystem, temperature }),
        { maxRetries }
      );
      
      const parsed = JSON.parse(extractJson(result.text));
      const validated = schema.parse(parsed);
      console.error(`  Success on text attempt ${attempt + 1}`);
      return validated;
    } catch (err) {
      console.error(`  Attempt ${attempt + 1} failed: ${(err as Error).message?.slice(0, 100)}`);
    }
  }

  throw new Error(`Failed after ${maxFixAttempts} attempts`);
}

/** Generate array of objects */
export async function generateArray<T>(
  prompt: string,
  elementSchema: z.ZodType<T>,
  options: GenerateOptions = {}
): Promise<T[]> {
  return generate(prompt, z.array(elementSchema), options);
}

/** Generate plain text */
export async function generatePlainText(
  prompt: string,
  options: GenerateOptions = {}
): Promise<string> {
  const { system, temperature = 0, maxRetries = 5 } = options;
  const result = await withRetry(
    () => generateText({ model, prompt, system, temperature }),
    { maxRetries }
  );
  return result.text;
}

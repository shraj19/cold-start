// LLM generation functions with self-healing for remote execution

import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { appendFileSync } from "node:fs";
import { model, modelName } from "./client.js";
import { withRetry } from "./retry.js";

export interface GenerateOptions {
  system?: string;
  temperature?: number;
  maxRetries?: number;
  /** Max attempts for schema fix loop (default: 3) */
  maxFixAttempts?: number;
  /** Custom model to use (defaults to env model) */
  customModel?: LanguageModel;
  /** Force text-only mode (skip structured output) */
  useTextMode?: boolean;
}

function logUsage(
  operation: string,
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined,
  durationMs: number,
  extra?: Record<string, unknown>
): void {
  const entry = {
    model: modelName,
    operation,
    prompt_tokens: usage?.inputTokens ?? null,
    completion_tokens: usage?.outputTokens ?? null,
    total_tokens: usage?.totalTokens ?? null,
    duration_ms: Math.round(durationMs),
    timestamp: new Date().toISOString(),
    ...extra,
  };
  try {
    appendFileSync("usage.jsonl", JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // Ignore logging errors
  }
}

function logError(operation: string, error: unknown, context?: Record<string, unknown>): void {
  const entry = {
    level: "error",
    operation,
    error: error instanceof Error ? error.message : String(error),
    timestamp: new Date().toISOString(),
    ...context,
  };
  try {
    appendFileSync("errors.jsonl", JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // Ignore logging errors
  }
}

/** Extract JSON from text (handles markdown code blocks) */
function extractJson(text: string): string {
  // Try to find JSON in code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    return codeBlockMatch[1].trim();
  }

  // Try to find raw JSON object/array
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch && jsonMatch[1]) {
    return jsonMatch[1].trim();
  }

  return text.trim();
}

/** Format Zod errors for feedback to model */
function formatZodErrors(error: z.ZodError): string {
  // Zod v4 uses .issues, v3 uses .errors
  const issues = error.issues || (error as unknown as { errors: z.ZodIssue[] }).errors || [];
  if (issues.length === 0) {
    return `Zod error: ${error.message}`;
  }
  return issues
    .map((e) => {
      const path = e.path.length > 0 ? e.path.join(".") : "root";
      return `- ${path}: ${e.message}`;
    })
    .join("\n");
}

/**
 * Generate a structured object with schema enforcement
 * 
 * Uses generateText with Output.object() for structured output
 */
export async function generate<T>(
  prompt: string,
  schema: z.ZodType<T>,
  options: GenerateOptions = {}
): Promise<T> {
  const { system, temperature = 0, maxRetries = 5, maxFixAttempts = 3, customModel, useTextMode = false } = options;
  const start = Date.now();
  const activeModel = customModel ?? model;

  // Try structured output first (generateText with Output.object)
  if (!useTextMode) {
    try {
      console.error(`  Attempt 1/${maxFixAttempts} (structured output)...`);
      
      const result = await withRetry(
        async () => generateText({
          model: activeModel,
          prompt,
          system,
          output: Output.object({ schema }),
          temperature,
        }),
        { maxRetries }
      );

      // In AI SDK v6, the structured output is in result.output
      if (result && result.output !== undefined) {
        logUsage("generate_structured", result.usage, Date.now() - start, { mode: "structured" });
        console.error(`  Success with structured output`);
        return result.output as T;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  Structured output failed: ${errMsg.slice(0, 200)}`);
      logError("structured_output_failed", err);
      // Fall through to text mode
    }
  }

  // Fallback: Use text generation + manual parse
  console.error(`  Falling back to text mode...`);
  
  const jsonSystem = system
    ? `${system}\n\nIMPORTANT: Respond with ONLY valid JSON. No markdown, no explanation, no code blocks, just the raw JSON object.`
    : "Respond with ONLY valid JSON. No markdown, no explanation, no code blocks, just the raw JSON object.";

  let lastText = "";
  let lastErrors = "";

  for (let attempt = 0; attempt < maxFixAttempts; attempt++) {
    const currentPrompt =
      attempt === 0
        ? prompt
        : `${prompt}\n\n---\nYour previous response had schema validation errors:\n${lastErrors}\n\nPlease fix these issues and return valid JSON.`;

    try {
      console.error(`  Text attempt ${attempt + 1}/${maxFixAttempts}...`);
      
      const textResult = await withRetry(
        async () => generateText({ 
          model: activeModel, 
          prompt: currentPrompt, 
          system: jsonSystem, 
          temperature 
        }),
        { maxRetries }
      );

      // Safety check
      if (!textResult || typeof textResult.text !== "string") {
        lastErrors = `Invalid response: got ${typeof textResult?.text}`;
        console.error(`  No text in response`);
        continue;
      }

      lastText = textResult.text;
      console.error(`  Got ${lastText.length} chars`);
      
      const jsonStr = extractJson(lastText);

      // Try to parse JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (parseError) {
        lastErrors = `JSON parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
        logError("json_parse_failed", parseError, { attempt, text: lastText.slice(0, 500) });
        console.error(`  JSON parse failed, retrying...`);
        continue;
      }

      // Validate against schema
      const result = schema.safeParse(parsed);
      if (result.success) {
        logUsage("generate_text", textResult.usage, Date.now() - start, { fixAttempts: attempt + 1, mode: "text" });
        console.error(`  Success on text attempt ${attempt + 1}`);
        return result.data;
      }

      // Schema validation failed
      if (result.error) {
        lastErrors = formatZodErrors(result.error);
      } else {
        lastErrors = "Schema validation failed (no error details)";
      }
      logError("schema_validation_failed", result.error, { attempt, errors: lastErrors });
      console.error(`  Schema validation failed:\n${lastErrors.slice(0, 500)}`);
    } catch (err) {
      lastErrors = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      logError("generation_failed", err, { attempt, stack: err instanceof Error ? err.stack : undefined });
      console.error(`  Generation failed: ${lastErrors}`);
    }
  }

  logError("generate_all_failed", new Error("All attempts failed"), { lastText: lastText.slice(0, 1000), lastErrors });
  throw new Error(`Failed after ${maxFixAttempts} attempts. Last errors:\n${lastErrors}`);
}

/** Generate an array of objects (uses text generation + parse) */
export async function generateArray<T>(
  prompt: string,
  elementSchema: z.ZodType<T>,
  options: GenerateOptions = {}
): Promise<T[]> {
  const arraySchema = z.array(elementSchema);
  const result = await generate(prompt, arraySchema, options);
  return result;
}

/** Generate plain text */
export async function generatePlainText(
  prompt: string,
  options: GenerateOptions = {}
): Promise<string> {
  const { system, temperature = 0, maxRetries = 5, customModel } = options;
  const start = Date.now();
  const activeModel = customModel ?? model;

  const result = await withRetry(
    () => generateText({ model: activeModel, prompt, system, temperature }),
    { maxRetries }
  );

  logUsage("generatePlainText", result.usage, Date.now() - start);
  return result.text;
}

// Validator module - validate and score outputs

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readInput } from "../io/index.js";
import type { Output, Answers, CheckResult, Scores } from "./types.js";
import { validate } from "./validate.js";
import { score } from "./score.js";
import { POINTS, LABELS } from "./constants.js";

export type { ValidationResult, Scores, CheckResult, Answers } from "./types.js";
export { validate } from "./validate.js";
export { score } from "./score.js";
export { POINTS, LABELS } from "./constants.js";

/**
 * Load answers from directory if available
 */
function loadAnswers(inputDir: string): Answers | null {
  const path = join(inputDir, "answers", "answers.json");
  if (!existsSync(path)) return null;

  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Answers;
  } catch {
    return null;
  }
}

/**
 * Full validation and scoring check
 */
export function check(inputDir: string, outputPath: string): CheckResult {
  const { chats, messages, seed } = readInput(inputDir);

  // Load output
  let output: Output;
  try {
    output = JSON.parse(readFileSync(outputPath, "utf-8")) as Output;
  } catch (err) {
    return {
      validation: { valid: false, errors: [`Could not read ${outputPath}: ${err}`] },
      scores: null,
      total: 0,
      possible: 0,
    };
  }

  // Validate
  const validation = validate(output, chats, messages);
  if (!validation.valid) {
    return { validation, scores: null, total: 0, possible: 0 };
  }

  // Score if answers available
  const answers = loadAnswers(inputDir);
  if (!answers) {
    return { validation, scores: null, total: 0, possible: 0 };
  }

  const scores = score(output, answers, seed, messages);

  // Calculate totals
  let total = 0;
  let possible = 0;

  for (const [key, pts] of Object.entries(POINTS)) {
    const s = scores[key as keyof Scores];
    if (s !== null) {
      total += s * pts;
      possible += pts;
    }
  }

  return { validation, scores, total, possible };
}

/**
 * Format check result for console output
 */
export function formatResult(result: CheckResult): string {
  const lines: string[] = [];

  if (!result.validation.valid) {
    lines.push(`The output has ${result.validation.errors.length} problem(s):`);
    for (const err of result.validation.errors.slice(0, 50)) {
      lines.push(`  - ${err}`);
    }
    if (result.validation.errors.length > 50) {
      lines.push(`  ... and ${result.validation.errors.length - 50} more`);
    }
    return lines.join("\n");
  }

  lines.push("The output is valid.");

  if (!result.scores) {
    lines.push("No answers/answers.json in this folder, so there is nothing to score against.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push(`${"Part".padEnd(26)}${"Score".padStart(8)}${"Points".padStart(10)}`);

  for (const [key, pts] of Object.entries(POINTS)) {
    const s = result.scores[key as keyof Scores];
    const label = LABELS[key] ?? key;

    if (s === null) {
      lines.push(`${label.padEnd(26)}${"not labelled in this set".padStart(25)}`);
    } else {
      const got = s * pts;
      lines.push(`${label.padEnd(26)}${s.toFixed(2).padStart(8)}${got.toFixed(1).padStart(7)} / ${pts}`);
    }
  }

  lines.push(`${"Total from the data".padEnd(26)}${"".padStart(8)}${result.total.toFixed(1).padStart(7)} / ${result.possible}`);
  lines.push("Cost (12), the write-up (7) and runs with one command (7) are scored by us.");

  return lines.join("\n");
}

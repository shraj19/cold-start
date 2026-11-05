// Validator-specific types

import type { Chat, Message, Seed, Output } from "../types/index.js";

/** Answer key format (from answers/answers.json) */
export interface Answers extends Omit<Output, "open_loops"> {
  /** Timestamp cutoff for loop scoring */
  loops_scored_from?: number;
  /** Answer loops have multiple source messages */
  open_loops: AnswerLoop[];
}

export interface AnswerLoop {
  title: string;
  type: string;
  owner: string;
  chat_id: string;
  source_msgs: string[];  // Multiple valid source messages
  status: string;
  help?: string;  // Just the action string in answers
}

/** Score results per category */
export interface Scores {
  circles: number | null;
  organisations: number | null;
  chats: number | null;
  goals: number | null;
  loops_found: number | null;
  loops_closed: number | null;
  help: number | null;
}

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Full check result */
export interface CheckResult {
  validation: ValidationResult;
  scores: Scores | null;
  total: number;
  possible: number;
}

export type { Chat, Message, Seed, Output };

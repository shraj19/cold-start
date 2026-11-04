// Rule-based loop candidate extraction — finds potential tasks/commitments
// LLM only needed to confirm and decide assist/remind/leave

import type { Message } from "../types.js";

export interface LoopCandidate {
  messageId: string;
  chatId: string;
  senderId: string;
  senderName: string;
  body: string;
  timestamp: number;
  
  // Detected signals
  type: "commitment" | "followup" | "deadline" | "question" | null;
  owner: string; // "ME" or person id
  
  // Extracted info
  extractedDate: string | null; // YYYY-MM-DD if found
  doneSignal: boolean; // Contains "done", "ho gaya", etc.
  droppedSignal: boolean; // Contains "never mind", "cancel", etc.
  
  // Context
  contextBefore: Message[];
  contextAfter: Message[];
  
  confidence: "high" | "medium" | "low";
}

// ----- DATE EXTRACTION -----

const DATE_PATTERNS = [
  // Explicit dates: Oct 26, 26 Oct, 26/10, 10/26
  /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/,
  /\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})\b/i,
  
  // Relative: tomorrow, day after, next week
  /\b(tomorrow|kal|parso|day after)\b/i,
  /\b(next|is|this)\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)\b/i,
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  
  // Time-based: by EOD, by evening, by 5pm
  /\bby\s+(eod|evening|morning|tonight|today|end of day)\b/i,
  /\b(by|before|till|until)\s+(\d{1,2})\s*(am|pm)?\b/i,
];

function extractDate(body: string, messageTs: number): string | null {
  const lower = body.toLowerCase();
  
  // Check for day names
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const today = new Date(messageTs * 1000);
  
  for (let i = 0; i < days.length; i++) {
    if (lower.includes(days[i]!)) {
      const currentDay = today.getDay();
      let daysUntil = i - currentDay;
      if (daysUntil <= 0) daysUntil += 7; // Next week
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + daysUntil);
      return targetDate.toISOString().split("T")[0]!;
    }
  }
  
  // Tomorrow / kal
  if (/\b(tomorrow|kal)\b/i.test(body)) {
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    return tomorrow.toISOString().split("T")[0]!;
  }
  
  // Day after / parso
  if (/\b(parso|day after)\b/i.test(body)) {
    const dayAfter = new Date(today);
    dayAfter.setDate(today.getDate() + 2);
    return dayAfter.toISOString().split("T")[0]!;
  }
  
  // Explicit date patterns (simplified)
  const monthMatch = body.match(/\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  if (monthMatch) {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const day = parseInt(monthMatch[1]!);
    const month = months[monthMatch[2]!.toLowerCase()]!;
    const year = today.getFullYear();
    const date = new Date(year, month, day);
    return date.toISOString().split("T")[0]!;
  }
  
  return null;
}

// ----- SIGNAL DETECTION -----

const COMMITMENT_PATTERNS = [
  /\b(i will|i'll|main|will do|will send|karunga|karenge|kar dunga|bhej dunga|promise|pakka)\b/i,
  /\b(let me|mujhe|i('ll| will) (check|look|find|book|send|do))\b/i,
];

const QUESTION_PATTERNS = [
  /\?\s*$/,
  /\b(should (we|i)|kya kare|what do you think|decide|kaunsa|which one)\b/i,
  /\b(want (me to|us to)|chahte ho|chahiye)\b/i,
];

const FOLLOWUP_PATTERNS = [
  /\b(waiting|pending|remind|follow.?up|update (on|me)|status|kab tak|when will)\b/i,
  /\b(did you|have you|any update|kya hua)\b/i,
];

const DEADLINE_PATTERNS = [
  /\b(by|before|till|until|due|deadline)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|kal|eod|tonight|\d)/i,
  /\b(due|deadline|last date)\b/i,
];

const DONE_PATTERNS = [
  /\b(done|ho gaya|kar diya|sent|booked|completed|finished|bhej diya|paid|transferred)\b/i,
  /\b(✓|✔|👍)\b/,
];

const DROPPED_PATTERNS = [
  /\b(never mind|no need|cancel|forget|chhodo|rehne do|not required|don't worry)\b/i,
];

function detectLoopType(body: string): "commitment" | "followup" | "deadline" | "question" | null {
  // Order matters — check more specific patterns first
  if (DEADLINE_PATTERNS.some((p) => p.test(body))) return "deadline";
  if (COMMITMENT_PATTERNS.some((p) => p.test(body))) return "commitment";
  if (FOLLOWUP_PATTERNS.some((p) => p.test(body))) return "followup";
  if (QUESTION_PATTERNS.some((p) => p.test(body))) return "question";
  return null;
}

// ----- MAIN EXTRACTION -----

export function extractLoopCandidates(
  messages: Message[],
  messagesByChat: Map<string, Message[]>
): LoopCandidate[] {
  const candidates: LoopCandidate[] = [];
  
  // Sort messages by chat and timestamp
  const sortedByChat = new Map<string, Message[]>();
  for (const [chatId, msgs] of messagesByChat) {
    sortedByChat.set(chatId, [...msgs].sort((a, b) => a.ts - b.ts));
  }
  
  for (const msg of messages) {
    const loopType = detectLoopType(msg.body);
    if (!loopType) continue;
    
    // Skip very short messages (likely not actionable)
    if (msg.body.length < 10) continue;
    
    // Get context
    const chatMsgs = sortedByChat.get(msg.chat_id) ?? [];
    const msgIndex = chatMsgs.findIndex((m) => m.id === msg.id);
    const contextBefore = chatMsgs.slice(Math.max(0, msgIndex - 2), msgIndex);
    const contextAfter = chatMsgs.slice(msgIndex + 1, msgIndex + 3);
    
    // Determine owner
    // If ME says "I will", owner is ME
    // If someone else says "I will", owner is them
    // If question to ME, owner is ME
    let owner = msg.sender_id;
    if (loopType === "question" && msg.sender_id !== "ME") {
      owner = "ME"; // Question directed at user
    }
    
    // Check for done/dropped signals in context after
    const afterText = contextAfter.map((m) => m.body).join(" ");
    const doneSignal = DONE_PATTERNS.some((p) => p.test(afterText)) ||
                       DONE_PATTERNS.some((p) => p.test(msg.body));
    const droppedSignal = DROPPED_PATTERNS.some((p) => p.test(afterText));
    
    // Extract date
    const extractedDate = extractDate(msg.body, msg.ts);
    
    // Confidence based on signal strength
    let confidence: "high" | "medium" | "low" = "medium";
    if (extractedDate || doneSignal || droppedSignal) {
      confidence = "high";
    }
    if (msg.body.length < 20 || loopType === "question") {
      confidence = "low";
    }
    
    candidates.push({
      messageId: msg.id,
      chatId: msg.chat_id,
      senderId: msg.sender_id,
      senderName: msg.sender_name,
      body: msg.body,
      timestamp: msg.ts,
      type: loopType,
      owner,
      extractedDate,
      doneSignal,
      droppedSignal,
      contextBefore,
      contextAfter,
      confidence,
    });
  }
  
  return candidates;
}

/**
 * Format loop candidates for LLM (compact)
 */
export function formatLoopCandidatesForLLM(candidates: LoopCandidate[]): string {
  const lines: string[] = [];
  
  for (const c of candidates) {
    const status = c.doneSignal ? "[LIKELY DONE]" : c.droppedSignal ? "[LIKELY DROPPED]" : "[OPEN?]";
    const date = c.extractedDate ? ` (due: ${c.extractedDate})` : "";
    
    lines.push(`[${c.messageId}] ${c.type?.toUpperCase()} by ${c.senderId}${date} ${status}`);
    lines.push(`  "${c.body.slice(0, 100)}${c.body.length > 100 ? "..." : ""}"`);
    
    if (c.contextAfter.length > 0 && (c.doneSignal || c.droppedSignal)) {
      lines.push(`  → ${c.contextAfter[0]?.body.slice(0, 60)}`);
    }
    lines.push("");
  }
  
  return lines.join("\n");
}

// Pass 1: Per-chat extraction
// Runs in parallel for each chat
// Extracts: relationship signals, loop candidates, topics, goal hints

import { generate } from "../llm.js";
import { pass1OutputSchema, type Pass1Output } from "./schemas.js";
import type { Chat, Message } from "../types.js";

// Will be set by runPass1 if examples are provided
let fewShotExamples: string = "";

const SYSTEM_PROMPT = `You are extracting structured information from a WhatsApp chat.
Your job is to identify:

1. RELATIONSHIP SIGNALS - Evidence about who each person is relative to the chat owner (ME)
   - Look for: how they address ME, what they discuss, tone, context clues
   - Suggest a circle: spouse, child, parent, in-law, sibling, relative, friend, colleague, client, vendor, partner, staff
   - Rate confidence 0-1 (0.9+ = very clear, 0.5-0.7 = some signals, <0.5 = just guessing)

2. LOOP CANDIDATES - Things that need tracking:
   - commitment: "I'll do X", "Will send by tomorrow", "I'll handle it"
   - question: Unanswered questions that need response
   - deadline: Explicit dates/times for deliverables ("due Friday", "by Monday")
   - followup: "Did you check...?", "Any update on...?"
   - Include message ID, who owns it (ME or person ID), any due date mentioned
   - IMPORTANT: Also note if a commitment appears to be COMPLETED or DROPPED later in the conversation

3. TOPICS - Main subjects discussed (max 5)

4. GOAL HINTS - Any explicit goals or aspirations mentioned (e.g., "want to run a marathon", "planning to expand business")

IMPORTANT PATTERNS:
- "I'll send you X" followed by "already shared via Y" → commitment was DROPPED (superseded)
- Question followed by clear answer → mark as answered
- "Done", "Booked", "Sent" → commitment COMPLETED
- "kal" / "tomorrow" / "this week" → extract relative date if possible
- Hindi/Hinglish: "bhej dunga" = will send, "kar diya" = done, "theek hai" = ok

Be thorough but precise. Only include signals you actually see, not assumptions.`;

function buildPrompt(chat: Chat, messages: Message[]): string {
  const lines: string[] = [];
  
  // Add few-shot examples if available
  if (fewShotExamples) {
    lines.push(fewShotExamples);
    lines.push("\n=== NOW EXTRACT FROM THIS CHAT ===\n");
  }
  
  lines.push(`=== CHAT: ${chat.name} ===`);
  lines.push(`Type: ${chat.is_group ? "Group" : "1:1 chat"}`);
  lines.push(`Participants: ${chat.participants.filter(p => p !== "ME").join(", ")}`);
  lines.push("");
  lines.push("=== MESSAGES ===");
  
  for (const msg of messages) {
    const date = new Date(msg.ts * 1000).toISOString().split("T")[0];
    const sender = msg.sender_id === "ME" ? "ME" : `${msg.sender_name} (${msg.sender_id})`;
    lines.push(`[${msg.id}] ${date} ${sender}: ${msg.body}`);
  }
  
  return lines.join("\n");
}

/**
 * Extract information from a single chat
 */
export async function extractFromChat(
  chat: Chat,
  messages: Message[]
): Promise<Pass1Output> {
  // If no messages, return empty structure
  if (messages.length === 0) {
    return {
      chat_id: chat.chat_id,
      participants: chat.participants.filter(p => p !== "ME"),
      relationship_signals: [],
      loop_candidates: [],
      topics: [],
      goal_hints: [],
    };
  }

  const prompt = buildPrompt(chat, messages);
  
  const result = await generate(prompt, pass1OutputSchema, {
    system: SYSTEM_PROMPT,
    temperature: 0,
  });
  
  // Ensure chat_id is correct (LLM might hallucinate)
  return {
    ...result,
    chat_id: chat.chat_id,
    participants: chat.participants.filter(p => p !== "ME"),
  };
}

/**
 * Run Pass 1 on all chats in parallel batches
 */
export async function runPass1(
  chats: Chat[],
  messagesByChat: Map<string, Message[]>,
  options: { concurrency?: number; examples?: string; delayMs?: number } = {}
): Promise<Pass1Output[]> {
  const { concurrency = 10, examples = "", delayMs = 0 } = options;
  
  // Set few-shot examples for this run
  fewShotExamples = examples;
  
  const results: Pass1Output[] = [];
  
  // Process in batches
  for (let i = 0; i < chats.length; i += concurrency) {
    const batch = chats.slice(i, i + concurrency);
    console.error(`Pass 1: Processing chats ${i + 1}-${Math.min(i + concurrency, chats.length)} of ${chats.length}`);
    
    const batchPromises = batch.map(chat => {
      const messages = messagesByChat.get(chat.chat_id) ?? [];
      return extractFromChat(chat, messages);
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // Add delay between batches to respect rate limits
    if (delayMs > 0 && i + concurrency < chats.length) {
      console.error(`  Waiting ${delayMs / 1000}s to respect rate limits...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  // Clear examples after run
  fewShotExamples = "";
  
  return results;
}

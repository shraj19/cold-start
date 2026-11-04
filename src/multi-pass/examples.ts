// Few-shot examples from the example dataset
// Used to teach the model expected patterns

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Chat, Message, Seed } from "../types.js";

interface ExampleData {
  chats: Chat[];
  messages: Message[];
  seed: Seed;
  answers: any; // The expected output
}

let cachedExample: ExampleData | null = null;

/**
 * Load example data with answers (for few-shot learning)
 */
export function loadExampleData(exampleDir: string): ExampleData | null {
  if (cachedExample) return cachedExample;
  
  const answersPath = join(exampleDir, "answers", "answers.json");
  if (!existsSync(answersPath)) {
    console.error("No example answers found at", answersPath);
    return null;
  }

  try {
    const chatsPath = join(exampleDir, "chats.jsonl");
    const messagesPath = join(exampleDir, "messages.jsonl");
    const seedPath = join(exampleDir, "seed.json");

    const chats = readFileSync(chatsPath, "utf-8")
      .trim()
      .split("\n")
      .map(line => JSON.parse(line)) as Chat[];

    const messages = readFileSync(messagesPath, "utf-8")
      .trim()
      .split("\n")
      .map(line => JSON.parse(line)) as Message[];

    const seed = JSON.parse(readFileSync(seedPath, "utf-8")) as Seed;
    const answers = JSON.parse(readFileSync(answersPath, "utf-8"));

    cachedExample = { chats, messages, seed, answers };
    return cachedExample;
  } catch (e) {
    console.error("Failed to load example data:", e);
    return null;
  }
}

/**
 * Build few-shot examples for Pass 1 (per-chat extraction)
 * Shows 2-3 example chats with their expected signals/loops
 */
export function buildPass1Examples(exampleData: ExampleData): string {
  const { chats, messages, answers } = exampleData;
  
  // Build message index
  const messagesByChat = new Map<string, Message[]>();
  for (const msg of messages) {
    const chatMsgs = messagesByChat.get(msg.chat_id) ?? [];
    chatMsgs.push(msg);
    messagesByChat.set(msg.chat_id, chatMsgs);
  }

  // Build expected loops by chat
  const loopsByChat = new Map<string, any[]>();
  for (const loop of answers.open_loops) {
    const existing = loopsByChat.get(loop.chat_id) ?? [];
    existing.push(loop);
    loopsByChat.set(loop.chat_id, existing);
  }

  // Build expected circles
  const circleMap = new Map<string, string>();
  for (const p of answers.people) {
    circleMap.set(p.id, p.circle);
  }

  const examples: string[] = [];

  // Example 1: C01 (spouse chat, has loops)
  const c01 = chats.find(c => c.chat_id === "C01");
  const c01Msgs = messagesByChat.get("C01") ?? [];
  const c01Loops = loopsByChat.get("C01") ?? [];
  
  if (c01) {
    examples.push(`
=== EXAMPLE 1: Chat with spouse ===
INPUT:
Chat: "${c01.name}" (1:1)
Participants: P01
Messages:
${c01Msgs.map(m => `[${m.id}] ${m.sender_id === "ME" ? "ME" : m.sender_name}: ${m.body}`).join("\n")}

EXPECTED OUTPUT:
{
  "relationship_signals": [
    { "person_id": "P01", "signal": "Discusses family vacation, calls about kids' holidays", "suggests": "spouse", "confidence": 0.95 }
  ],
  "loop_candidates": [
    { "msg_id": "M002", "text_snippet": "Not yet. I'll book the tickets and the homestay this week", "type": "commitment", "owner": "ME", "due": null, "confidence": 0.9 }
  ],
  "topics": ["family vacation", "Coorg trip"],
  "goal_hints": ["Family trip to Coorg in December"]
}`);
  }

  // Example 2: C04 (work group, has multiple loops)
  const c04 = chats.find(c => c.chat_id === "C04");
  const c04Msgs = messagesByChat.get("C04") ?? [];
  const c04Loops = loopsByChat.get("C04") ?? [];

  if (c04) {
    examples.push(`
=== EXAMPLE 2: Work group chat ===
INPUT:
Chat: "${c04.name}" (group)
Participants: ${c04.participants.filter(p => p !== "ME").join(", ")}
Messages:
${c04Msgs.map(m => `[${m.id}] ${m.sender_id === "ME" ? "ME" : m.sender_name}: ${m.body}`).join("\n")}

EXPECTED OUTPUT:
{
  "relationship_signals": [
    { "person_id": "P05", "signal": "Discusses company invoices with 'we', part of work team", "suggests": "colleague", "confidence": 0.85 },
    { "person_id": "P06", "signal": "Name contains 'Brightside', discusses business decisions", "suggests": "colleague", "confidence": 0.9 }
  ],
  "loop_candidates": [
    { "msg_id": "M016", "text_snippet": "Zest wants us at 60k/month instead of 80. Should we take it?", "type": "question", "owner": "P06", "due": null, "confidence": 0.85 },
    { "msg_id": "M017", "text_snippet": "I'll send Orbit their October invoice today", "type": "commitment", "owner": "P05", "due": null, "confidence": 0.9 },
    { "msg_id": "M018", "text_snippet": "Pitch deck for Halcyon is due Friday", "type": "deadline", "owner": "ME", "due": "2026-10-23", "confidence": 0.95 },
    { "msg_id": "M020", "text_snippet": "Any thoughts on Zest? They want an answer by Monday", "type": "deadline", "owner": "P06", "due": "2026-10-26", "confidence": 0.9 }
  ],
  "topics": ["client pricing", "invoicing", "pitch deck", "business development"],
  "goal_hints": ["Grow Brightside to 10 retainer clients"]
}`);
  }

  // Example 3: C06 (friend chat with dropped loop)
  const c06 = chats.find(c => c.chat_id === "C06");
  const c06Msgs = messagesByChat.get("C06") ?? [];

  if (c06) {
    examples.push(`
=== EXAMPLE 3: Friend chat (shows dropped loop pattern) ===
INPUT:
Chat: "${c06.name}" (1:1)
Participants: P08
Messages:
${c06Msgs.map(m => `[${m.id}] ${m.sender_id === "ME" ? "ME" : m.sender_name}: ${m.body}`).join("\n")}

EXPECTED OUTPUT:
{
  "relationship_signals": [
    { "person_id": "P08", "signal": "Casual fitness chat, running buddy", "suggests": "friend", "confidence": 0.85 }
  ],
  "loop_candidates": [
    { "msg_id": "M027", "text_snippet": "I'll send you my training plan", "type": "commitment", "owner": "ME", "due": null, "confidence": 0.8 }
  ],
  "topics": ["running", "half marathon training"],
  "goal_hints": ["Run half marathon in January"]
}

NOTE: M027 commitment was later DROPPED because M028 shows it was already shared via Strava.
This is important for Pass 2 to determine final status.`);
  }

  return examples.join("\n\n");
}

/**
 * Build few-shot examples for Pass 2 (global synthesis)
 * Shows how to merge signals and determine final status
 */
export function buildPass2Examples(exampleData: ExampleData): string {
  const { answers } = exampleData;

  return `
=== FEW-SHOT EXAMPLE: Expected final output patterns ===

CIRCLES (from answers):
${answers.people.map((p: any) => `- ${p.id}: ${p.circle}${p.links ? ` (links: ${JSON.stringify(p.links)})` : ""}`).join("\n")}

ORGANISATIONS:
${answers.organisations.map((o: any) => `- ${o.id}: ${o.name} (${o.type}, ${o.side}, ${o.role})`).join("\n")}

LOOPS (note the status patterns):
${answers.open_loops.map((l: any) => `- [${l.status.toUpperCase()}] ${l.title}
  source: ${l.source_msgs?.join(", ") || l.source_msg}
  ${l.status === "done" ? `closed_by: ${l.closing_msgs?.join(", ")}` : ""}
  ${l.status === "open" ? `help: ${l.help}` : ""}
  ${l.why ? `reason: ${l.why}` : ""}`).join("\n\n")}

GOALS:
${answers.goals.map((g: any) => `- ${g.title} (${g.area}, ${g.type}, ${g.horizon}) evidence: ${g.evidence.join(", ")}`).join("\n")}

=== KEY PATTERNS TO LEARN ===

1. LOOP STATUS DETECTION:
   - DONE: Look for explicit confirmation in later messages
     * "Sunita decided paneer" → question answered → DONE
     * "Gas booked on Paytm" → commitment fulfilled → DONE
     * "Received brochure proofs" → delivery confirmed → DONE
   
   - DROPPED: Look for superseded/cancelled actions
     * "Already shared on Strava" → original commitment unnecessary → DROPPED
     * No follow-up after reasonable time + alternative taken → DROPPED
   
   - OPEN: No confirmation, still pending
     * Commitment made but no completion message
     * Question asked but no answer in conversation

2. HELP ACTION RULES:
   - assist: Task can be delegated (search options, draft reply, book something)
     * "Search Coorg homestays" - reversible, ME can approve
   - remind: Only user can do it, needs a nudge
     * "Remind about Halcyon pitch on Thursday"
   - leave: Someone else owns it OR too personal
     * "P05 is handling the invoice" - colleague's task
     * "Spouse is calling plumber" - family matter

3. MERGING RELATED MESSAGES:
   - M016 + M020 both about Zest → single loop "Decide Zest pricing"
   - M017 + M021 both about Orbit invoice → single loop
   - Use related_msg_ids to track all messages about same topic`;
}

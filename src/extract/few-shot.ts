// Few-shot learning support for extraction
// Optionally includes example input/output in the system prompt

import type { Message, Chat, Seed, Output } from "../types/index.js";
import type { DataStore } from "../store/index.js";
import type { ExampleData } from "../io/types.js";

/**
 * Build few-shot examples section for the system prompt
 * 
 * Includes:
 * - Example chats and messages (formatted like actual input)
 * - Expected output (the correct answer)
 * 
 * This helps the LLM understand:
 * - What relationships look like (circle inference)
 * - How to identify orgs from group chats
 * - Loop detection patterns
 * - Help action classification (assist vs remind vs leave)
 */
export function buildFewShotPrompt(example: ExampleData): string {
  // Format example messages (show a sample, not all to save tokens)
  // Get all messages from the store's messages array
  const sampleMessages = example.store.messages
    .slice(0, 10) // First 10 messages as example
    .map(m => {
      const date = new Date(m.ts * 1000).toISOString().slice(0, 10);
      const sender = m.sender_id === "ME" ? "ME" : `${m.sender_id} (${m.sender_name})`;
      return `[${m.id}] ${date} ${m.chat_id} | ${sender}: ${m.body}`;
    })
    .join('\n');

  // Format expected output (abbreviated to save tokens)
  const output = example.output;
  
  // Show only first 3 of each category as examples
  const examplePeople = output.people.slice(0, 3).map(p => ({
    id: p.id,
    circle: p.circle,
    ...(p.links && { links: p.links }),
  }));
  
  const exampleOrgs = output.organisations.slice(0, 2);
  
  const exampleChats = output.chats.slice(0, 3).map(c => ({
    chat_id: c.chat_id,
    ...(c.person && { person: c.person }),
    ...(c.organisation && { organisation: c.organisation }),
  }));
  
  const exampleGoals = output.goals.slice(0, 2).map(g => ({
    title: g.title,
    area: g.area,
    type: g.type,
    horizon: g.horizon,
  }));
  
  const exampleLoops = output.open_loops.slice(0, 3).map(l => ({
    title: l.title,
    type: l.type,
    owner: l.owner,
    chat_id: l.chat_id,
    source_msg: l.source_msg,
    status: l.status,
    ...(l.help && { help: l.help }),
  }));

  return `
<few-shot-example>
This is an example to help you understand the task. Your actual input will be different.

EXAMPLE INPUT (first 10 messages):
${sampleMessages}

EXAMPLE EXPECTED OUTPUT (abbreviated):
{
  "circles": ${JSON.stringify(examplePeople, null, 2)},
  "orgs": ${JSON.stringify(exampleOrgs, null, 2)},
  "chats": ${JSON.stringify(exampleChats, null, 2)},
  "goals": ${JSON.stringify(exampleGoals, null, 2)},
  "loops": ${JSON.stringify(exampleLoops, null, 2)}
}

Key learnings from this example:
1. CIRCLES: Infer from conversation style and context
   - "Yes sir" = staff
   - Work discussions = colleague
   - Family topics = spouse/child/parent
   
2. ORGANISATIONS: Group chats → org (with type and role)
   - Home chats with family = residence
   - Work group chats = company
   
3. CHATS: 1:1 → person_id, GROUP → org_id
   
4. GOALS: Long-term aspirations mentioned explicitly
   
5. LOOPS: Tasks, commitments, questions
   - Source_msg = FIRST message that creates the obligation
   - Status = open/done/dropped based on later messages
   - Help action: "assist" only if ME can prep work, otherwise "remind"

Now extract from YOUR actual input below:
</few-shot-example>
`;
}

/**
 * Calculate token cost of few-shot prompt
 * Useful for understanding overhead
 */
export function estimateFewShotTokens(example: ExampleData): number {
  const prompt = buildFewShotPrompt(example);
  // Conservative estimate: 3 chars per token
  return Math.ceil(prompt.length / 3);
}

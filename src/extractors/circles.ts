// Extract circles (relationships) for each person using LLM.

import { z } from "zod";
import { generate } from "../llm.js";
import { CIRCLES } from "../schemas.js";
import type { Chat, Message, Seed, PersonOut } from "../types.js";

// Schema for LLM output
const circlesResponseSchema = z.object({
  people: z.array(
    z.object({
      id: z.string(),
      circle: z.enum(CIRCLES),
    })
  ),
});

const SYSTEM_PROMPT = `You are analyzing WhatsApp chat data to understand relationships.
The user is "ME" (the main person whose chats these are).

For each person, determine their relationship circle to the user.

Circle definitions:
- spouse: husband/wife
- child: son/daughter  
- parent: mother/father
- in-law: spouse's family
- sibling: brother/sister
- relative: other family members
- friend: personal friend
- colleague: works with user at same company
- client: pays user's company for services
- vendor: user pays them for services
- partner: business partner (co-owns company with user)
- staff: household help (cook, driver, maid, nanny, etc.)

Look at:
- How people address each other (didi, bhaiya, sir, etc.)
- Chat names and context
- What they discuss (work tasks vs personal vs household)
- Who reports to whom
- The tone and formality of messages

Important: A client's company is NOT an organisation - a client is a person.
Staff who work at user's home are "staff", not "colleague".`;

export async function extractCircles(
  chats: Chat[],
  messages: Message[],
  seed: Seed,
): Promise<PersonOut[]> {
  // Get all unique person IDs (excluding ME)
  const allPersonIds = new Set<string>();
  for (const chat of chats) {
    for (const p of chat.participants) {
      if (p !== "ME") allPersonIds.add(p);
    }
  }

  // Use seed circles as ground truth (these are free hints)
  const knownCircles = new Map(Object.entries(seed.circles));

  // Find persons that need LLM classification
  const unknownPersonIds = [...allPersonIds].filter(
    (id) => !knownCircles.has(id)
  );

  // If all persons are known from seed, skip LLM call
  if (unknownPersonIds.length === 0) {
    return [...allPersonIds].map((id) => ({
      id,
      circle: knownCircles.get(id)!,
    }));
  }

  // Build context for LLM - format chats and messages
  const chatsText = chats
    .map((c) => `${c.chat_id}: "${c.name}" (${c.is_group ? "group" : "1:1"}) - participants: ${c.participants.join(", ")}`)
    .join("\n");

  const messagesText = messages
    .map((m) => `[${m.chat_id}] ${m.sender_name} (${m.sender_id}): ${m.body}`)
    .join("\n");

  const seedText = Object.entries(seed.circles)
    .map(([id, circle]) => `${id}: ${circle}`)
    .join("\n");

  const prompt = `Here is the WhatsApp data:

=== CHATS ===
${chatsText}

=== MESSAGES ===
${messagesText}

=== KNOWN RELATIONSHIPS (from user) ===
${seedText || "None provided"}

Classify ALL people (${[...allPersonIds].join(", ")}) into their circles.
For people already in "KNOWN RELATIONSHIPS", use that circle.
For others, analyze the messages to determine the relationship.`;

  const result = await generate(prompt, circlesResponseSchema, {
    system: SYSTEM_PROMPT,
    temperature: 0,
  });

  // Merge LLM results with seed (seed takes priority)
  const circleMap = new Map<string, PersonOut["circle"]>();
  
  // First, add LLM results
  for (const person of result.people) {
    circleMap.set(person.id, person.circle);
  }
  
  // Then override with seed (ground truth)
  for (const [id, circle] of knownCircles) {
    circleMap.set(id, circle);
  }

  // Build final output
  return [...allPersonIds].sort().map((id) => ({
    id,
    circle: circleMap.get(id) ?? "friend", // fallback to friend if somehow missing
  }));
}

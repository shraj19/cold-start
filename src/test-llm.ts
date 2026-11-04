// Simple test: read example data, send to LLM, get circles for each person.
// Usage: tsx src/test-llm.ts

import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { generate } from "./llm.js";
import { CIRCLES } from "./schemas.js";

// Read raw data
const chatsRaw = readFileSync("example/chats.jsonl", "utf-8");
const messagesRaw = readFileSync("example/messages.jsonl", "utf-8");
const seedRaw = readFileSync("example/seed.json", "utf-8");

// Schema for LLM output — array of person circles
const personCircleSchema = z.object({
  people: z.array(
    z.object({
      id: z.string().describe("Person ID from the data (e.g., P01, P02)"),
      name: z.string().describe("Name as it appears in the chats"),
      circle: z.enum(CIRCLES).describe("Relationship to the user"),
      reasoning: z.string().describe("Brief explanation for this classification"),
    })
  ),
});

const systemPrompt = `You are analyzing WhatsApp chat data to understand relationships.
The user is "ME" (also called "Meera" in this data).
For each person, determine their relationship circle to the user.

Circle definitions:
- spouse: husband/wife
- child: son/daughter
- parent: mother/father
- in-law: spouse's family
- sibling: brother/sister
- relative: other family
- friend: personal friend
- colleague: works with user at same company
- client: pays user's company for services
- vendor: user pays them for services
- partner: business partner (co-owns company)
- staff: household help (cook, driver, maid, etc.)

Look at:
- How they address each other
- Chat names and context
- What they discuss
- Who reports to whom
`;

async function main() {
  console.log("Sending data to LLM...\n");

const prompt = `Here is the WhatsApp data:
  <chats>
  ${chatsRaw}
  </chats>

  <messages>
  ${messagesRaw}
  </messages>


  <seed>
  ${seedRaw}
  </seed>

Analyze all people (except ME) and classify each into a circle.
Return all people with their IDs, names, circles, and brief reasoning.`;

  const result = await generate(prompt, personCircleSchema, {
    system: systemPrompt,
    temperature: 0,
  });

  console.log("=== LLM RESULT ===\n");
  console.log(JSON.stringify(result, null, 2));

  // Save to file
  writeFileSync("test-output.json", JSON.stringify(result, null, 2), "utf-8");
  console.log("\nSaved to test-output.json");
}

main().catch(console.error);

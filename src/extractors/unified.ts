// Unified extraction: single LLM call to extract all parts of the output.
// This is more token-efficient than multiple calls and provides better context.

import { z } from "zod";
import { generate } from "../llm.js";
import {
  CIRCLES,
  ORG_TYPES,
  ORG_SIDES,
  ORG_ROLES,
  LINK_TYPES,
  GOAL_AREAS,
  GOAL_TYPES,
  GOAL_HORIZONS,
  LOOP_TYPES,
  LOOP_STATUSES,
  HELP_ACTIONS,
} from "../schemas.js";
import type { Chat, Message, Seed, Output } from "../types.js";
import { preprocessData, formatForLLM } from "../preprocessor.js";

// Combined schema for unified extraction
const unifiedOutputSchema = z.object({
  // People with their circles and org links
  people: z.array(
    z.object({
      id: z.string().describe("Person ID from the data (e.g., P01)"),
      circle: z.enum(CIRCLES),
      links: z
        .array(
          z.object({
            organisation: z.string().describe("Organisation ID you create"),
            link: z.enum(LINK_TYPES),
          })
        )
        .optional(),
      looks_after: z.array(z.string()).optional().describe("Person IDs (like P04) that this staff member looks after - only for staff circle"),
    })
  ),

  // Organisations the user belongs to or runs
  organisations: z.array(
    z.object({
      id: z.string().describe("Your ID for this org (e.g., 'home', 'company1')"),
      name: z.string().describe("Name of the organisation"),
      type: z.enum(ORG_TYPES),
      side: z.enum(ORG_SIDES),
      role: z.enum(ORG_ROLES).describe("User's role in this org"),
    })
  ),

  // Map each chat to either a person or organisation
  chats: z.array(
    z.object({
      chat_id: z.string(),
      person: z.string().optional().describe("Person ID if 1:1 or belongs to a person"),
      organisation: z.string().optional().describe("Org ID if group belongs to an org"),
    })
  ),

  // Goals detected from conversations (max 10)
  goals: z
    .array(
      z.object({
        title: z.string(),
        area: z.enum(GOAL_AREAS),
        type: z.enum(GOAL_TYPES),
        horizon: z.enum(GOAL_HORIZONS),
        evidence: z.array(z.string()).describe("Message IDs that show this goal"),
      })
    )
    .max(10),

  // Open loops (tasks, commitments, follow-ups)
  open_loops: z.array(
    z.object({
      title: z.string().describe("Brief description of the task/commitment"),
      type: z.enum(LOOP_TYPES),
      owner: z.string().describe("'ME' or person ID who owes this"),
      chat_id: z.string(),
      source_msg: z.string().describe("Message ID where this loop originated"),
      due: z.string().nullable().optional().describe("YYYY-MM-DD if mentioned"),
      status: z.enum(LOOP_STATUSES),
      closed_by: z.string().nullable().optional().describe("Message ID that closed it"),
      help: z
        .object({
          action: z.enum(HELP_ACTIONS),
          next_step: z.string().optional().describe("For assist: what to do"),
          needs_yes: z.boolean().optional().describe("For assist: needs user approval?"),
          remind_at: z.string().optional().describe("For remind: ISO datetime"),
          reason: z.string().optional().describe("For leave: why stay out"),
        })
        .nullable()
        .optional()
        .describe("Only for open loops - how assistant should help"),
    })
  ),
});

const SYSTEM_PROMPT = `You are analyzing WhatsApp chat data to understand a person's life and help them.
The user is "ME" (the main person whose chats these are).

Your job is to extract:
1. PEOPLE - Who everyone is and their relationship (circle) to the user
2. ORGANISATIONS - Companies, homes, groups the user runs or belongs to
3. CHATS - Map each chat to a person or organisation
4. GOALS - What the user is working towards
5. OPEN LOOPS - Tasks, commitments, follow-ups still in motion

=== CIRCLES (relationships) ===
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

=== ORGANISATIONS ===
Only create organisations that the USER runs or belongs to:
- Their company/business (type: company, side: work)
- Their home (type: residence, side: home)
- Housing society, kids' school, etc.

DO NOT create organisations for:
- Client's companies (client is just a person in "client" circle)
- Vendor's businesses (vendor is just a person)
- Random groups that aren't "the user's"

=== CHAT MAPPING ===
- 1:1 chats: tie to the other person
- Group chats: tie to an organisation if it's the user's team/home/etc.
- Family groups: tie to "home" organisation
- Work team groups: tie to the company organisation
- Friend groups: can tie to a person if it's "their" group (e.g., kids' class parents group → tie to the child)

=== GOALS ===
Look for things the user is working towards:
- Habits (regular activities)
- Milestones (specific targets)
- Experiences (trips, events to plan)

Only include goals with clear evidence in the messages. Max 10.

=== OPEN LOOPS ===
Types:
- commitment: user promised something
- followup: user is waiting on someone
- deadline: something due on a date
- question: user must decide something

Status:
- open: still needs action
- done: completed (find the closing message)
- dropped: abandoned/cancelled

For OPEN loops, decide how assistant should help:
- assist: assistant can move it forward (find options, draft reply, book slot)
  - Set needs_yes=true if action needs user approval before executing
- remind: only user can do it, just remind at right time
- leave: stay out - someone else owns it, too personal, or would annoy user

IMPORTANT for "leave":
- If someone else (not ME) committed to do something, leave it
- Don't remind user about spouse's tasks
- Don't poke into personal conversations
- Staff/colleagues handling their own tasks = leave

=== SEED DATA ===
Use the provided seed data as ground truth - these are hints from the user themselves.`;

export async function extractAll(
  chats: Chat[],
  messages: Message[],
  seed: Seed,
): Promise<Output> {
  // Preprocess data into LLM-friendly format (reduces tokens significantly)
  const preprocessed = preprocessData(chats, messages, seed);
  const formattedData = formatForLLM(preprocessed);
  
  // Get all person IDs
  const allPersonIds = new Set<string>();
  for (const chat of chats) {
    for (const p of chat.participants) {
      if (p !== "ME") allPersonIds.add(p);
    }
  }

  const prompt = `Analyze this preprocessed WhatsApp data and extract all required information.

${formattedData}

=== YOUR TASK ===
Extract:
1. All ${allPersonIds.size} people (${[...allPersonIds].join(", ")}) with their circles
   - Use seed circles where provided
   - For staff, note who they look_after if applicable
   
2. Organisations the user runs/belongs to
   - Use seed org names as hints
   - Create IDs like "home", "company1", etc.
   
3. Map all ${chats.length} chats to person or organisation
   - 1:1 chats → tie to the other person
   - Group chats → tie to org if it's user's team/home
   
4. Goals visible in the data (max 10, need message ID evidence)

5. Open loops from the LOOP CANDIDATES section
   - Determine status (open/done/dropped) from context
   - For open loops, decide: assist/remind/leave`;

  const result = await generate(prompt, unifiedOutputSchema, {
    system: SYSTEM_PROMPT,
    temperature: 0,
  });

  // Validate chat mappings - each chat must have exactly one of person|organisation
  const validatedChats = result.chats.map((c) => {
    if (c.person && c.organisation) {
      // If both set, prefer organisation for groups, person for 1:1
      const chat = chats.find((ch) => ch.chat_id === c.chat_id);
      if (chat?.is_group) {
        return { chat_id: c.chat_id, organisation: c.organisation };
      } else {
        return { chat_id: c.chat_id, person: c.person };
      }
    }
    if (!c.person && !c.organisation) {
      // If neither set, find the other person in 1:1, or create dummy org for group
      const chat = chats.find((ch) => ch.chat_id === c.chat_id);
      if (chat && !chat.is_group) {
        const other = chat.participants.find((p) => p !== "ME");
        if (other) return { chat_id: c.chat_id, person: other };
      }
      // Fallback: create org reference
      return { chat_id: c.chat_id, organisation: "org_" + c.chat_id };
    }
    return c;
  });

  return {
    people: result.people,
    organisations: result.organisations,
    chats: validatedChats,
    goals: result.goals,
    open_loops: result.open_loops,
  };
}

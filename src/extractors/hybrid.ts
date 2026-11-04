// Hybrid extraction: Rules first, LLM only for judgment
// This approach minimizes LLM tokens while maximizing accuracy

import { z } from "zod";
import { generate } from "../llm.js";
import {
  CIRCLES,
  GOAL_AREAS,
  GOAL_TYPES,
  GOAL_HORIZONS,
  LOOP_STATUSES,
  HELP_ACTIONS,
} from "../schemas.js";
import type { Chat, Message, Seed, Output, PersonOut, GoalOut, OpenLoopOut } from "../types.js";
import {
  extractCircleHints,
  formatCircleHintsForLLM,
  type CircleHint,
} from "../rules/circles.js";
import {
  detectOrganisations,
  finalizeOrganisations,
  buildOrgIdMap,
} from "../rules/orgs.js";
import {
  mapChatsWithRules,
  finalizeChatMappings,
} from "../rules/chats.js";
import {
  extractLoopCandidates,
  formatLoopCandidatesForLLM,
  type LoopCandidate,
} from "../rules/loops.js";

// ----- HELPER: Build indexes -----

function buildIndexes(chats: Chat[], messages: Message[]) {
  const messagesByChat = new Map<string, Message[]>();
  const messagesByPerson = new Map<string, Message[]>();
  const personChats = new Map<string, string[]>();
  const personNames = new Map<string, string[]>();
  const allPersonIds = new Set<string>();

  for (const msg of messages) {
    // Index by chat
    const chatMsgs = messagesByChat.get(msg.chat_id) ?? [];
    chatMsgs.push(msg);
    messagesByChat.set(msg.chat_id, chatMsgs);

    // Index by person (skip ME)
    if (msg.sender_id !== "ME") {
      allPersonIds.add(msg.sender_id);
      
      const personMsgs = messagesByPerson.get(msg.sender_id) ?? [];
      personMsgs.push(msg);
      messagesByPerson.set(msg.sender_id, personMsgs);

      // Track names
      const names = personNames.get(msg.sender_id) ?? [];
      if (!names.includes(msg.sender_name)) {
        names.push(msg.sender_name);
        personNames.set(msg.sender_id, names);
      }
    }
  }

  // Build person → chats map
  for (const chat of chats) {
    for (const p of chat.participants) {
      if (p !== "ME") {
        allPersonIds.add(p);
        const chatIds = personChats.get(p) ?? [];
        if (!chatIds.includes(chat.chat_id)) {
          chatIds.push(chat.chat_id);
          personChats.set(p, chatIds);
        }
      }
    }
  }

  return {
    messagesByChat,
    messagesByPerson,
    personChats,
    personNames,
    allPersonIds,
  };
}

// ----- LLM SCHEMA: Only what needs judgment -----

const llmJudgmentSchema = z.object({
  // Circles for ambiguous people only
  circles: z.array(
    z.object({
      id: z.string(),
      circle: z.enum(CIRCLES),
    })
  ),

  // Goals (need LLM to identify)
  goals: z
    .array(
      z.object({
        title: z.string(),
        area: z.enum(GOAL_AREAS),
        type: z.enum(GOAL_TYPES),
        horizon: z.enum(GOAL_HORIZONS),
        evidence: z.array(z.string()).min(1),
      })
    )
    .max(10),

  // Loop confirmations (status + help action)
  loops: z.array(
    z.object({
      messageId: z.string().describe("source_msg from candidate"),
      status: z.enum(LOOP_STATUSES),
      closedBy: z.string().nullable().describe("Message ID that closed it"),
      helpAction: z.enum(HELP_ACTIONS).nullable().describe("Only for open loops"),
      helpDetail: z.string().nullable().describe("next_step for assist, remind_at for remind, reason for leave"),
    })
  ),
});

const SYSTEM_PROMPT = `You are analyzing WhatsApp data that has been pre-processed with rule-based extraction.
Your job is to make JUDGMENTS on ambiguous cases:

1. CIRCLES: Confirm or correct relationship classifications for ambiguous people
2. GOALS: Identify user's goals from the conversations (max 10)
3. LOOPS: Confirm status (open/done/dropped) and decide how to help (assist/remind/leave)

=== CIRCLE DEFINITIONS ===
spouse, child, parent, in-law, sibling, relative, friend, colleague, client, vendor, partner, staff

=== LOOP HELP DECISIONS ===
- assist: Assistant can move it forward (search options, draft reply, book something)
  - Needs helpDetail = what to do next
- remind: Only user can do it, remind at right time
  - Needs helpDetail = ISO datetime for reminder
- leave: Stay out (someone else owns it, too personal, would annoy user)
  - Needs helpDetail = brief reason

=== IMPORTANT ===
- For circles: Only classify people in the "NEEDS REVIEW" section
- For loops: Use message IDs from the candidates list
- For goals: Must have evidence (message IDs)`;

// ----- MAIN EXTRACTION -----

export async function extractHybrid(
  chats: Chat[],
  messages: Message[],
  seed: Seed
): Promise<Output> {
  console.error("Building indexes...");
  const indexes = buildIndexes(chats, messages);

  // ----- STEP 1: Rule-based extraction (NO LLM) -----
  console.error("Extracting with rules...");

  // Organisations
  const orgCandidates = detectOrganisations(chats, seed);
  const organisations = finalizeOrganisations(orgCandidates);
  const orgIdMap = buildOrgIdMap(orgCandidates);

  // Build person → org mapping (for adding links to colleagues)
  const personToOrgs = new Map<string, string[]>();
  for (const org of orgCandidates) {
    for (const chatId of org.chatIds) {
      const chat = chats.find((c) => c.chat_id === chatId);
      if (chat) {
        for (const p of chat.participants) {
          if (p !== "ME") {
            const orgs = personToOrgs.get(p) ?? [];
            if (!orgs.includes(org.id)) {
              orgs.push(org.id);
              personToOrgs.set(p, orgs);
            }
          }
        }
      }
    }
  }

  // Chat mappings
  const chatMappings = mapChatsWithRules(chats, seed, orgIdMap);
  const finalChats = finalizeChatMappings(chatMappings, chats);

  // Circle hints
  const circleHints = extractCircleHints(
    indexes.allPersonIds,
    messages,
    indexes.messagesByPerson,
    indexes.personChats,
    indexes.personNames,
    seed,
    chats // Pass chats for org membership detection
  );

  // Loop candidates
  const loopCandidates = extractLoopCandidates(messages, indexes.messagesByChat);

  // ----- STATS -----
  const highConfCircles = circleHints.filter((h) => h.confidence === "high").length;
  const needsReviewCircles = circleHints.filter((h) => h.confidence !== "high").length;
  console.error(`Circles: ${highConfCircles} confirmed, ${needsReviewCircles} need review`);
  console.error(`Loop candidates: ${loopCandidates.length}`);

  // ----- STEP 2: LLM for judgment only -----
  console.error("Calling LLM for judgments...");

  const prompt = `I've pre-processed WhatsApp data. Help me make final judgments.

=== CIRCLE HINTS ===
${formatCircleHintsForLLM(circleHints)}

=== LOOP CANDIDATES (${loopCandidates.length} found) ===
${formatLoopCandidatesForLLM(loopCandidates.slice(0, 50))} ${loopCandidates.length > 50 ? `\n... and ${loopCandidates.length - 50} more` : ""}

=== SEED GOALS (hints) ===
${seed.goals.map((g) => `${g.title} (${g.area})`).join("\n") || "None"}

=== YOUR TASK ===
1. Classify people in "NEEDS REVIEW" section (${needsReviewCircles} people)
2. Identify up to 10 goals from the data (with message ID evidence from loop candidates)
3. For each loop candidate, confirm status and decide help action`;

  const judgment = await generate(prompt, llmJudgmentSchema, {
    system: SYSTEM_PROMPT,
    temperature: 0,
  });

  // ----- STEP 3: Merge rule-based + LLM results -----
  console.error("Merging results...");

  // Merge circles
  const circleMap = new Map<string, PersonOut["circle"]>();
  
  // First, high-confidence from rules
  for (const hint of circleHints) {
    if (hint.confidence === "high" && hint.suggestedCircle) {
      circleMap.set(hint.personId, hint.suggestedCircle);
    }
  }
  
  // Then, LLM judgments for ambiguous ones
  for (const c of judgment.circles) {
    circleMap.set(c.id, c.circle);
  }
  
  // Fallback: anyone not classified → friend
  for (const personId of indexes.allPersonIds) {
    if (!circleMap.has(personId)) {
      circleMap.set(personId, "friend");
    }
  }

  // Build people output with links
  const people: PersonOut[] = [...indexes.allPersonIds].sort().map((id) => {
    const hint = circleHints.find((h) => h.personId === id);
    const circle = circleMap.get(id) ?? "friend";
    
    const person: PersonOut = { id, circle };
    
    // Add org links for staff (home)
    if (circle === "staff") {
      person.links = [{ organisation: "home", link: "supports" }];
    }
    
    // Add org links for colleagues (work orgs)
    if (circle === "colleague") {
      const orgs = personToOrgs.get(id) ?? [];
      // Filter to work orgs only (not home)
      const workOrgs = orgs.filter((o) => o !== "home");
      if (workOrgs.length > 0) {
        person.links = workOrgs.map((o) => ({ organisation: o, link: "runs" as const }));
      }
    }
    
    return person;
  });

  // Build open loops from LLM judgment
  const loopMap = new Map(loopCandidates.map((c) => [c.messageId, c]));
  const openLoops: OpenLoopOut[] = judgment.loops
    .filter((l) => loopMap.has(l.messageId))
    .map((l) => {
      const candidate = loopMap.get(l.messageId)!;
      const loop: OpenLoopOut = {
        title: candidate.body.slice(0, 60) + (candidate.body.length > 60 ? "..." : ""),
        type: candidate.type ?? "commitment",
        owner: candidate.owner,
        chat_id: candidate.chatId,
        source_msg: candidate.messageId,
        due: candidate.extractedDate,
        status: l.status,
        closed_by: l.closedBy,
      };

      // Add help for open loops
      if (l.status === "open" && l.helpAction) {
        loop.help = {
          action: l.helpAction,
          ...(l.helpAction === "assist" && l.helpDetail
            ? { next_step: l.helpDetail, needs_yes: true }
            : {}),
          ...(l.helpAction === "remind" && l.helpDetail
            ? { remind_at: l.helpDetail }
            : {}),
          ...(l.helpAction === "leave" && l.helpDetail
            ? { reason: l.helpDetail }
            : {}),
        };
      }

      return loop;
    });

  // Goals from LLM
  const goals: GoalOut[] = judgment.goals;

  return {
    people,
    organisations,
    chats: finalChats,
    goals,
    open_loops: openLoops,
  };
}

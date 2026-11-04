// Pass 2: Global synthesis
// Takes all Pass 1 outputs and makes final decisions
// Identifies low-confidence items for Pass 3 investigation

import { generate } from "../llm.js";
import { pass2OutputSchema, type Pass2Output, type Pass1Output } from "./schemas.js";
import type { Seed } from "../types.js";

const SYSTEM_PROMPT = `You are synthesizing information from multiple WhatsApp chat analyses to make final decisions.

You receive:
1. Relationship signals from all chats (may have conflicting signals for same person)
2. Loop candidates from all chats (may be duplicates or related items)
3. Seed data (known circles, organisations, goals)

Your job:

1. CIRCLE DECISIONS - Decide relationship for each person
   - Merge conflicting signals logically (someone in work group + talks about invoices with "we" = colleague, not vendor)
   - Use seed.circles as ground truth when available
   - Confidence: 0.9+ if clear, 0.5-0.7 if inferring, <0.5 if guessing

2. ORGANISATION DECISIONS - Identify organisations
   - Use seed.organisations as hints
   - Create "home" org if family/household chats exist (type: "residence", side: "home", role: "owner")
   - Work orgs: type: "company", side: "work", role: "owner"
   - ID should be short lowercase (e.g., "brightside" not "brightside_design")

3. PERSON-ORG LINKS - Who belongs to which org
   - Staff link to home with "supports"
   - Colleagues link to work orgs with "runs"
   - DO NOT link family members (spouse, child, parent, sibling, etc.) to orgs

4. LOOP DECISIONS - Consolidate and decide status
   - Merge related messages into single loop (use related_msg_ids)
   - TRUST the status from Pass 1 if it shows done or dropped with a closing message
   - Decide status:
     * open: still pending, needs action
     * done: explicitly completed in the conversation (look for: "Done", "Sent", "Booked", answer given to question, task completed)
     * dropped: abandoned, cancelled, or superseded (look for: "Never mind", "Got it elsewhere", no longer needed)
   - For OPEN loops only, decide help action:
     * assist: Assistant can take action (search, draft, book). help_detail = specific next step
     * remind: Only user can do it. help_detail = ISO datetime like "2026-10-25T09:00:00Z"
     * leave: Someone else owns it or too personal. help_detail = brief reason why
   - Title should be clear action item, max 60 chars
   - Include ALL loops, even those marked done/dropped

5. GOAL DECISIONS - Identify user's goals
   - Look for patterns across chats (marathon mentioned multiple times = real goal)
   - Must have message ID evidence
   - Max 10 goals

6. NEEDS INVESTIGATION - Flag low-confidence items
   - If confidence < 0.6 and decision matters, request investigation
   - Specify which chats to look at

IMPORTANT FORMAT RULES:
- help_detail for "remind" MUST be ISO datetime (e.g., "2026-10-25T09:00:00Z"), NOT a text description
- help_detail for "assist" should be a specific action (e.g., "Search Coorg homestay options")
- help_detail for "leave" should be a reason (e.g., "P05 is handling it")

Be decisive but honest about uncertainty. It's better to flag something for investigation than guess wrong.`;

function formatPass1ForLLM(pass1Results: Pass1Output[]): string {
  const lines: string[] = [];
  
  // Group signals by person
  const personSignals = new Map<string, Array<{ chat: string; signal: string; suggests: string; conf: number }>>();
  
  for (const p1 of pass1Results) {
    for (const sig of p1.relationship_signals) {
      const existing = personSignals.get(sig.person_id) ?? [];
      existing.push({
        chat: p1.chat_id,
        signal: sig.signal,
        suggests: sig.suggests,
        conf: sig.confidence,
      });
      personSignals.set(sig.person_id, existing);
    }
  }
  
  // Format person signals
  lines.push("=== RELATIONSHIP SIGNALS BY PERSON ===");
  for (const [personId, signals] of personSignals) {
    lines.push(`\n${personId}:`);
    for (const s of signals) {
      lines.push(`  [${s.chat}] "${s.signal}" → ${s.suggests} (${s.conf.toFixed(2)})`);
    }
  }
  
  // Format loop candidates
  lines.push("\n\n=== LOOP CANDIDATES ===");
  for (const p1 of pass1Results) {
    if (p1.loop_candidates.length > 0) {
      lines.push(`\nChat ${p1.chat_id}:`);
      for (const loop of p1.loop_candidates) {
        const statusInfo = loop.status !== "open" 
          ? ` [${loop.status.toUpperCase()}${loop.closing_msg ? ` by ${loop.closing_msg}` : ""}]`
          : "";
        lines.push(`  [${loop.msg_id}] ${loop.type} by ${loop.owner}: "${loop.text_snippet}" ${loop.due ? `(due: ${loop.due})` : ""}${statusInfo} conf=${loop.confidence.toFixed(2)}`);
      }
    }
  }
  
  // Format topics and goal hints
  const allTopics = new Set<string>();
  const allGoalHints = new Set<string>();
  
  for (const p1 of pass1Results) {
    p1.topics.forEach(t => allTopics.add(t));
    p1.goal_hints.forEach(g => allGoalHints.add(g));
  }
  
  lines.push("\n\n=== TOPICS ACROSS CHATS ===");
  lines.push([...allTopics].join(", "));
  
  lines.push("\n\n=== GOAL HINTS ===");
  lines.push([...allGoalHints].join(", "));
  
  return lines.join("\n");
}

function formatSeedForLLM(seed: Seed): string {
  const lines: string[] = [];
  
  lines.push("=== SEED DATA (ground truth) ===");
  
  if (Object.keys(seed.circles).length > 0) {
    lines.push("\nKnown circles:");
    for (const [personId, circle] of Object.entries(seed.circles)) {
      lines.push(`  ${personId}: ${circle}`);
    }
  }
  
  if (seed.organisations.length > 0) {
    lines.push("\nKnown organisations:");
    for (const org of seed.organisations) {
      lines.push(`  ${org}`);
    }
  }
  
  if (seed.goals.length > 0) {
    lines.push("\nKnown goals:");
    for (const goal of seed.goals) {
      lines.push(`  ${goal.title} (${goal.area}, ${goal.horizon})`);
    }
  }
  
  return lines.join("\n");
}

/**
 * Run Pass 2: Global synthesis
 */
export async function runPass2(
  pass1Results: Pass1Output[],
  seed: Seed,
  options: { examples?: string } = {}
): Promise<Pass2Output> {
  const { examples = "" } = options;
  
  const pass1Summary = formatPass1ForLLM(pass1Results);
  const seedSummary = formatSeedForLLM(seed);
  
  // Collect all unique person IDs
  const allPersonIds = new Set<string>();
  for (const p1 of pass1Results) {
    p1.participants.forEach(p => allPersonIds.add(p));
  }
  
  let prompt = "";
  
  // Add few-shot examples if available
  if (examples) {
    prompt += examples + "\n\n=== NOW SYNTHESIZE THIS DATA ===\n\n";
  }
  
  prompt += `${seedSummary}

${pass1Summary}

=== ALL PERSON IDs TO CLASSIFY ===
${[...allPersonIds].sort().join(", ")}

=== YOUR TASK ===
1. Decide circle for each person (use seed circles as ground truth)
2. Create organisation list (use seed orgs + detect "home" if needed)
3. Link people to organisations where appropriate
4. Consolidate loops - merge related messages, decide status (IMPORTANT: mark done/dropped if conversation shows completion)
5. Identify goals (max 10)
6. Flag anything uncertain (confidence < 0.6) for investigation`;

  console.error(`Pass 2: Synthesizing ${pass1Results.length} chat extractions, ${allPersonIds.size} people`);
  
  try {
    const result = await generate(prompt, pass2OutputSchema, {
      system: SYSTEM_PROMPT,
      temperature: 0,
    });
    
    return result;
  } catch (error) {
    console.error(`Pass 2 failed (likely too large), attempting chunked synthesis...`);
    return await runChunkedPass2(pass1Results, seed, allPersonIds, examples);
  }
}

/**
 * Fallback: Run Pass 2 in chunks when the data is too large for one call
 * - Chunk 1: Circle decisions for all people (split if needed)
 * - Chunk 2: Loop decisions (process in batches by chat)
 * - Chunk 3: Goals (one call, limit output)
 */
async function runChunkedPass2(
  pass1Results: Pass1Output[],
  seed: Seed,
  allPersonIds: Set<string>,
  examples: string
): Promise<Pass2Output> {
  const circleDecisions = await getCircleDecisions(pass1Results, seed, allPersonIds);
  const orgDecisions = getOrgDecisions(pass1Results, seed);
  const personOrgLinks = getPersonOrgLinks(circleDecisions, orgDecisions, pass1Results);
  const loopDecisions = await getLoopDecisions(pass1Results, seed);
  const goalDecisions = await getGoalDecisions(pass1Results, seed);
  
  return {
    circle_decisions: circleDecisions,
    org_decisions: orgDecisions,
    person_org_links: personOrgLinks,
    loop_decisions: loopDecisions,
    goal_decisions: goalDecisions,
    needs_investigation: [], // Skip investigation for chunked mode
  };
}

/**
 * Get circle decisions for all people, chunking if needed
 */
async function getCircleDecisions(
  pass1Results: Pass1Output[],
  seed: Seed,
  allPersonIds: Set<string>
): Promise<Pass2Output["circle_decisions"]> {
  const personSignals = new Map<string, Array<{ chat: string; signal: string; suggests: string; conf: number }>>();
  
  for (const p1 of pass1Results) {
    for (const sig of p1.relationship_signals) {
      const existing = personSignals.get(sig.person_id) ?? [];
      existing.push({
        chat: p1.chat_id,
        signal: sig.signal,
        suggests: sig.suggests,
        conf: sig.confidence,
      });
      personSignals.set(sig.person_id, existing);
    }
  }
  
  const circleSchema = z.object({
    decisions: z.array(z.object({
      person_id: z.string(),
      circle: z.enum(CIRCLES),
      confidence: z.number().min(0).max(1),
      reasoning: z.string().max(100),
    })),
  });
  
  const prompt = `Decide the relationship circle for each person based on the signals.
Use seed circles as ground truth when available.

=== SEED CIRCLES ===
${Object.entries(seed.circles).map(([id, circle]) => `${id}: ${circle}`).join("\n") || "(none)"}

=== SIGNALS BY PERSON ===
${[...personSignals.entries()].map(([pid, signals]) => 
  `${pid}:\n${signals.map(s => `  [${s.chat}] "${s.signal}" → ${s.suggests} (${s.conf.toFixed(2)})`).join("\n")}`
).join("\n\n")}

=== ALL PERSON IDs ===
${[...allPersonIds].sort().join(", ")}

Return a circle decision for EVERY person ID listed.
Circles: spouse, child, parent, in-law, sibling, relative, friend, colleague, client, vendor, partner, staff`;
  
  const result = await generate(prompt, circleSchema, {
    system: "You are classifying relationships. Use signals to infer circles. Trust seed data as ground truth.",
    temperature: 0,
  });
  
  return result.decisions;
}

/**
 * Get org decisions from Pass 1 data and seed
 */
function getOrgDecisions(
  pass1Results: Pass1Output[],
  seed: Seed
): Pass2Output["org_decisions"] {
  const orgs: Pass2Output["org_decisions"] = [];
  
  // Add home org if we have staff
  const hasStaff = pass1Results.some(p1 => 
    p1.relationship_signals.some(s => s.suggests === "staff")
  );
  if (hasStaff) {
    orgs.push({
      id: "home",
      name: "Home",
      type: "residence",
      side: "home",
      role: "owner",
    });
  }
  
  // Add seed orgs
  for (const orgHint of seed.organisations) {
    const id = orgHint.toLowerCase().split(/[\s_-]+/)[0] ?? orgHint.toLowerCase();
    orgs.push({
      id,
      name: orgHint,
      type: "company",
      side: "work",
      role: "owner",
    });
  }
  
  return orgs;
}

/**
 * Link people to organisations based on circles
 */
function getPersonOrgLinks(
  circleDecisions: Pass2Output["circle_decisions"],
  orgDecisions: Pass2Output["org_decisions"],
  pass1Results: Pass1Output[]
): Pass2Output["person_org_links"] {
  const links: Pass2Output["person_org_links"] = [];
  
  const homeOrg = orgDecisions.find(o => o.id === "home");
  const workOrgs = orgDecisions.filter(o => o.side === "work");
  
  for (const decision of circleDecisions) {
    if (decision.circle === "staff" && homeOrg) {
      links.push({
        person_id: decision.person_id,
        organisation_id: homeOrg.id,
        link: "supports",
      });
    } else if (decision.circle === "colleague" && workOrgs.length > 0) {
      // Link to first work org (simplified)
      links.push({
        person_id: decision.person_id,
        organisation_id: workOrgs[0]!.id,
        link: "runs",
      });
    }
  }
  
  return links;
}

/**
 * Get loop decisions from Pass 1 data
 */
async function getLoopDecisions(
  pass1Results: Pass1Output[],
  seed: Seed
): Promise<Pass2Output["loop_decisions"]> {
  // Collect all loop candidates
  const allLoops: Array<{
    chat_id: string;
    msg_id: string;
    text_snippet: string;
    type: string;
    owner: string;
    due: string | null;
    status: string;
    closing_msg: string | null;
    confidence: number;
  }> = [];
  
  for (const p1 of pass1Results) {
    for (const loop of p1.loop_candidates) {
      allLoops.push({
        chat_id: p1.chat_id,
        ...loop,
      });
    }
  }
  
  if (allLoops.length === 0) {
    return [];
  }
  
  const loopSchema = z.object({
    decisions: z.array(z.object({
      msg_id: z.string(),
      related_msg_ids: z.array(z.string()),
      title: z.string().max(60),
      type: z.enum(LOOP_TYPES),
      owner: z.string(),
      chat_id: z.string(),
      due: z.string().nullable(),
      status: z.enum(LOOP_STATUSES),
      closed_by: z.string().nullable(),
      help_action: z.enum(HELP_ACTIONS).nullable(),
      help_detail: z.string().nullable(),
      confidence: z.number().min(0).max(1),
    })),
  });
  
  // Batch loops if too many
  const BATCH_SIZE = 50;
  const decisions: Pass2Output["loop_decisions"] = [];
  
  for (let i = 0; i < allLoops.length; i += BATCH_SIZE) {
    const batch = allLoops.slice(i, i + BATCH_SIZE);
    
    const prompt = `Consolidate and finalize these loop candidates into loop decisions.

For each unique loop:
- Create a clear title (max 60 chars)
- Determine status: open (needs action), done (completed), dropped (cancelled)
- For OPEN loops owned by ME, set help_action:
  - assist: AI can help (search, draft). help_detail = specific next step
  - remind: User must do it. help_detail = ISO datetime (e.g., "2026-10-25T09:00:00Z")
  - leave: Someone else owns it. help_detail = reason

=== LOOP CANDIDATES (batch ${Math.floor(i / BATCH_SIZE) + 1}) ===
${batch.map(l => `[${l.msg_id}] ${l.chat_id} | ${l.type} by ${l.owner} | "${l.text_snippet}" | status: ${l.status} | closing: ${l.closing_msg || "none"}`).join("\n")}

Return decisions for all loops, preserving status from input when clear.`;
    
    try {
      const result = await generate(prompt, loopSchema, {
        system: "You are finalizing loop decisions. Trust the status from input. Create clear titles.",
        temperature: 0,
      });
      decisions.push(...result.decisions);
    } catch (error) {
      console.error(`  Warning: Loop batch ${Math.floor(i / BATCH_SIZE) + 1} failed, using fallback`);
      // Fallback: convert candidates directly
      for (const loop of batch) {
        decisions.push({
          msg_id: loop.msg_id,
          related_msg_ids: [],
          title: loop.text_snippet.slice(0, 60),
          type: loop.type as any,
          owner: loop.owner,
          chat_id: loop.chat_id,
          due: loop.due,
          status: (loop.status as any) || "open",
          closed_by: loop.closing_msg,
          help_action: loop.owner === "ME" && loop.status === "open" ? "remind" : null,
          help_detail: null,
          confidence: loop.confidence,
        });
      }
    }
  }
  
  return decisions;
}

/**
 * Get goal decisions from Pass 1 data
 */
async function getGoalDecisions(
  pass1Results: Pass1Output[],
  seed: Seed
): Promise<Pass2Output["goal_decisions"]> {
  const allGoalHints = new Set<string>();
  const allTopics = new Set<string>();
  
  for (const p1 of pass1Results) {
    p1.goal_hints.forEach(g => allGoalHints.add(g));
    p1.topics.forEach(t => allTopics.add(t));
  }
  
  if (allGoalHints.size === 0 && seed.goals.length === 0) {
    return [];
  }
  
  const goalSchema = z.object({
    decisions: z.array(z.object({
      title: z.string(),
      area: z.enum(GOAL_AREAS),
      type: z.enum(GOAL_TYPES),
      horizon: z.enum(GOAL_HORIZONS),
      evidence: z.array(z.string()).min(1),
      confidence: z.number().min(0).max(1),
    })),
  });
  
  const prompt = `Identify user goals from the hints and topics. Max 10 goals.

=== SEED GOALS ===
${seed.goals.map(g => `${g.title} (${g.area}, ${g.horizon})`).join("\n") || "(none)"}

=== GOAL HINTS FROM CHATS ===
${[...allGoalHints].join("\n") || "(none)"}

=== TOPICS DISCUSSED ===
${[...allTopics].join(", ")}

Return goal decisions with evidence (message IDs if known, or "inferred" if from topics).
Areas: health, career, finances, relationships, learning, lifestyle, kids, home
Types: outcome, habit, experience, milestone
Horizons: week, month, 3mo, year, multi-year`;
  
  try {
    const result = await generate(prompt, goalSchema, {
      system: "You are identifying user goals. Be selective - only clear goals with evidence.",
      temperature: 0,
    });
    return result.decisions;
  } catch (error) {
    console.error("  Warning: Goal detection failed, using seed goals only");
    return seed.goals.map(g => ({
      title: g.title,
      area: g.area as any,
      type: "outcome" as const,
      horizon: g.horizon as any,
      evidence: ["seed"],
      confidence: 1.0,
    }));
  }
}

// Import z for schema definitions
import { z } from "zod";
import { CIRCLES, LOOP_TYPES, LOOP_STATUSES, HELP_ACTIONS, GOAL_AREAS, GOAL_TYPES, GOAL_HORIZONS } from "../schemas.js";

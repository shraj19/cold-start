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
   - Decide status:
     * open: still pending, needs action
     * done: explicitly completed in the conversation
     * dropped: abandoned, cancelled, or superseded
   - For OPEN loops only, decide help action:
     * assist: Assistant can take action (search, draft, book). help_detail = specific next step
     * remind: Only user can do it. help_detail = ISO datetime like "2026-10-25T09:00:00Z"
     * leave: Someone else owns it or too personal. help_detail = brief reason why
   - Title should be clear action item, max 60 chars

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
        lines.push(`  [${loop.msg_id}] ${loop.type} by ${loop.owner}: "${loop.text_snippet}" ${loop.due ? `(due: ${loop.due})` : ""} conf=${loop.confidence.toFixed(2)}`);
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
  seed: Seed
): Promise<Pass2Output> {
  const pass1Summary = formatPass1ForLLM(pass1Results);
  const seedSummary = formatSeedForLLM(seed);
  
  // Collect all unique person IDs
  const allPersonIds = new Set<string>();
  for (const p1 of pass1Results) {
    p1.participants.forEach(p => allPersonIds.add(p));
  }
  
  const prompt = `${seedSummary}

${pass1Summary}

=== ALL PERSON IDs TO CLASSIFY ===
${[...allPersonIds].sort().join(", ")}

=== YOUR TASK ===
1. Decide circle for each person (use seed circles as ground truth)
2. Create organisation list (use seed orgs + detect "home" if needed)
3. Link people to organisations where appropriate
4. Consolidate loops - merge related messages, decide status
5. Identify goals (max 10)
6. Flag anything uncertain (confidence < 0.6) for investigation`;

  console.error(`Pass 2: Synthesizing ${pass1Results.length} chat extractions, ${allPersonIds.size} people`);
  
  const result = await generate(prompt, pass2OutputSchema, {
    system: SYSTEM_PROMPT,
    temperature: 0,
  });
  
  return result;
}

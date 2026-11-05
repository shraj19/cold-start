// Phase 2: Merge batch results into final output

import type { Seed, Output } from "../types/index.js";
import { outputSchema } from "../types/index.js";
import type { Phase1Output } from "./schemas.js";
import { generate } from "../llm/index.js";
import { createDeepSeekModel } from "../llm/client.js";
import { formatTime } from "./rate-limit.js";

// Use DeepSeek for all merge operations
const deepseekModel = createDeepSeekModel("deepseek-chat");

/**
 * Estimate tokens in Phase 1 results
 */
function estimatePhase1Tokens(results: Phase1Output[]): number {
  const json = JSON.stringify(results);
  return Math.ceil(json.length / 4); // ~4 chars per token
}

/**
 * Build the merge prompt
 */
function buildMergePrompt(results: Phase1Output[], seed: Seed): string {
  // Seed info
  const knownPeople = Object.entries(seed.circles)
    .map(([id, circle]) => `${id}: ${circle}`)
    .join(', ');
  
  const knownOrgs = seed.organisations.join(', ') || 'None';
  
  const seedGoals = seed.goals
    .map(g => `${g.title} (${g.type}, ${g.area})`)
    .join('; ') || 'None';

  // Compact results
  const resultsJson = JSON.stringify(results, null, 1);

  return `You are merging extraction results from ${results.length} batches of WhatsApp chats into a FINAL output.

=== CRITICAL RULES ===
- ME is the person whose chats we're analyzing - NEVER include ME in the people array
- Use seed.circles as ground truth for known people's circles

=== ORGANISATION IDs ===
- For residence: use "home" (NOT "ghar", "house", etc.)
- The user is "owner" of their home and their company

=== LINKS ===
- Colleagues "runs" the company WITH the user
- Staff "supports" the home
- Vendors do NOT link to organisations (they are external)
- Family (spouse, child, parent) do NOT link to organisations

=== HELP ACTION (OPEN loops only) ===
"assist" - Assistant can research/draft WITHOUT user doing work
"remind" - Only user can do the work, just remind them
"leave" - Someone ELSE owns it, stay out (spouse's tasks, colleague's work)

For DONE/DROPPED loops: omit "help" field entirely

=== GOALS ===
- habit: Regular activities (running, meditation)
- milestone: Specific targets with numbers/dates (10 clients by March)
- experience: Trips, events, celebrations (Coorg trip)

## Known Information (Ground Truth)
- Pre-tagged people: ${knownPeople || 'None'}
- Organizations: ${knownOrgs}
- User's goals: ${seedGoals}

## Batch Results to Merge
${resultsJson}

## DEDUPLICATION
1. People: same phone OR same name = same person, keep ONE
2. Orgs: same ID = merge
3. Loops: same task = one loop, done > open status wins
4. Every chat appears EXACTLY ONCE

## EXACT OUTPUT SCHEMA:
{
  "people": [{"id": "P123", "circle": "spouse|child|parent|in-law|sibling|relative|friend|colleague|client|vendor|partner|staff", "links": [{"organisation": "orgid", "link": "runs|supports"}], "looks_after": ["P456"]}],
  "organisations": [{"id": "home", "name": "string", "type": "company|residence|vacation home|workspace|society|school|other", "side": "home|work", "role": "owner|partner|helper|resident|parent|member|other"}],
  "chats": [{"chat_id": "C01", "person": "P123"} or {"chat_id": "C02", "organisation": "orgid"}],
  "goals": [{"title": "string", "area": "self|spouse|kids|parents|work|friends|experiences|finances|health|home", "type": "habit|milestone|experience", "horizon": "3mo|1yr|3yr|5yr", "evidence": ["M001"]}],
  "open_loops": [{"title": "string", "type": "commitment|followup|deadline|question", "owner": "ME|person_id", "chat_id": "C01", "source_msg": "M123", "status": "open|done|dropped", "due": "YYYY-MM-DD|null", "closed_by": "M456|null", "help": {"action": "assist|remind|leave"} (ONLY if status=open)}]
}

Output ONLY valid JSON:`;
}

/**
 * Run Phase 2: Merge all batch results
 */
export async function runPhase2(
  results: Phase1Output[],
  seed: Seed
): Promise<Output> {
  const startTime = Date.now();
  const estimatedTokens = estimatePhase1Tokens(results);
  
  console.error(`\nPhase 2: Merging ${results.length} batch results...`);
  console.error(`  Input size: ~${Math.round(estimatedTokens / 1000)}K tokens`);
  
  // Check if we need hierarchical merge
  if (estimatedTokens > 50_000) {
    console.error(`  Input too large, using hierarchical merge...`);
    return runHierarchicalMerge(results, seed);
  }
  
  // Single merge pass
  const prompt = buildMergePrompt(results, seed);
  
  try {
    console.error(`    Using: deepseek-chat`);
    const output = await generate(prompt, outputSchema, {
      maxFixAttempts: 3,
      temperature: 0,
      customModel: deepseekModel,
    });
    
    console.error(`  ✓ Merge complete in ${formatTime(Date.now() - startTime)}`);
    console.error(`    ${output.people.length} people, ${output.organisations.length} orgs, ${output.open_loops.length} loops`);
    
    return output;
  } catch (error) {
    console.error(`  ✗ Merge failed: ${error instanceof Error ? error.message : error}`);
    console.error(`  Falling back to rule-based merge...`);
    return fallbackMerge(results, seed);
  }
}

/**
 * Hierarchical merge for large inputs
 */
async function runHierarchicalMerge(
  results: Phase1Output[],
  seed: Seed
): Promise<Output> {
  const chunkSize = 5;
  const chunks: Phase1Output[][] = [];
  
  // Group into chunks
  for (let i = 0; i < results.length; i += chunkSize) {
    chunks.push(results.slice(i, i + chunkSize));
  }
  
  console.error(`  Hierarchical: ${chunks.length} chunks of ~${chunkSize} batches`);
  
  // Merge each chunk into intermediate results
  const intermediateResults: Phase1Output[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    console.error(`  Merging chunk ${i + 1}/${chunks.length}...`);
    
    // For intermediate merges, we output Phase1Output format
    const chunk = chunks[i]!;
    const chunkPrompt = buildIntermediateMergePrompt(chunk, i);
    
    try {
      const { phase1OutputSchema } = await import("./schemas.js");
      const merged = await generate(chunkPrompt, phase1OutputSchema, {
        maxFixAttempts: 2,
        temperature: 0,
        customModel: deepseekModel,
      });
      intermediateResults.push(merged);
    } catch {
      // If chunk merge fails, just flatten the results
      intermediateResults.push(...chunk);
    }
  }
  
  // Final merge
  console.error(`  Final merge of ${intermediateResults.length} intermediate results...`);
  return runPhase2(intermediateResults, seed);
}

/**
 * Build prompt for intermediate merge (Phase1Output → Phase1Output)
 */
function buildIntermediateMergePrompt(results: Phase1Output[], chunkId: number): string {
  const resultsJson = JSON.stringify(results, null, 1);
  
  return `Merge these ${results.length} batch results into ONE combined batch result.

## Input
${resultsJson}

## Task
1. Deduplicate people (same phone or name = same person)
2. Deduplicate organizations (same ID = same org, merge members)
3. Deduplicate loops (same task = one loop, latest status wins)
4. Keep all chat_assignments

## Output
Return a SINGLE Phase1Output object:
{
  "batch_id": ${chunkId * 100},
  "people": [...merged...],
  "organizations": [...merged...],
  "loops": [...merged...],
  "goals": [...merged...],
  "chat_assignments": [...all assignments...]
}

Output JSON only:`;
}

/**
 * Fallback: Rule-based merge without LLM
 */
function fallbackMerge(results: Phase1Output[], seed: Seed): Output {
  console.error(`  Running rule-based fallback merge...`);
  
  // Collect all entities
  const peopleMap = new Map<string, Phase1Output["people"][0]>();
  const orgsMap = new Map<string, Phase1Output["organizations"][0]>();
  const loopsMap = new Map<string, Phase1Output["loops"][0]>();
  const goalsMap = new Map<string, Phase1Output["goals"][0]>();
  const chatAssignments = new Map<string, Phase1Output["chat_assignments"][0]>();
  
  for (const result of results) {
    // People: dedupe by ID
    for (const p of result.people) {
      if (!peopleMap.has(p.id)) {
        peopleMap.set(p.id, p);
      }
    }
    
    // Orgs: dedupe by ID
    for (const o of result.organizations) {
      if (!orgsMap.has(o.id)) {
        orgsMap.set(o.id, o);
      } else {
        // Merge members
        const existing = orgsMap.get(o.id)!;
        const allMembers = new Set([...existing.member_ids, ...o.member_ids]);
        existing.member_ids = [...allMembers];
      }
    }
    
    // Loops: dedupe by ID, prefer done/dropped over open
    for (const l of result.loops) {
      const existing = loopsMap.get(l.id);
      if (!existing) {
        loopsMap.set(l.id, l);
      } else if (l.status !== "open" && existing.status === "open") {
        loopsMap.set(l.id, l); // Completed status wins
      }
    }
    
    // Goals: dedupe by ID
    for (const g of result.goals) {
      if (!goalsMap.has(g.id)) {
        goalsMap.set(g.id, g);
      }
    }
    
    // Chat assignments: first one wins
    for (const ca of result.chat_assignments) {
      if (!chatAssignments.has(ca.chat_id)) {
        chatAssignments.set(ca.chat_id, ca);
      }
    }
  }
  
  // Build person→org links from org member_ids
  const personLinks = new Map<string, { organisation: string; link: "runs" | "supports" }[]>();
  for (const org of orgsMap.values()) {
    for (const memberId of org.member_ids) {
      if (memberId === "ME") continue;
      const links = personLinks.get(memberId) || [];
      // If it's a company and they're a member, they likely "runs" or "supports"
      // Use "supports" for staff at home, "runs" for colleagues at work
      const linkType: "runs" | "supports" = 
        org.type === "residence" ? "supports" : "runs";
      // Avoid duplicates
      if (!links.some(l => l.organisation === org.id)) {
        links.push({ organisation: org.id, link: linkType });
      }
      personLinks.set(memberId, links);
    }
  }
  
  // Convert to output format
  const people = [...peopleMap.values()]
    .filter(p => p.id !== "ME") // Don't include ME
    .map(p => {
      // Map "unknown" circle to a valid one (default to "friend")
      const validCircle = p.circle === "unknown" ? "friend" : p.circle;
      return {
        id: p.id,
        circle: validCircle as Output["people"][0]["circle"],
        links: personLinks.get(p.id) || [],
        looks_after: [] as string[],
      };
    });
  
  const organisations = [...orgsMap.values()].map(o => ({
    id: o.id,
    name: o.name,
    type: o.type,
    side: o.side,
    role: o.role,
  }));
  
  const chats = [...chatAssignments.values()].map(ca => {
    if (ca.person_id) {
      return { chat_id: ca.chat_id, person: ca.person_id };
    } else if (ca.org_id) {
      return { chat_id: ca.chat_id, organisation: ca.org_id };
    } else {
      // Default to first org or "home"
      return { chat_id: ca.chat_id, organisation: "home" };
    }
  });
  
  const goals = [...goalsMap.values()]
    .filter(g => g.person_id === "ME")
    .slice(0, 10)
    .map(g => ({
      title: g.title,
      area: g.area,
      type: g.type,
      horizon: g.horizon,
      evidence: g.evidence_msg_ids,
    }));
  
  // Include ALL loops (open, done, dropped) - validator checks for correct status tracking
  const allLoops = [...loopsMap.values()];
  
  const open_loops = allLoops
    .map(l => ({
      title: l.title,
      type: l.type,
      owner: l.owner_id,
      chat_id: l.chat_id,
      source_msg: l.source_msg_id,
      status: l.status as "open" | "done" | "dropped",
      due: l.due || null,
      closed_by: l.closed_by_msg_id || null,
      // Set help action based on owner
      help: l.status === "open" 
        ? { action: (l.helper_action || (l.owner_id === "ME" ? "remind" : "leave")) as "assist" | "remind" | "leave" }
        : undefined,
    }))
    // Filter: for output, include open loops and done/dropped for tracking
    .filter(l => l.status === "open" || l.closed_by !== null);
  
  return {
    people,
    organisations,
    chats,
    goals,
    open_loops,
  };
}

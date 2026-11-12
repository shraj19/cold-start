// Merge batch outputs using confidence scores

import type { Seed, Person, PersonLink, Organisation, ChatOutput, Goal, OpenLoop } from "../types/index.js";
import type { BatchOutput, CircleExtract, PersonLinkExtract, OrgExtract, ChatExtract, GoalExtract, LoopExtract } from "./types.js";

interface MergedOutput {
  people: Person[];
  organisations: Organisation[];
  chats: ChatOutput[];
  goals: Goal[];
  loops: OpenLoop[];
}

/**
 * Merge circle extractions and person links - highest confidence wins, seed overrides all
 */
function mergeCirclesAndLinks(
  batches: BatchOutput[],
  seed: Seed
): Person[] {
  // Collect all circle extractions per person
  const circleByPerson = new Map<string, CircleExtract[]>();
  
  for (const batch of batches) {
    for (const circle of batch.circles) {
      if (circle.person_id === "ME") continue;
      const list = circleByPerson.get(circle.person_id) ?? [];
      list.push(circle);
      circleByPerson.set(circle.person_id, list);
    }
  }
  
  // Collect all link extractions per person
  const linksByPerson = new Map<string, PersonLinkExtract[]>();
  
  for (const batch of batches) {
    for (const link of batch.person_links || []) {
      const list = linksByPerson.get(link.person_id) ?? [];
      list.push(link);
      linksByPerson.set(link.person_id, list);
    }
  }
  
  const people: Person[] = [];
  
  // Get all unique person IDs
  const allPersonIds = new Set([...circleByPerson.keys(), ...linksByPerson.keys()]);
  
  for (const personId of allPersonIds) {
    const circleExtracts = circleByPerson.get(personId) ?? [];
    const linkExtracts = linksByPerson.get(personId) ?? [];
    
    // Seed overrides circle
    const seedCircle = seed.circles[personId];
    let circle: Person["circle"];
    
    if (seedCircle) {
      circle = seedCircle as Person["circle"];
    } else if (circleExtracts.length > 0) {
      const best = circleExtracts.reduce((a, b) => a.confidence > b.confidence ? a : b);
      circle = best.circle;
    } else {
      continue; // Skip if no circle info
    }
    
    const person: Person = { id: personId, circle };
    
    // Add links if any (dedupe by org_id, highest confidence wins)
    if (linkExtracts.length > 0) {
      const linksByOrg = new Map<string, PersonLinkExtract>();
      for (const link of linkExtracts) {
        const existing = linksByOrg.get(link.org_id);
        if (!existing || link.confidence > existing.confidence) {
          linksByOrg.set(link.org_id, link);
        }
      }
      
      person.links = [...linksByOrg.values()].map(link => ({
        organisation: link.org_id,
        link: link.link,
      }));
    }
    
    people.push(person);
  }
  
  return people;
}

/**
 * Merge org extractions - highest confidence wins, dedupe by name similarity
 */
function mergeOrgs(batches: BatchOutput[]): Organisation[] {
  // Collect all orgs
  const allOrgs: OrgExtract[] = [];
  for (const batch of batches) {
    allOrgs.push(...batch.orgs);
  }
  
  // Group by normalized name
  const byName = new Map<string, OrgExtract[]>();
  for (const org of allOrgs) {
    const key = org.name.toLowerCase().replace(/\s+/g, ' ').trim();
    const list = byName.get(key) ?? [];
    list.push(org);
    byName.set(key, list);
  }
  
  const orgs: Organisation[] = [];
  
  for (const extracts of byName.values()) {
    const best = extracts.reduce((a, b) => a.confidence > b.confidence ? a : b);
    orgs.push({
      id: best.id,
      name: best.name,
      type: best.type,
      side: best.side,
      role: best.role,
    });
  }
  
  return orgs;
}

/**
 * Merge chat assignments - highest confidence wins
 */
function mergeChats(
  batches: BatchOutput[],
  orgs: Organisation[]
): ChatOutput[] {
  // Collect all extractions per chat
  const extractsByChatId = new Map<string, ChatExtract[]>();
  
  for (const batch of batches) {
    for (const chat of batch.chats) {
      const list = extractsByChatId.get(chat.chat_id) ?? [];
      list.push(chat);
      extractsByChatId.set(chat.chat_id, list);
    }
  }
  
  // Build org ID mapping (for validation)
  const orgIds = new Set(orgs.map(org => org.id));
  
  const chats: ChatOutput[] = [];
  
  for (const [chatId, extracts] of extractsByChatId) {
    const best = extracts.reduce((a, b) => a.confidence > b.confidence ? a : b);
    
    if (best.person_id) {
      chats.push({ chat_id: chatId, person: best.person_id });
    } else if (best.org_id && orgIds.has(best.org_id)) {
      chats.push({ chat_id: chatId, organisation: best.org_id });
    }
    // Skip if neither valid person nor org
  }
  
  return chats;
}

/**
 * Merge goals - dedupe by similar title + area, combine evidence
 */
function mergeGoals(batches: BatchOutput[]): Goal[] {
  const allGoals: GoalExtract[] = [];
  for (const batch of batches) {
    allGoals.push(...batch.goals);
  }
  
  // Group by area + title similarity
  const groups: GoalExtract[][] = [];
  
  for (const goal of allGoals) {
    const titleWords = new Set(goal.title.toLowerCase().split(/\s+/));
    
    // Find matching group
    let found = false;
    for (const group of groups) {
      const first = group[0]!;
      if (first.area !== goal.area) continue;
      
      // Check word overlap
      const firstWords = new Set(first.title.toLowerCase().split(/\s+/));
      const overlap = [...titleWords].filter(w => firstWords.has(w)).length;
      const similarity = overlap / Math.max(titleWords.size, firstWords.size);
      
      if (similarity > 0.5) {
        group.push(goal);
        found = true;
        break;
      }
    }
    
    if (!found) {
      groups.push([goal]);
    }
  }
  
  // Pick best from each group, combine evidence
  const goals: Goal[] = [];
  
  for (const group of groups) {
    const best = group.reduce((a, b) => a.confidence > b.confidence ? a : b);
    const allEvidence = new Set(group.flatMap(goal => goal.evidence));
    
    goals.push({
      title: best.title,
      area: best.area,
      type: best.type,
      horizon: best.horizon,
      evidence: [...allEvidence],
    });
  }
  
  // Sort by confidence (highest first), then cap at 10
  // Goals with more evidence (appearing in multiple batches) rank higher
  goals.sort((a, b) => {
    // More evidence = more confident
    const evidenceA = a.evidence.length;
    const evidenceB = b.evidence.length;
    return evidenceB - evidenceA;
  });
  
  return goals.slice(0, 10); // Max 10 goals - only most confident ones
}

/**
 * Merge loops - dedupe by source_msg
 * Status priority: done/dropped > open (terminal states win)
 * Among same status, highest confidence wins
 */
function mergeLoops(batches: BatchOutput[]): OpenLoop[] {
  // Collect all loops, dedupe by source_msg
  const extractsBySourceMsg = new Map<string, LoopExtract[]>();
  
  for (const batch of batches) {
    for (const loop of batch.loops) {
      const list = extractsBySourceMsg.get(loop.source_msg) ?? [];
      list.push(loop);
      extractsBySourceMsg.set(loop.source_msg, list);
    }
  }
  
  const loops: OpenLoop[] = [];
  
  for (const extracts of extractsBySourceMsg.values()) {
    // Separate by status - terminal states (done/dropped) take priority
    const terminal = extracts.filter(extract => extract.status === "done" || extract.status === "dropped");
    const open = extracts.filter(extract => extract.status === "open");
    
    // If any batch marked it terminal, use that (more context = saw closing msg)
    // Among terminal, prefer done > dropped, then highest confidence
    let best: LoopExtract;
    if (terminal.length > 0) {
      // Prefer "done" over "dropped", then by confidence
      const done = terminal.filter(extract => extract.status === "done");
      const dropped = terminal.filter(extract => extract.status === "dropped");
      
      if (done.length > 0) {
        best = done.reduce((a, b) => a.confidence > b.confidence ? a : b);
      } else {
        best = dropped.reduce((a, b) => a.confidence > b.confidence ? a : b);
      }
    } else {
      // All open - pick highest confidence
      best = open.reduce((a, b) => a.confidence > b.confidence ? a : b);
    }
    
    // Convert to output format
    const loop: OpenLoop = {
      title: best.title,
      type: best.type,
      owner: best.owner,
      chat_id: best.chat_id,
      source_msg: best.source_msg,
      due: best.due,
      status: best.status,
      closed_by: best.closed_by,
    };
    
    // Add help for ALL open loops (FAQ: "give one on every open loop")
    if (best.status === "open") {
      if (best.help) {
        loop.help = {
          action: best.help.action,
          next_step: best.help.next_step ?? undefined,
          needs_yes: best.help.needs_yes ?? undefined,
          remind_at: best.help.remind_at ?? undefined,
          reason: best.help.reason ?? undefined,
        };
      } else {
        // Default: if owner is not ME (followup), default to "leave"
        // If owner is ME but no help specified, default to "remind"
        loop.help = best.owner === "ME" || best.owner === null
          ? { action: "remind", remind_at: undefined }
          : { action: "leave", reason: "Waiting on this person to complete" };
      }
    }
    
    loops.push(loop);
  }
  
  return loops;
}

/**
 * Merge all batch outputs into final structure
 */
export function mergeBatches(batches: BatchOutput[], seed: Seed): MergedOutput {
  const people = mergeCirclesAndLinks(batches, seed);
  const organisations = mergeOrgs(batches);
  const chats = mergeChats(batches, organisations);
  const goals = mergeGoals(batches);
  const loops = mergeLoops(batches);
  
  return { people, organisations, chats, goals, loops };
}

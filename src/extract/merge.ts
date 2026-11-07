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
    for (const c of batch.circles) {
      if (c.person_id === "ME") continue;
      const list = circleByPerson.get(c.person_id) ?? [];
      list.push(c);
      circleByPerson.set(c.person_id, list);
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
      
      person.links = [...linksByOrg.values()].map(l => ({
        organisation: l.org_id,
        link: l.link,
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
  const byChat = new Map<string, ChatExtract[]>();
  
  for (const batch of batches) {
    for (const c of batch.chats) {
      const list = byChat.get(c.chat_id) ?? [];
      list.push(c);
      byChat.set(c.chat_id, list);
    }
  }
  
  // Build org ID mapping (for validation)
  const orgIds = new Set(orgs.map(o => o.id));
  
  const chats: ChatOutput[] = [];
  
  for (const [chatId, extracts] of byChat) {
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
    const allEvidence = new Set(group.flatMap(g => g.evidence));
    
    goals.push({
      title: best.title,
      area: best.area,
      type: best.type,
      horizon: best.horizon,
      evidence: [...allEvidence],
    });
  }
  
  return goals.slice(0, 10); // Max 10 goals
}

/**
 * Merge loops - dedupe by source_msg, highest confidence wins
 */
function mergeLoops(batches: BatchOutput[]): OpenLoop[] {
  // Collect all loops, dedupe by source_msg
  const bySource = new Map<string, LoopExtract[]>();
  
  for (const batch of batches) {
    for (const loop of batch.loops) {
      const list = bySource.get(loop.source_msg) ?? [];
      list.push(loop);
      bySource.set(loop.source_msg, list);
    }
  }
  
  const loops: OpenLoop[] = [];
  
  for (const extracts of bySource.values()) {
    // Pick highest confidence
    const best = extracts.reduce((a, b) => a.confidence > b.confidence ? a : b);
    
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
    
    // Only add help for open loops
    if (best.status === "open" && best.help) {
      loop.help = best.help;
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

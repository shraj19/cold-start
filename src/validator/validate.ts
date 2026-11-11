// Output validation - checks shape and references

import type { Chat, Message, Output, ValidationResult } from "./types.js";
import {
  CIRCLES, ORG_TYPES, ORG_ROLES, AREAS, GOAL_TYPES,
  HORIZONS, LOOP_TYPES, STATUSES, ACTIONS
} from "./constants.js";

/**
 * Validate output structure and references
 * Returns list of errors (empty = valid)
 */
export function validate(out: unknown, chats: Chat[], messages: Message[]): ValidationResult {
  const errors: string[] = [];

  // Basic structure
  if (!out || typeof out !== "object") {
    return { valid: false, errors: ["The output must be a JSON object."] };
  }

  const output = out as Record<string, unknown>;
  const requiredKeys = ["people", "organisations", "chats", "goals", "open_loops"];

  for (const key of requiredKeys) {
    if (!Array.isArray(output[key])) {
      errors.push(`"${key}" must be a list.`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Extra keys
  const extraKeys = Object.keys(output).filter(k => !requiredKeys.includes(k));
  if (extraKeys.length > 0) {
    errors.push(`Unknown top-level keys: ${extraKeys.sort().join(", ")}.`);
  }

  // Build reference sets
  const chatIds = new Set(chats.map(c => c.chat_id));
  const msgIds = new Set(messages.map(m => m.id));
  const personIds = new Set(
    chats.flatMap(c => c.participants).filter(p => p !== "ME")
  );
  const orgIds = new Set<string>();

  const typed = output as Output;

  // Validate organisations
  for (let i = 0; i < typed.organisations.length; i++) {
    const o = typed.organisations[i];
    const where = `organisations[${i}]`;

    if (!o || !o.id) {
      errors.push(`${where} needs an id.`);
      continue;
    }
    if (orgIds.has(o.id)) {
      errors.push(`${where}: the id "${o.id}" is used twice.`);
    }
    orgIds.add(o.id);

    if (!o.name) {
      errors.push(`${where} needs a name.`);
    }
    if (!ORG_TYPES.has(o.type)) {
      errors.push(`${where}: type must be one of ${[...ORG_TYPES].sort().join(", ")}.`);
    }
    if (o.side !== "home" && o.side !== "work") {
      errors.push(`${where}: side must be "home" or "work".`);
    }
    if (!ORG_ROLES.has(o.role)) {
      errors.push(`${where}: role must be one of ${[...ORG_ROLES].sort().join(", ")}.`);
    }
  }

  // Validate people
  const seenPeople = new Set<string>();
  for (let i = 0; i < typed.people.length; i++) {
    const p = typed.people[i];
    const where = `people[${i}]`;

    if (!p?.id || !personIds.has(p.id)) {
      errors.push(`${where}: "${p?.id}" is not a person in the input (and ME is never listed).`);
      continue;
    }
    if (seenPeople.has(p.id)) {
      errors.push(`${where}: "${p.id}" is listed twice.`);
    }
    seenPeople.add(p.id);

    if (!CIRCLES.has(p.circle)) {
      errors.push(`${where}: circle must be one of ${[...CIRCLES].sort().join(", ")}.`);
    }

    for (const link of p.links || []) {
      if (!orgIds.has(link.organisation)) {
        errors.push(`${where}: links to an unknown organisation "${link.organisation}".`);
      }
      if (link.link !== "runs" && link.link !== "supports") {
        errors.push(`${where}: a link must be "runs" or "supports".`);
      }
    }

    for (const other of p.looks_after || []) {
      if (!personIds.has(other)) {
        errors.push(`${where}: looks_after names an unknown person "${other}".`);
      }
    }
  }

  // Validate chats
  const tiedChats = new Set<string>();
  for (let i = 0; i < typed.chats.length; i++) {
    const c = typed.chats[i];
    const where = `chats[${i}]`;

    if (!c?.chat_id || !chatIds.has(c.chat_id)) {
      errors.push(`${where}: "${c?.chat_id}" is not a chat in the input.`);
      continue;
    }
    if (tiedChats.has(c.chat_id)) {
      errors.push(`${where}: "${c.chat_id}" is tied twice. Tie each chat once.`);
    }
    tiedChats.add(c.chat_id);

    const hasPerson = "person" in c && c.person !== undefined;
    const hasOrg = "organisation" in c && c.organisation !== undefined;

    if (hasPerson === hasOrg) {
      errors.push(`${where}: give exactly one of person or organisation.`);
    } else if (hasPerson && !personIds.has(c.person!)) {
      errors.push(`${where}: unknown person "${c.person}".`);
    } else if (hasOrg && !orgIds.has(c.organisation!)) {
      errors.push(`${where}: unknown organisation "${c.organisation}".`);
    }
  }

  const missingChats = [...chatIds].filter(id => !tiedChats.has(id));
  if (missingChats.length > 0) {
    errors.push(`${missingChats.length} chat(s) are not tied to anyone, for example ${missingChats.slice(0, 3).join(", ")}.`);
  }

  // Validate goals
  if (typed.goals.length > 10) {
    errors.push("At most 10 goals.");
  }
  for (const [i, g] of typed.goals.entries()) {
    const where = `goals[${i}]`;

    if (!g.title) {
      errors.push(`${where} needs a title.`);
    }
    if (!AREAS.has(g.area)) {
      errors.push(`${where}: area must be one of ${[...AREAS].sort().join(", ")}.`);
    }
    if (!GOAL_TYPES.has(g.type)) {
      errors.push(`${where}: type must be one of ${[...GOAL_TYPES].sort().join(", ")}.`);
    }
    if (!HORIZONS.has(g.horizon)) {
      errors.push(`${where}: horizon must be one of ${[...HORIZONS].sort().join(", ")}.`);
    }
    if (!g.evidence || g.evidence.length === 0) {
      errors.push(`${where}: give at least one evidence message.`);
    }
    for (const m of g.evidence || []) {
      if (!msgIds.has(m)) {
        errors.push(`${where}: evidence "${m}" is not a message in the input.`);
      }
    }
  }

  // Validate open_loops
  for (const [i, l] of typed.open_loops.entries()) {
    const where = `open_loops[${i}]`;

    if (!l.title) {
      errors.push(`${where} needs a title.`);
    }
    if (!LOOP_TYPES.has(l.type)) {
      errors.push(`${where}: type must be one of ${[...LOOP_TYPES].sort().join(", ")}.`);
    }
    if (l.owner !== "ME" && l.owner !== null && !personIds.has(l.owner)) {
      errors.push(`${where}: owner must be "ME", null, or a person id.`);
    }
    if (!chatIds.has(l.chat_id)) {
      errors.push(`${where}: unknown chat_id.`);
    }
    if (!msgIds.has(l.source_msg)) {
      errors.push(`${where}: source_msg is not a message in the input.`);
    }
    if (!STATUSES.has(l.status)) {
      errors.push(`${where}: status must be one of ${[...STATUSES].sort().join(", ")}.`);
    }
    if (l.closed_by !== undefined && l.closed_by !== null && !msgIds.has(l.closed_by)) {
      errors.push(`${where}: closed_by is not a message in the input.`);
    }

    if (l.help !== undefined) {
      if (l.status !== "open") {
        errors.push(`${where}: help is only for open loops.`);
      }
      if (!l.help || !ACTIONS.has(l.help.action)) {
        errors.push(`${where}: help.action must be one of ${[...ACTIONS].sort().join(", ")}.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

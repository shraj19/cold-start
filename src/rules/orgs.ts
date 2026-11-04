// Rule-based organisation detection
// Uses seed hints + chat name patterns

import type { Chat, Seed, OrganisationOut } from "../types.js";

export interface OrgCandidate {
  id: string;
  name: string;
  type: OrganisationOut["type"];
  side: OrganisationOut["side"];
  role: OrganisationOut["role"];
  confidence: "high" | "medium" | "low";
  reason: string;
  chatIds: string[]; // Chats that belong to this org
}

// ----- PATTERNS -----

const HOME_PATTERNS = [
  /ghar|home|family|परिवार|घर|house/i,
];

const WORK_PATTERNS = [
  /team|office|work|company|staff|business/i,
];

// ----- MAIN EXTRACTION -----

export function detectOrganisations(
  chats: Chat[],
  seed: Seed
): OrgCandidate[] {
  const orgs: OrgCandidate[] = [];
  const usedChatIds = new Set<string>();

  // --- RULE 1: Create orgs from seed organisation names ---
  for (const seedOrgName of seed.organisations) {
    // Use first word only as ID (e.g., "Brightside Design" -> "brightside")
    const firstWord = seedOrgName.split(/\s+/)[0] ?? seedOrgName;
    const orgId = firstWord.toLowerCase().replace(/[^a-z0-9]+/g, "");
    
    // Find chats that match this org name
    const matchingChats = chats.filter((c) => {
      const nameLower = c.name.toLowerCase();
      const seedLower = seedOrgName.toLowerCase();
      return (
        c.is_group &&
        (nameLower.includes(seedLower) ||
          nameLower.includes(seedLower.split(" ")[0]!) ||
          seedLower.includes(nameLower.replace(/[^a-z0-9]/g, "")))
      );
    });

    for (const c of matchingChats) {
      usedChatIds.add(c.chat_id);
    }

    orgs.push({
      id: orgId,
      name: seedOrgName,
      type: "company", // Seed orgs are likely companies
      side: "work",
      role: "owner", // User likely owns/runs their own orgs
      confidence: "high",
      reason: `From seed data`,
      chatIds: matchingChats.map((c) => c.chat_id),
    });
  }

  // --- RULE 2: Detect "home" org from family/ghar groups ---
  const homeChats = chats.filter(
    (c) => c.is_group && !usedChatIds.has(c.chat_id) && HOME_PATTERNS.some((p) => p.test(c.name))
  );

  if (homeChats.length > 0) {
    for (const c of homeChats) {
      usedChatIds.add(c.chat_id);
    }

    orgs.push({
      id: "home",
      name: "Home",
      type: "residence",
      side: "home",
      role: "owner",
      confidence: "medium",
      reason: "Detected from chat names containing home/ghar/family",
      chatIds: homeChats.map((c) => c.chat_id),
    });
  }

  // --- RULE 3: Work/team groups not matched to seed orgs ---
  const unmatchedWorkChats = chats.filter(
    (c) => c.is_group && !usedChatIds.has(c.chat_id) && WORK_PATTERNS.some((p) => p.test(c.name))
  );

  // Group similar named chats (they might be same org)
  // For now, create one "other_work" org if any exist
  if (unmatchedWorkChats.length > 0) {
    for (const c of unmatchedWorkChats) {
      usedChatIds.add(c.chat_id);
    }

    orgs.push({
      id: "other_work",
      name: "Other Work",
      type: "company",
      side: "work",
      role: "member",
      confidence: "low",
      reason: "Work-related chats not matched to seed orgs",
      chatIds: unmatchedWorkChats.map((c) => c.chat_id),
    });
  }

  return orgs;
}

/**
 * Convert org candidates to final OrganisationOut format
 */
export function finalizeOrganisations(candidates: OrgCandidate[]): OrganisationOut[] {
  return candidates
    .filter((c) => c.confidence !== "low" || c.chatIds.length > 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      side: c.side,
      role: c.role,
    }));
}

/**
 * Build a map of org name → org id for chat mapping
 */
export function buildOrgIdMap(orgs: OrgCandidate[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const org of orgs) {
    map.set(org.name, org.id);
    map.set(org.name.toLowerCase(), org.id);
  }
  return map;
}

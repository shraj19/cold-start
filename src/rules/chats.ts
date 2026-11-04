// Rule-based chat mapping — NO LLM needed for most cases
// 1:1 chats → tie to the other person (100% accurate)
// Group chats → need hints to tie to org

import type { Chat, Seed, ChatOut } from "../types.js";

export interface ChatMapping {
  chat_id: string;
  person?: string;
  organisation?: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

/**
 * Map chats to people/orgs using rules only.
 * Returns mappings with confidence levels.
 */
export function mapChatsWithRules(
  chats: Chat[],
  seed: Seed,
  orgIdMap: Map<string, string> // org name → org id
): ChatMapping[] {
  const mappings: ChatMapping[] = [];

  for (const chat of chats) {
    // --- RULE 1: 1:1 chats → tie to the other person (100% accurate) ---
    if (!chat.is_group) {
      const other = chat.participants.find((p) => p !== "ME");
      if (other) {
        mappings.push({
          chat_id: chat.chat_id,
          person: other,
          confidence: "high",
          reason: "1:1 chat with this person",
        });
        continue;
      }
    }

    // --- RULE 2: Group chat name matches seed org name ---
    const chatNameLower = chat.name.toLowerCase();
    for (const seedOrg of seed.organisations) {
      const seedOrgLower = seedOrg.toLowerCase();
      if (
        chatNameLower.includes(seedOrgLower) ||
        seedOrgLower.includes(chatNameLower.replace(/[^a-z0-9]/g, ""))
      ) {
        const orgId = orgIdMap.get(seedOrg) ?? seedOrg.toLowerCase().replace(/\s+/g, "_");
        mappings.push({
          chat_id: chat.chat_id,
          organisation: orgId,
          confidence: "high",
          reason: `Chat name matches seed org "${seedOrg}"`,
        });
        continue;
      }
    }

    // --- RULE 3: Home/family group patterns ---
    if (/ghar|home|family|परिवार|घर/i.test(chat.name)) {
      mappings.push({
        chat_id: chat.chat_id,
        organisation: "home",
        confidence: "medium",
        reason: "Chat name suggests home/family group",
      });
      continue;
    }

    // --- RULE 4: Team/work patterns in name ---
    if (/team|office|work|company|staff/i.test(chat.name)) {
      // Try to match with seed org
      const matchedOrg = seed.organisations.find((org) =>
        chat.name.toLowerCase().includes(org.toLowerCase().split(" ")[0]!)
      );
      if (matchedOrg) {
        const orgId = orgIdMap.get(matchedOrg) ?? matchedOrg.toLowerCase().replace(/\s+/g, "_");
        mappings.push({
          chat_id: chat.chat_id,
          organisation: orgId,
          confidence: "medium",
          reason: `Team chat likely belongs to "${matchedOrg}"`,
        });
        continue;
      }
    }

    // --- LOW CONFIDENCE: Need LLM to decide ---
    mappings.push({
      chat_id: chat.chat_id,
      confidence: "low",
      reason: "Group chat - needs LLM to determine org/person",
    });
  }

  return mappings;
}

/**
 * Convert mappings to final ChatOut format.
 * Low confidence items get a fallback (first non-ME participant or dummy org).
 */
export function finalizeChatMappings(
  mappings: ChatMapping[],
  chats: Chat[]
): ChatOut[] {
  return mappings.map((m) => {
    if (m.person) {
      return { chat_id: m.chat_id, person: m.person };
    }
    if (m.organisation) {
      return { chat_id: m.chat_id, organisation: m.organisation };
    }
    // Fallback for low confidence
    const chat = chats.find((c) => c.chat_id === m.chat_id);
    if (chat && !chat.is_group) {
      const other = chat.participants.find((p) => p !== "ME");
      if (other) return { chat_id: m.chat_id, person: other };
    }
    // Last resort: create org from chat
    return { chat_id: m.chat_id, organisation: "org_" + m.chat_id };
  });
}

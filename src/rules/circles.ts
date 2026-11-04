// Rule-based circle hints — patterns that strongly suggest relationships
// LLM confirms/corrects these hints

import type { Chat, Message, Seed, Circle } from "../types.js";

export interface CircleHint {
  personId: string;
  names: string[];
  suggestedCircle: Circle | null;
  confidence: "high" | "medium" | "low";
  signals: string[];
  messageCount: number;
  chatIds: string[];
}

// ----- NAME-BASED PATTERNS -----

const NAME_PATTERNS: Array<{ pattern: RegExp; circle: Circle; confidence: "high" | "medium" }> = [
  // Staff patterns
  { pattern: /\b(driver|chauffeur)\b/i, circle: "staff", confidence: "high" },
  { pattern: /\b(cook|chef|khansama)\b/i, circle: "staff", confidence: "high" },
  { pattern: /\b(maid|helper|bai|didi)\b/i, circle: "staff", confidence: "medium" },
  { pattern: /\b(nanny|ayah|babysitter)\b/i, circle: "staff", confidence: "high" },
  { pattern: /\b(gardener|mali|watchman|guard|chowkidar)\b/i, circle: "staff", confidence: "high" },
  
  // Vendor patterns
  { pattern: /\b(electrician|plumber|carpenter|mechanic)\b/i, circle: "vendor", confidence: "high" },
  { pattern: /\b(printer|supplier|vendor|dealer)\b/i, circle: "vendor", confidence: "medium" },
  { pattern: /\b(shop|store|mart|agency)\b/i, circle: "vendor", confidence: "medium" },
  
  // Family patterns in name
  { pattern: /\b(papa|dad|father|abbu|pitaji)\b/i, circle: "parent", confidence: "high" },
  { pattern: /\b(maa|mom|mother|ammi|mummy)\b/i, circle: "parent", confidence: "high" },
  { pattern: /\b(bhai|brother)\b/i, circle: "sibling", confidence: "medium" },
  { pattern: /\b(behen|sister|didi)\b/i, circle: "sibling", confidence: "medium" },
  
  // Intimate patterns (spouse hint)
  { pattern: /[❤️💕💑🥰😘]+/, circle: "spouse", confidence: "medium" },
  { pattern: /\b(hubby|wifey|jaan|jaanu|baby)\b/i, circle: "spouse", confidence: "medium" },
];

// ----- MESSAGE CONTENT PATTERNS -----

const CONTENT_PATTERNS: Array<{ pattern: RegExp; circle: Circle; weight: number }> = [
  // Staff-like messages
  { pattern: /\b(sahab|madam|sir|ma'?am)\b/i, circle: "staff", weight: 2 },
  { pattern: /\b(theek hai|ok sir|ji|haan ji)\b/i, circle: "staff", weight: 1 },
  { pattern: /\b(kar diya|bhej diya|aa gaya|pahunch gaya)\b/i, circle: "staff", weight: 1 },
  
  // Vendor-like messages (in 1:1 chats)
  { pattern: /\b(payment|invoice|bill|rate|price|quotation)\b/i, circle: "vendor", weight: 2 },
  { pattern: /\b(delivery|order|stock|available)\b/i, circle: "vendor", weight: 1 },
  
  // Client-like messages
  { pattern: /\b(project|proposal|pitch|presentation|meeting)\b/i, circle: "client", weight: 1 },
  { pattern: /\b(contract|agreement|terms|scope)\b/i, circle: "client", weight: 2 },
  
  // Colleague-like messages
  { pattern: /\b(team|office|deadline|deliverable)\b/i, circle: "colleague", weight: 1 },
  { pattern: /\b(client meeting|sales|revenue)\b/i, circle: "colleague", weight: 1 },
  
  // Friend-like messages
  { pattern: /\b(party|weekend|movie|dinner|drinks|plan)\b/i, circle: "friend", weight: 1 },
  { pattern: /\b(bro|dude|yaar|buddy)\b/i, circle: "friend", weight: 2 },
  
  // Family-like messages
  { pattern: /\b(school|tuition|homework|exam|marks)\b/i, circle: "child", weight: 2 },
  { pattern: /\b(beta|baccha|kiddo)\b/i, circle: "child", weight: 3 },
];

// ----- MAIN EXTRACTION -----

export function extractCircleHints(
  personIds: Set<string>,
  messages: Message[],
  messagesByPerson: Map<string, Message[]>,
  personChats: Map<string, string[]>,
  personNames: Map<string, string[]>,
  seed: Seed,
  chats?: Chat[] // Optional: needed to detect org membership
): CircleHint[] {
  const hints: CircleHint[] = [];

  // Build a set of people who are in seed org chats (likely colleagues)
  const seedOrgPeople = new Set<string>();
  const seedOrgChatIds = new Set<string>();
  
  if (chats) {
    // Find chat IDs that match seed orgs
    for (const chat of chats) {
      if (chat.is_group) {
        for (const orgName of seed.organisations) {
          const orgLower = orgName.toLowerCase();
          const nameLower = chat.name.toLowerCase();
          if (nameLower.includes(orgLower.split(" ")[0]!) || orgLower.includes(nameLower.split(" ")[0]!)) {
            seedOrgChatIds.add(chat.chat_id);
            // All participants (except ME) are potential colleagues
            for (const p of chat.participants) {
              if (p !== "ME") seedOrgPeople.add(p);
            }
          }
        }
      }
    }
  }

  for (const personId of personIds) {
    // Skip if seed already tells us
    if (seed.circles[personId]) {
      hints.push({
        personId,
        names: personNames.get(personId) ?? [],
        suggestedCircle: seed.circles[personId] as Circle,
        confidence: "high",
        signals: ["From seed data"],
        messageCount: messagesByPerson.get(personId)?.length ?? 0,
        chatIds: personChats.get(personId) ?? [],
      });
      continue;
    }

    const names = personNames.get(personId) ?? [];
    const personMessages = messagesByPerson.get(personId) ?? [];
    const chatIds = personChats.get(personId) ?? [];
    const signals: string[] = [];

    // Check name patterns
    let suggestedCircle: Circle | null = null;
    let confidence: "high" | "medium" | "low" = "low";

    for (const name of names) {
      for (const { pattern, circle, confidence: conf } of NAME_PATTERNS) {
        if (pattern.test(name)) {
          suggestedCircle = circle;
          confidence = conf;
          signals.push(`Name "${name}" matches ${circle} pattern`);
          break;
        }
      }
      if (suggestedCircle) break;
    }

    // NEW: If person is in a seed org chat, they're likely a colleague
    // This overrides vendor classification from invoice/payment talk
    if (seedOrgPeople.has(personId)) {
      // Name-based "vendor" pattern still wins (e.g., "Das Printers")
      // But content-based vendor detection loses to org membership
      if (!suggestedCircle || suggestedCircle === "vendor") {
        suggestedCircle = "colleague";
        confidence = "medium";
        signals.push("Member of seed organisation chat");
      }
    }

    // If no name match, check message content
    if (!suggestedCircle && personMessages.length > 0) {
      const circleWeights = new Map<Circle, number>();

      for (const msg of personMessages) {
        for (const { pattern, circle, weight } of CONTENT_PATTERNS) {
          if (pattern.test(msg.body)) {
            circleWeights.set(circle, (circleWeights.get(circle) ?? 0) + weight);
          }
        }
      }

      // Find highest weighted circle
      let maxWeight = 0;
      for (const [circle, weight] of circleWeights) {
        if (weight > maxWeight) {
          maxWeight = weight;
          suggestedCircle = circle;
        }
      }

      if (maxWeight >= 3) {
        confidence = "medium";
        signals.push(`Message content suggests ${suggestedCircle} (weight: ${maxWeight})`);
      } else if (maxWeight > 0) {
        confidence = "low";
        signals.push(`Weak signal for ${suggestedCircle} (weight: ${maxWeight})`);
      }
    }

    hints.push({
      personId,
      names,
      suggestedCircle,
      confidence,
      signals,
      messageCount: personMessages.length,
      chatIds,
    });
  }

  return hints;
}

/**
 * Format circle hints for LLM — only ambiguous ones need LLM review
 */
export function formatCircleHintsForLLM(hints: CircleHint[]): string {
  const lines: string[] = [];

  // High confidence — just list them
  const highConf = hints.filter((h) => h.confidence === "high");
  if (highConf.length > 0) {
    lines.push("=== CONFIRMED (high confidence) ===");
    for (const h of highConf) {
      lines.push(`${h.personId} "${h.names[0] ?? "?"}" → ${h.suggestedCircle} (${h.signals[0]})`);
    }
    lines.push("");
  }

  // Medium/low confidence — need LLM help
  const needsReview = hints.filter((h) => h.confidence !== "high");
  if (needsReview.length > 0) {
    lines.push("=== NEEDS REVIEW ===");
    for (const h of needsReview) {
      const suggestion = h.suggestedCircle ? `suggests: ${h.suggestedCircle}` : "no suggestion";
      lines.push(`${h.personId} "${h.names[0] ?? "?"}" (${h.messageCount} msgs, ${h.chatIds.length} chats)`);
      lines.push(`  ${suggestion} | ${h.signals.join(", ") || "no signals"}`);
    }
  }

  return lines.join("\n");
}

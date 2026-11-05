// Validation constants - matching the challenge spec

export const CIRCLES = new Set([
  "spouse", "child", "parent", "in-law", "sibling", "relative",
  "friend", "colleague", "client", "vendor", "partner", "staff"
]);

export const ORG_TYPES = new Set([
  "company", "residence", "vacation home", "workspace", "society", "school", "other"
]);

export const ORG_ROLES = new Set([
  "owner", "partner", "helper", "resident", "parent", "member", "other"
]);

export const AREAS = new Set([
  "self", "spouse", "kids", "parents", "work", "friends",
  "experiences", "finances", "health", "home"
]);

export const GOAL_TYPES = new Set(["habit", "milestone", "experience"]);

export const HORIZONS = new Set(["3mo", "1yr", "3yr", "5yr"]);

export const LOOP_TYPES = new Set(["commitment", "followup", "deadline", "question"]);

export const STATUSES = new Set(["open", "done", "dropped"]);

export const ACTIONS = new Set(["assist", "remind", "leave"]);

/** Points per category (74 total from data) */
export const POINTS: Record<string, number> = {
  circles: 12,
  organisations: 8,
  chats: 8,
  goals: 8,
  loops_found: 14,
  loops_closed: 14,
  help: 10,
};

export const LABELS: Record<string, string> = {
  circles: "Circles",
  organisations: "Organisations",
  chats: "Chats",
  goals: "Goals",
  loops_found: "Open loops found",
  loops_closed: "Open loops closed right",
  help: "Where to help",
};

// Enum constants - single source of truth for all valid values
// Used by both Zod schemas and TypeScript types

export const CIRCLES = [
  "spouse",
  "child",
  "parent",
  "in-law",
  "sibling",
  "relative",
  "friend",
  "colleague",
  "client",
  "vendor",
  "partner",
  "staff",
] as const;

export const ORG_TYPES = [
  "company",
  "residence",
  "vacation home",
  "workspace",
  "society",
  "school",
  "other",
] as const;

export const ORG_SIDES = ["home", "work"] as const;

export const ORG_ROLES = [
  "owner",
  "partner",
  "helper",
  "resident",
  "parent",
  "member",
  "other",
] as const;

export const LINK_TYPES = ["runs", "supports"] as const;

export const GOAL_AREAS = [
  "self",
  "spouse",
  "kids",
  "parents",
  "work",
  "friends",
  "experiences",
  "finances",
  "health",
  "home",
] as const;

export const GOAL_TYPES = ["habit", "milestone", "experience"] as const;

export const GOAL_HORIZONS = ["3mo", "1yr", "3yr", "5yr"] as const;

export const LOOP_TYPES = [
  "commitment",
  "followup",
  "deadline",
  "question",
] as const;

export const LOOP_STATUSES = ["open", "done", "dropped"] as const;

export const HELP_ACTIONS = ["assist", "remind", "leave"] as const;

// Derived TypeScript types from const arrays
export type Circle = (typeof CIRCLES)[number];
export type OrgType = (typeof ORG_TYPES)[number];
export type OrgSide = (typeof ORG_SIDES)[number];
export type OrgRole = (typeof ORG_ROLES)[number];
export type LinkType = (typeof LINK_TYPES)[number];
export type GoalArea = (typeof GOAL_AREAS)[number];
export type GoalType = (typeof GOAL_TYPES)[number];
export type GoalHorizon = (typeof GOAL_HORIZONS)[number];
export type LoopType = (typeof LOOP_TYPES)[number];
export type LoopStatus = (typeof LOOP_STATUSES)[number];
export type HelpAction = (typeof HELP_ACTIONS)[number];

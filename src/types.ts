// Input shapes (from the challenge data) and output shapes (from schema.json).
//
// Output types are defined by Zod in schemas.ts (single source of truth).
// We re-export them here so other modules can import from one place.

// ----- Input types -----

export interface Chat {
  chat_id: string;
  name: string;
  is_group: boolean;
  participants: string[]; // person ids; Arjun is "ME"
}

export type MessageKind =
  | "text"
  | "voice_transcript"
  | "image_caption"
  | "document";

export interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  sender_name: string; // as saved in Arjun's phone
  ts: number; // unix seconds
  kind: MessageKind;
  body: string;
  quoted_id: string | null;
}

export interface Seed {
  circles: Record<string, Circle>; // personId -> circle
  organisations: string[]; // org names Arjun gave at signup
  goals: Array<{
    title: string;
    area: GoalArea;
    type: GoalType;
    horizon: GoalHorizon;
  }>;
}

// ----- Output types (re-exported from schemas.ts, the Zod source of truth) -----

export type {
  PersonOut,
  OrganisationOut,
  ChatOut,
  GoalOut,
  HelpOut,
  OpenLoopOut,
  Output,
} from "./schemas.js";

// ----- Enum types derived from Zod schema arrays -----

import {
  CIRCLES,
  ORG_TYPES,
  ORG_SIDES,
  ORG_ROLES,
  LINK_TYPES,
  GOAL_AREAS,
  GOAL_TYPES,
  GOAL_HORIZONS,
  LOOP_TYPES,
  LOOP_STATUSES,
  HELP_ACTIONS,
} from "./schemas.js";

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

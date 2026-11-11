// Extraction types with confidence/evidence for merging

import { z } from "zod";
import { CIRCLES, ORG_TYPES, ORG_SIDES, ORG_ROLES, GOAL_AREAS, GOAL_TYPES, GOAL_HORIZONS, LOOP_TYPES, LOOP_STATUSES, HELP_ACTIONS, LINK_TYPES } from "../types/index.js";

// ============================================================
// Batch extraction output (with confidence for merging)
// ============================================================

export const circleExtractSchema = z.object({
  person_id: z.string(),
  circle: z.enum(CIRCLES),
  confidence: z.number().min(0).max(1).default(0.8),
  evidence: z.array(z.string()).default([]),
});

/** Person's link to an organisation */
export const personLinkExtractSchema = z.object({
  person_id: z.string(),
  org_id: z.string(),
  link: z.enum(LINK_TYPES),  // runs, supports
  confidence: z.number().min(0).max(1).default(0.8),
  evidence: z.array(z.string()).default([]),
});

export const orgExtractSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(ORG_TYPES),
  side: z.enum(ORG_SIDES),
  role: z.enum(ORG_ROLES),
  confidence: z.number().min(0).max(1).default(0.8),
  evidence: z.array(z.string()).default([]),
});

export const chatExtractSchema = z.object({
  chat_id: z.string(),
  person_id: z.string().nullish(),   // assigned to person (for 1:1 chats) - can be null
  org_id: z.string().nullish(),      // assigned to org (for group chats) - can be null
  confidence: z.number().min(0).max(1).default(0.8),
  evidence: z.array(z.string()).default([]),
});

export const goalExtractSchema = z.object({
  title: z.string(),
  area: z.enum(GOAL_AREAS),
  type: z.enum(GOAL_TYPES),
  horizon: z.enum(GOAL_HORIZONS),
  confidence: z.number().min(0).max(1).default(0.8),
  evidence: z.array(z.string()).default([]),
});

export const helpExtractSchema = z.object({
  action: z.enum(HELP_ACTIONS),
  next_step: z.string().nullish(),   // for "assist"
  needs_yes: z.boolean().nullish(),  // for "assist" - does step need ME's approval?
  remind_at: z.string().nullish(),   // for "remind"
  reason: z.string().nullish(),      // for "leave"
});

export const loopExtractSchema = z.object({
  title: z.string(),
  type: z.enum(LOOP_TYPES),
  owner: z.string().nullable(),  // "ME", person_id, or null for followups
  chat_id: z.string(),
  source_msg: z.string(),  // message ID that created the loop
  due: z.string().nullable().optional(),  // YYYY-MM-DD or null
  status: z.enum(LOOP_STATUSES),
  closed_by: z.string().nullable().optional(),  // message ID that closed it
  help: helpExtractSchema.nullable().optional(),  // REQUIRED for all open loops
  confidence: z.number().min(0).max(1).default(0.8),
});

export const batchOutputSchema = z.object({
  circles: z.array(circleExtractSchema).default([]),
  person_links: z.array(personLinkExtractSchema).default([]),
  orgs: z.array(orgExtractSchema).default([]),
  chats: z.array(chatExtractSchema).default([]),
  goals: z.array(goalExtractSchema).default([]),
  loops: z.array(loopExtractSchema).default([]),
});

export type CircleExtract = z.infer<typeof circleExtractSchema>;
export type PersonLinkExtract = z.infer<typeof personLinkExtractSchema>;
export type OrgExtract = z.infer<typeof orgExtractSchema>;
export type ChatExtract = z.infer<typeof chatExtractSchema>;
export type GoalExtract = z.infer<typeof goalExtractSchema>;
export type LoopExtract = z.infer<typeof loopExtractSchema>;
export type HelpExtract = z.infer<typeof helpExtractSchema>;
export type BatchOutput = z.infer<typeof batchOutputSchema>;

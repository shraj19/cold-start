// Multi-pass extraction schemas
// Defines intermediate structures between passes

import { z } from "zod";
import {
  CIRCLES,
  LOOP_TYPES,
  LOOP_STATUSES,
  HELP_ACTIONS,
  GOAL_AREAS,
  GOAL_TYPES,
  GOAL_HORIZONS,
  ORG_TYPES,
  ORG_SIDES,
  ORG_ROLES,
  ORG_LINKS,
} from "../schemas.js";

// ============================================================
// PASS 1: Per-chat extraction
// ============================================================
// Input: All messages from ONE chat
// Output: Local signals, loop candidates, topics
// Runs in parallel across all chats

export const relationshipSignalSchema = z.object({
  person_id: z.string(),
  signal: z.string().describe("What suggests this relationship"),
  suggests: z.enum(CIRCLES),
  confidence: z.number().min(0).max(1),
});

export const loopCandidateSchema = z.object({
  msg_id: z.string(),
  text_snippet: z.string().max(100).describe("First 100 chars of message"),
  type: z.enum(LOOP_TYPES),
  owner: z.string().describe("Person ID or 'ME'"),
  due: z.string().nullable().describe("ISO date if mentioned"),
  confidence: z.number().min(0).max(1),
});

export const pass1OutputSchema = z.object({
  chat_id: z.string(),
  participants: z.array(z.string()).describe("Person IDs excluding ME"),
  
  relationship_signals: z.array(relationshipSignalSchema)
    .describe("Evidence about who each person is"),
  
  loop_candidates: z.array(loopCandidateSchema)
    .describe("Potential commitments, questions, deadlines, followups"),
  
  topics: z.array(z.string()).max(5)
    .describe("Main topics discussed (for goal detection)"),
  
  goal_hints: z.array(z.string()).max(3)
    .describe("Any explicit goals or aspirations mentioned"),
});

export type Pass1Output = z.infer<typeof pass1OutputSchema>;
export type RelationshipSignal = z.infer<typeof relationshipSignalSchema>;
export type LoopCandidate = z.infer<typeof loopCandidateSchema>;

// ============================================================
// PASS 2: Global synthesis
// ============================================================
// Input: All Pass1 outputs + seed data
// Output: Final decisions with confidence + investigation requests

export const circleDecisionSchema = z.object({
  person_id: z.string(),
  circle: z.enum(CIRCLES),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(100),
});

export const orgDecisionSchema = z.object({
  id: z.string().describe("Short lowercase id like 'brightside'"),
  name: z.string(),
  type: z.enum(ORG_TYPES),
  side: z.enum(ORG_SIDES),
  role: z.enum(ORG_ROLES),
});

export const personOrgLinkSchema = z.object({
  person_id: z.string(),
  organisation_id: z.string(),
  link: z.enum(ORG_LINKS),
});

export const loopDecisionSchema = z.object({
  msg_id: z.string().describe("Primary source message"),
  related_msg_ids: z.array(z.string()).describe("Other messages about same loop"),
  title: z.string().max(60),
  type: z.enum(LOOP_TYPES),
  owner: z.string(),
  chat_id: z.string(),
  due: z.string().nullable(),
  status: z.enum(LOOP_STATUSES),
  closed_by: z.string().nullable().describe("Message ID that closed it"),
  help_action: z.enum(HELP_ACTIONS).nullable().describe("Only for open loops"),
  help_detail: z.string().nullable().describe("next_step / remind_at / reason"),
  confidence: z.number().min(0).max(1),
});

export const goalDecisionSchema = z.object({
  title: z.string(),
  area: z.enum(GOAL_AREAS),
  type: z.enum(GOAL_TYPES),
  horizon: z.enum(GOAL_HORIZONS),
  evidence: z.array(z.string()).min(1).describe("Message IDs"),
  confidence: z.number().min(0).max(1),
});

export const investigationRequestSchema = z.object({
  type: z.enum(["circle", "loop", "goal"]),
  subject: z.string().describe("Person ID or message ID"),
  reason: z.string(),
  chat_ids: z.array(z.string()).describe("Chats to investigate"),
});

export const pass2OutputSchema = z.object({
  circle_decisions: z.array(circleDecisionSchema),
  org_decisions: z.array(orgDecisionSchema),
  person_org_links: z.array(personOrgLinkSchema),
  loop_decisions: z.array(loopDecisionSchema),
  goal_decisions: z.array(goalDecisionSchema),
  
  // Low-confidence items that need Pass 3
  needs_investigation: z.array(investigationRequestSchema),
});

export type Pass2Output = z.infer<typeof pass2OutputSchema>;
export type CircleDecision = z.infer<typeof circleDecisionSchema>;
export type OrgDecision = z.infer<typeof orgDecisionSchema>;
export type LoopDecision = z.infer<typeof loopDecisionSchema>;
export type GoalDecision = z.infer<typeof goalDecisionSchema>;
export type InvestigationRequest = z.infer<typeof investigationRequestSchema>;

// ============================================================
// PASS 3: Deep-dive (tool-assisted)
// ============================================================
// Input: Investigation requests + tool access to raw messages
// Output: Refined decisions for uncertain items

export const pass3OutputSchema = z.object({
  circle_refinements: z.array(circleDecisionSchema),
  loop_refinements: z.array(loopDecisionSchema),
  goal_refinements: z.array(goalDecisionSchema),
});

export type Pass3Output = z.infer<typeof pass3OutputSchema>;

// Phase 1 output schemas - compact format for batch extraction

import { z } from "zod";

// ============================================================================
// Phase 1 Output Schema (per-batch extraction results)
// ============================================================================

export const phase1PersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable().optional(), // Model may return null
  circle: z.enum([
    "spouse", "child", "parent", "in-law", "sibling", "relative",
    "friend", "colleague", "client", "vendor", "partner", "staff",
    "unknown" // Fallback for unclear relationships
  ]),
  relation_notes: z.string().nullable().optional(), // Model may return null
});

export const phase1OrgSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["company", "residence", "vacation home", "workspace", "society", "school", "other"]),
  side: z.enum(["home", "work"]),
  role: z.enum(["owner", "partner", "helper", "resident", "parent", "member", "other"]),
  member_ids: z.array(z.string()), // person IDs who are part of this org
});

export const phase1LoopSchema = z.object({
  id: z.string(),
  title: z.string().max(60),
  type: z.enum(["commitment", "followup", "deadline", "question"]),
  status: z.enum(["open", "done", "dropped"]),
  owner_id: z.string(), // "ME" or person ID
  chat_id: z.string(),
  source_msg_id: z.string(),
  due: z.string().nullable().optional(), // YYYY-MM-DD
  closed_by_msg_id: z.string().nullable().optional(),
  helper_action: z.enum(["assist", "remind", "leave"]).optional(), // only for open loops
});

export const phase1GoalSchema = z.object({
  id: z.string(),
  title: z.string(),
  person_id: z.string(), // "ME" or person ID
  area: z.enum(["self", "spouse", "kids", "parents", "work", "friends", "experiences", "finances", "health", "home"]),
  type: z.enum(["habit", "milestone", "experience"]),
  horizon: z.enum(["3mo", "1yr", "3yr", "5yr"]),
  evidence_msg_ids: z.array(z.string()),
});

export const phase1ChatAssignmentSchema = z.object({
  chat_id: z.string(),
  // One of these must be set
  person_id: z.string().optional(), // for 1:1 chats
  org_id: z.string().optional(), // for group chats
});

export const phase1OutputSchema = z.object({
  batch_id: z.number(),
  people: z.array(phase1PersonSchema),
  organizations: z.array(phase1OrgSchema),
  loops: z.array(phase1LoopSchema),
  goals: z.array(phase1GoalSchema),
  chat_assignments: z.array(phase1ChatAssignmentSchema),
});

export type Phase1Person = z.infer<typeof phase1PersonSchema>;
export type Phase1Org = z.infer<typeof phase1OrgSchema>;
export type Phase1Loop = z.infer<typeof phase1LoopSchema>;
export type Phase1Goal = z.infer<typeof phase1GoalSchema>;
export type Phase1ChatAssignment = z.infer<typeof phase1ChatAssignmentSchema>;
export type Phase1Output = z.infer<typeof phase1OutputSchema>;

// Zod schemas mirroring schema.json (the OUTPUT shape run.sh must write).
//
// NOTE: the answer key (answers/answers.json) uses a slightly different shape
// for open_loops (source_msgs[], closing_msgs[], help as a plain string + why).
// That is what the grader compares AGAINST. We never write that shape; we write
// the shape below. See WRITEUP for the mapping.
//
// These schemas serve two jobs:
//   1. Validate the final output before we write it (fail fast on bad data).
//   2. Constrain LLM structured output per task (we build smaller sub-schemas
//      from these enums), so the model can only emit legal enum values.

import { z } from "zod";

// ----- Enums (single source of truth, reused by LLM prompts) -----

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

// ----- Output schemas (schema.json, additionalProperties: false => .strict()) -----

export const personSchema = z
  .object({
    id: z.string(),
    circle: z.enum(CIRCLES),
    links: z
      .array(
        z
          .object({
            organisation: z.string(),
            link: z.enum(LINK_TYPES),
          })
          .strict(),
      )
      .optional(),
    looks_after: z.array(z.string()).optional(),
  })
  .strict();

export const organisationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.enum(ORG_TYPES),
    side: z.enum(ORG_SIDES),
    role: z.enum(ORG_ROLES),
  })
  .strict();

// A chat must carry exactly one of person | organisation (schema.json oneOf).
export const chatSchema = z
  .object({
    chat_id: z.string(),
    person: z.string().optional(),
    organisation: z.string().optional(),
  })
  .strict()
  .refine(
    (c) => (c.person === undefined) !== (c.organisation === undefined),
    { message: "a chat must tie to exactly one of person | organisation" },
  );

export const goalSchema = z
  .object({
    title: z.string(),
    area: z.enum(GOAL_AREAS),
    type: z.enum(GOAL_TYPES),
    horizon: z.enum(GOAL_HORIZONS),
    evidence: z.array(z.string()).min(1),
  })
  .strict();

export const helpSchema = z
  .object({
    action: z.enum(HELP_ACTIONS),
    next_step: z.string().optional(), // assist
    needs_yes: z.boolean().optional(), // assist
    remind_at: z.string().optional(), // remind (ISO date-time)
    reason: z.string().optional(), // leave
  })
  .strict();

export const openLoopSchema = z
  .object({
    title: z.string(),
    type: z.enum(LOOP_TYPES),
    owner: z.string(), // "ME" or a person id
    chat_id: z.string(),
    source_msg: z.string(),
    due: z.string().nullable().optional(), // YYYY-MM-DD or null
    status: z.enum(LOOP_STATUSES),
    closed_by: z.string().nullable().optional(),
    help: helpSchema.nullable().optional(), // only for open loops
  })
  .strict();

export const outputSchema = z
  .object({
    people: z.array(personSchema),
    organisations: z.array(organisationSchema),
    chats: z.array(chatSchema),
    goals: z.array(goalSchema).max(10),
    open_loops: z.array(openLoopSchema),
  })
  .strict();

// ----- Inferred types -----

export type PersonOut = z.infer<typeof personSchema>;
export type OrganisationOut = z.infer<typeof organisationSchema>;
export type ChatOut = z.infer<typeof chatSchema>;
export type GoalOut = z.infer<typeof goalSchema>;
export type HelpOut = z.infer<typeof helpSchema>;
export type OpenLoopOut = z.infer<typeof openLoopSchema>;
export type Output = z.infer<typeof outputSchema>;

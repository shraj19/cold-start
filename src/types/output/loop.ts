// Open loop output type and schema

import { z } from "zod";
import { LOOP_TYPES, LOOP_STATUSES, HELP_ACTIONS } from "../enums.js";

/** Help suggestion for an open loop */
export const helpSchema = z
  .object({
    action: z.enum(HELP_ACTIONS),
    next_step: z.string().optional(), // for "assist"
    needs_yes: z.boolean().optional(), // for "assist"
    remind_at: z.string().optional(), // for "remind" (ISO datetime)
    reason: z.string().optional(), // for "leave"
  })
  .strict();

/** Open loop (task/commitment/question) in the output */
export const openLoopSchema = z
  .object({
    title: z.string(),
    type: z.enum(LOOP_TYPES),
    owner: z.string(), // "ME" or person id
    chat_id: z.string(),
    source_msg: z.string(), // message ID that created the loop
    due: z.string().nullable().optional(), // YYYY-MM-DD or null
    status: z.enum(LOOP_STATUSES),
    closed_by: z.string().nullable().optional(), // message ID that closed it
    help: helpSchema.nullable().optional(), // only for open loops
  })
  .strict();

export type Help = z.infer<typeof helpSchema>;
export type OpenLoop = z.infer<typeof openLoopSchema>;

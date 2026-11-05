// Final output schema - combines all entity schemas

import { z } from "zod";
import { personSchema, type Person, type PersonLink } from "./person.js";
import { organisationSchema, type Organisation } from "./organisation.js";
import { chatSchema, type ChatOutput } from "./chat.js";
import { goalSchema, type Goal } from "./goal.js";
import { openLoopSchema, helpSchema, type OpenLoop, type Help } from "./loop.js";

/** Complete output schema matching schema.json */
export const outputSchema = z
  .object({
    people: z.array(personSchema),
    organisations: z.array(organisationSchema),
    chats: z.array(chatSchema),
    goals: z.array(goalSchema).max(10),
    open_loops: z.array(openLoopSchema),
  })
  .strict();

export type Output = z.infer<typeof outputSchema>;

// Re-export all output types and schemas
export {
  // Schemas
  personSchema,
  organisationSchema,
  chatSchema,
  goalSchema,
  openLoopSchema,
  helpSchema,
  // Types
  type Person,
  type PersonLink,
  type Organisation,
  type ChatOutput,
  type Goal,
  type OpenLoop,
  type Help,
};

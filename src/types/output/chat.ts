// Chat output type and schema

import { z } from "zod";

/** 
 * Chat summary in the output
 * Must have exactly one of: person OR organisation (not both, not neither)
 */
export const chatSchema = z
  .object({
    chat_id: z.string(),
    person: z.string().optional(),
    organisation: z.string().optional(),
  })
  .strict()
  .refine(
    (c) => (c.person === undefined) !== (c.organisation === undefined),
    { message: "chat must have exactly one of: person | organisation" },
  );

export type ChatOutput = z.infer<typeof chatSchema>;

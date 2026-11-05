// Person output type and schema

import { z } from "zod";
import { CIRCLES, LINK_TYPES } from "../enums.js";

/** Link between a person and an organisation */
export const personLinkSchema = z
  .object({
    organisation: z.string(),
    link: z.enum(LINK_TYPES),
  })
  .strict();

/** Person in the output */
export const personSchema = z
  .object({
    id: z.string(),
    circle: z.enum(CIRCLES),
    links: z.array(personLinkSchema).optional(),
    looks_after: z.array(z.string()).optional(),
  })
  .strict();

export type PersonLink = z.infer<typeof personLinkSchema>;
export type Person = z.infer<typeof personSchema>;

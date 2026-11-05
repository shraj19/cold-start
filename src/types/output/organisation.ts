// Organisation output type and schema

import { z } from "zod";
import { ORG_TYPES, ORG_SIDES, ORG_ROLES } from "../enums.js";

/** Organisation in the output */
export const organisationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.enum(ORG_TYPES),
    side: z.enum(ORG_SIDES),
    role: z.enum(ORG_ROLES),
  })
  .strict();

export type Organisation = z.infer<typeof organisationSchema>;

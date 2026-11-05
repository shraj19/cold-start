// Goal output type and schema

import { z } from "zod";
import { GOAL_AREAS, GOAL_TYPES, GOAL_HORIZONS } from "../enums.js";

/** Goal in the output */
export const goalSchema = z
  .object({
    title: z.string(),
    area: z.enum(GOAL_AREAS),
    type: z.enum(GOAL_TYPES),
    horizon: z.enum(GOAL_HORIZONS),
    evidence: z.array(z.string()).min(1), // message IDs
  })
  .strict();

export type Goal = z.infer<typeof goalSchema>;

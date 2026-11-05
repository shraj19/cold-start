// Main types entry point - re-exports everything

// Enums and enum types
export {
  // Const arrays (for Zod schemas)
  CIRCLES,
  ORG_TYPES,
  ORG_SIDES,
  ORG_ROLES,
  LINK_TYPES,
  GOAL_AREAS,
  GOAL_TYPES,
  GOAL_HORIZONS,
  LOOP_TYPES,
  LOOP_STATUSES,
  HELP_ACTIONS,
  // TypeScript types derived from const arrays
  type Circle,
  type OrgType,
  type OrgSide,
  type OrgRole,
  type LinkType,
  type GoalArea,
  type GoalType,
  type GoalHorizon,
  type LoopType,
  type LoopStatus,
  type HelpAction,
} from "./enums.js";

// Input types
export {
  type Chat,
  type Message,
  type MessageKind,
  type Seed,
  type SeedGoal,
  type InputData,
} from "./input.js";

// Output types and schemas
export {
  // Main output
  outputSchema,
  type Output,
  // Person
  personSchema,
  type Person,
  type PersonLink,
  // Organisation
  organisationSchema,
  type Organisation,
  // Chat
  chatSchema,
  type ChatOutput,
  // Goal
  goalSchema,
  type Goal,
  // Loop
  openLoopSchema,
  helpSchema,
  type OpenLoop,
  type Help,
} from "./output/index.js";

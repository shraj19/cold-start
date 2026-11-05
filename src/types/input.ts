// Input types - data from the challenge (chats.jsonl, messages.jsonl, seed.json)

import type { Circle, GoalArea, GoalType, GoalHorizon } from "./enums.js";

/** A chat/conversation from chats.jsonl */
export interface Chat {
  chat_id: string;
  name: string;
  is_group: boolean;
  participants: string[]; // person ids, includes "ME"
}

/** Message kind - how the content was captured */
export type MessageKind = "text" | "voice_transcript" | "image_caption" | "document";

/** A message from messages.jsonl */
export interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  sender_name: string; // as saved in user's phone
  ts: number; // unix timestamp (seconds)
  kind: MessageKind;
  body: string;
  quoted_id: string | null;
}

/** Seed goal from seed.json */
export interface SeedGoal {
  title: string;
  area: GoalArea;
  type: GoalType;
  horizon: GoalHorizon;
}

/** Seed data from seed.json - what the user provided at signup */
export interface Seed {
  circles: Record<string, Circle>; // personId -> circle (pre-tagged)
  organisations: string[]; // org names user mentioned
  goals: SeedGoal[];
}

/** Combined input data */
export interface InputData {
  chats: Chat[];
  messages: Message[];
  seed: Seed;
}

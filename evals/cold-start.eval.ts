// Cold Start extraction eval using evalite
// Tests extraction accuracy with deterministic + LLM-as-judge scorers

import { evalite } from "evalite";
import { createScorer } from "evalite";
import { readFileSync } from "fs";
import path from "path";

import { readInput } from "../src/io/read.js";
import { extract } from "../src/extract/index.js";
import type { Output } from "../src/types/index.js";
import type { Answers } from "../src/validator/types.js";

// Load example dataset
const exampleDir = path.join(import.meta.dirname, "../example");
const input = readInput(exampleDir);
const answers: Answers = JSON.parse(
  readFileSync(path.join(exampleDir, "answers/answers.json"), "utf-8")
);

// ============================================================
// Deterministic Scorers
// ============================================================

const circlesScorer = createScorer<Output, undefined, Answers>({
  name: "Circles Accuracy",
  scorer: ({ output, expected }) => {
    const seededCircles = new Set(Object.keys(input.seed.circles || {}));
    const outMap = new Map(output.people.map((p) => [p.id, p.circle]));
    const scoredPeople = expected.people.filter((p) => !seededCircles.has(p.id));

    if (scoredPeople.length === 0) return 1;

    const correct = scoredPeople.filter((p) => outMap.get(p.id) === p.circle).length;
    const score = correct / scoredPeople.length;

    // Return metadata showing mismatches
    const mismatches = scoredPeople
      .filter((p) => outMap.get(p.id) !== p.circle)
      .map((p) => `${p.id}: expected ${p.circle}, got ${outMap.get(p.id) ?? "missing"}`);

    return {
      score,
      metadata: mismatches.length > 0 ? mismatches.join("; ") : "All correct",
    };
  },
});

const chatsScorer = createScorer<Output, undefined, Answers>({
  name: "Chats Assignment",
  scorer: ({ output, expected }) => {
    const outMap = new Map(output.chats.map((c) => [c.chat_id, c]));
    let correct = 0;
    const mismatches: string[] = [];

    for (const c of expected.chats) {
      const mine = outMap.get(c.chat_id);
      if (!mine) {
        mismatches.push(`${c.chat_id}: missing`);
        continue;
      }

      if (c.person !== undefined) {
        if (mine.person === c.person) {
          correct++;
        } else {
          mismatches.push(`${c.chat_id}: expected person=${c.person}, got person=${mine.person}, org=${mine.organisation}`);
        }
      } else if (c.organisation !== undefined) {
        // For orgs, we need fuzzy matching - just check if assigned to an org
        if (mine.organisation) {
          correct++;
        } else {
          mismatches.push(`${c.chat_id}: expected org=${c.organisation}, got person=${mine.person}`);
        }
      }
    }

    const score = expected.chats.length > 0 ? correct / expected.chats.length : 0;

    return {
      score,
      metadata: mismatches.length > 0 ? mismatches.join("; ") : "All correct",
    };
  },
});

const loopsFoundScorer = createScorer<Output, undefined, Answers>({
  name: "Loops Found (by source_msg)",
  scorer: ({ output, expected }) => {
    const expectedSourceMsgs = new Set(expected.open_loops.flatMap((l) => l.source_msgs));
    const outputSourceMsgs = new Set(output.open_loops.map((l) => l.source_msg));

    const found = [...outputSourceMsgs].filter((m) => expectedSourceMsgs.has(m)).length;
    const missing = [...expectedSourceMsgs].filter((m) => !outputSourceMsgs.has(m));
    const extra = [...outputSourceMsgs].filter((m) => !expectedSourceMsgs.has(m));

    const precision = outputSourceMsgs.size > 0 ? found / outputSourceMsgs.size : 0;
    const recall = expectedSourceMsgs.size > 0 ? found / expectedSourceMsgs.size : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    return {
      score: f1,
      metadata: `Found ${found}/${expectedSourceMsgs.size}. Missing: [${missing.join(", ")}]. Extra: [${extra.join(", ")}]`,
    };
  },
});

const loopsStatusScorer = createScorer<Output, undefined, Answers>({
  name: "Loops Status Accuracy",
  scorer: ({ output, expected }) => {
    // Match loops by source_msg and check status
    const outputBySource = new Map(output.open_loops.map((l) => [l.source_msg, l]));
    
    let correct = 0;
    let total = 0;
    const mismatches: string[] = [];

    for (const exp of expected.open_loops) {
      const out = exp.source_msgs.map((m) => outputBySource.get(m)).find(Boolean);
      if (out) {
        total++;
        if (out.status === exp.status) {
          correct++;
        } else {
          mismatches.push(`${exp.source_msgs[0]}: expected ${exp.status}, got ${out.status}`);
        }
      }
    }

    const score = total > 0 ? correct / total : 0;

    return {
      score,
      metadata: mismatches.length > 0 ? mismatches.join("; ") : "All correct",
    };
  },
});

const helpActionScorer = createScorer<Output, undefined, Answers>({
  name: "Help Action Accuracy",
  scorer: ({ output, expected }) => {
    // Find open loops with help in expected
    const expectedLoops = expected.open_loops.filter((l) => l.status === "open" && l.help);
    if (expectedLoops.length === 0) return { score: 1, metadata: "No help actions to evaluate" };

    // Match loops by source_msg
    const outputBySource = new Map(output.open_loops.map((l) => [l.source_msg, l]));

    let correct = 0;
    let total = 0;
    const mismatches: string[] = [];

    for (const exp of expectedLoops) {
      const out = exp.source_msgs.map((m) => outputBySource.get(m)).find(Boolean);
      if (out && out.status === "open") {
        total++;
        const gotAction = out.help?.action ?? "none";
        if (gotAction === exp.help) {
          correct++;
        } else {
          mismatches.push(`${exp.source_msgs[0]} "${exp.title?.slice(0, 30)}": expected ${exp.help}, got ${gotAction}`);
        }
      }
    }

    const score = total > 0 ? correct / total : 0;

    return {
      score,
      metadata: mismatches.length > 0 ? mismatches.join("; ") : "All correct",
    };
  },
});

// ============================================================
// Main Eval
// ============================================================

evalite("Cold Start Extraction", {
  data: () => [
    {
      input: { chats: input.chats, messages: input.messages, seed: input.seed },
      expected: answers,
    },
  ],
  task: async (inputData) => {
    const output = await extract(inputData.chats, inputData.messages, inputData.seed);
    return output;
  },
  scorers: [circlesScorer, chatsScorer, loopsFoundScorer, loopsStatusScorer, helpActionScorer],
});

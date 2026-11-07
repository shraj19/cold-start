// Run eval with verbose output showing each scorer's metadata
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

console.log("Running extraction...\n");
const output = await extract(input.chats, input.messages, input.seed);

console.log("\n" + "=".repeat(60));
console.log("EVAL RESULTS");
console.log("=".repeat(60) + "\n");

// Circles
{
  const seededCircles = new Set(Object.keys(input.seed.circles || {}));
  const outMap = new Map(output.people.map((p) => [p.id, p.circle]));
  const scoredPeople = answers.people.filter((p) => !seededCircles.has(p.id));
  const correct = scoredPeople.filter((p) => outMap.get(p.id) === p.circle).length;
  const score = scoredPeople.length > 0 ? correct / scoredPeople.length : 1;
  
  console.log(`CIRCLES: ${(score * 100).toFixed(0)}% (${correct}/${scoredPeople.length})`);
  const mismatches = scoredPeople.filter((p) => outMap.get(p.id) !== p.circle);
  if (mismatches.length > 0) {
    for (const p of mismatches) {
      console.log(`  ✗ ${p.id}: expected ${p.circle}, got ${outMap.get(p.id) ?? "missing"}`);
    }
  } else {
    console.log("  ✓ All correct");
  }
  console.log();
}

// Chats
{
  const outMap = new Map(output.chats.map((c) => [c.chat_id, c]));
  let correct = 0;
  const mismatches: string[] = [];

  for (const c of answers.chats) {
    const mine = outMap.get(c.chat_id);
    if (!mine) {
      mismatches.push(`${c.chat_id}: missing`);
      continue;
    }
    if (c.person !== undefined) {
      if (mine.person === c.person) correct++;
      else mismatches.push(`${c.chat_id}: expected person=${c.person}, got person=${mine.person}, org=${mine.organisation}`);
    } else if (c.organisation !== undefined) {
      if (mine.organisation) correct++;
      else mismatches.push(`${c.chat_id}: expected org=${c.organisation}, got person=${mine.person}`);
    }
  }

  const score = answers.chats.length > 0 ? correct / answers.chats.length : 0;
  console.log(`CHATS: ${(score * 100).toFixed(0)}% (${correct}/${answers.chats.length})`);
  if (mismatches.length > 0) {
    for (const m of mismatches) console.log(`  ✗ ${m}`);
  } else {
    console.log("  ✓ All correct");
  }
  console.log();
}

// Loops Found
{
  const expectedSourceMsgs = new Set(answers.open_loops.flatMap((l) => l.source_msgs));
  const outputSourceMsgs = new Set(output.open_loops.map((l) => l.source_msg));

  const found = [...outputSourceMsgs].filter((m) => expectedSourceMsgs.has(m)).length;
  const missing = [...expectedSourceMsgs].filter((m) => !outputSourceMsgs.has(m));
  const extra = [...outputSourceMsgs].filter((m) => !expectedSourceMsgs.has(m));

  const precision = outputSourceMsgs.size > 0 ? found / outputSourceMsgs.size : 0;
  const recall = expectedSourceMsgs.size > 0 ? found / expectedSourceMsgs.size : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  console.log(`LOOPS FOUND: ${(f1 * 100).toFixed(0)}% F1 (found ${found}/${expectedSourceMsgs.size})`);
  if (missing.length > 0) console.log(`  Missing: ${missing.join(", ")}`);
  if (extra.length > 0) console.log(`  Extra: ${extra.join(", ")}`);
  if (missing.length === 0 && extra.length === 0) console.log("  ✓ All correct");
  console.log();
}

// Loops Status
{
  const outputBySource = new Map(output.open_loops.map((l) => [l.source_msg, l]));
  let correct = 0;
  let total = 0;
  const mismatches: string[] = [];

  for (const exp of answers.open_loops) {
    const out = exp.source_msgs.map((m) => outputBySource.get(m)).find(Boolean);
    if (out) {
      total++;
      if (out.status === exp.status) correct++;
      else mismatches.push(`${exp.source_msgs[0]} "${exp.title?.slice(0, 25)}...": expected ${exp.status}, got ${out.status}`);
    }
  }

  const score = total > 0 ? correct / total : 0;
  console.log(`LOOPS STATUS: ${(score * 100).toFixed(0)}% (${correct}/${total})`);
  if (mismatches.length > 0) {
    for (const m of mismatches) console.log(`  ✗ ${m}`);
  } else {
    console.log("  ✓ All correct");
  }
  console.log();
}

// Help Actions
{
  const expectedLoops = answers.open_loops.filter((l) => l.status === "open" && l.help);
  const outputBySource = new Map(output.open_loops.map((l) => [l.source_msg, l]));

  let correct = 0;
  let total = 0;
  const mismatches: string[] = [];

  for (const exp of expectedLoops) {
    const out = exp.source_msgs.map((m) => outputBySource.get(m)).find(Boolean);
    if (out && out.status === "open") {
      total++;
      const gotAction = out.help?.action ?? "none";
      if (gotAction === exp.help) correct++;
      else mismatches.push(`${exp.source_msgs[0]} "${exp.title?.slice(0, 25)}...": expected ${exp.help}, got ${gotAction}`);
    }
  }

  const score = total > 0 ? correct / total : 0;
  console.log(`HELP ACTIONS: ${(score * 100).toFixed(0)}% (${correct}/${total})`);
  if (mismatches.length > 0) {
    for (const m of mismatches) console.log(`  ✗ ${m}`);
  } else {
    console.log("  ✓ All correct");
  }
}

console.log("\n" + "=".repeat(60));

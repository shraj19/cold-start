// Score dev output against dev answers
import { readFileSync } from "fs";
import path from "path";

const devDir = path.join(import.meta.dirname, "../dev");
const output = JSON.parse(readFileSync(path.join(import.meta.dirname, "../output-dev.json"), "utf-8"));
const answers = JSON.parse(readFileSync(path.join(devDir, "answers/answers.json"), "utf-8"));
const seed = JSON.parse(readFileSync(path.join(devDir, "seed.json"), "utf-8"));

console.log("=".repeat(60));
console.log("DEV DATASET SCORES");
console.log("=".repeat(60) + "\n");

// Circles
{
  const seededCircles = new Set(Object.keys(seed.circles || {}));
  const outMap = new Map(output.people.map((p: any) => [p.id, p.circle]));
  const scoredPeople = answers.people.filter((p: any) => !seededCircles.has(p.id));
  const correct = scoredPeople.filter((p: any) => outMap.get(p.id) === p.circle).length;
  const score = scoredPeople.length > 0 ? correct / scoredPeople.length : 1;
  
  console.log(`CIRCLES: ${(score * 100).toFixed(0)}% (${correct}/${scoredPeople.length})`);
  const mismatches = scoredPeople.filter((p: any) => outMap.get(p.id) !== p.circle).slice(0, 5);
  for (const p of mismatches) {
    console.log(`  ✗ ${p.id}: expected ${p.circle}, got ${outMap.get(p.id) ?? "missing"}`);
  }
  if (mismatches.length < scoredPeople.filter((p: any) => outMap.get(p.id) !== p.circle).length) {
    console.log(`  ... and ${scoredPeople.filter((p: any) => outMap.get(p.id) !== p.circle).length - mismatches.length} more`);
  }
  console.log();
}

// Chats
{
  const outMap = new Map(output.chats.map((c: any) => [c.chat_id, c]));
  let correct = 0;
  let total = 0;
  const mismatches: string[] = [];

  for (const c of answers.chats) {
    total++;
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

  const score = total > 0 ? correct / total : 0;
  console.log(`CHATS: ${(score * 100).toFixed(0)}% (${correct}/${total})`);
  for (const m of mismatches.slice(0, 5)) console.log(`  ✗ ${m}`);
  if (mismatches.length > 5) console.log(`  ... and ${mismatches.length - 5} more`);
  console.log();
}

// Loops Found
{
  const expectedSourceMsgs = new Set(answers.open_loops.flatMap((l: any) => l.source_msgs));
  const outputSourceMsgs = new Set(output.open_loops.map((l: any) => l.source_msg));

  const found = [...outputSourceMsgs].filter((m) => expectedSourceMsgs.has(m)).length;
  const missing = [...expectedSourceMsgs].filter((m) => !outputSourceMsgs.has(m));
  const extra = [...outputSourceMsgs].filter((m) => !expectedSourceMsgs.has(m));

  const precision = outputSourceMsgs.size > 0 ? found / outputSourceMsgs.size : 0;
  const recall = expectedSourceMsgs.size > 0 ? found / expectedSourceMsgs.size : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  console.log(`LOOPS FOUND: ${(f1 * 100).toFixed(0)}% F1 (found ${found}/${expectedSourceMsgs.size}, output ${outputSourceMsgs.size})`);
  console.log(`  Precision: ${(precision * 100).toFixed(0)}%, Recall: ${(recall * 100).toFixed(0)}%`);
  if (missing.length > 0) console.log(`  Missing (first 5): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` ... +${missing.length - 5} more` : ""}`);
  if (extra.length > 0) console.log(`  Extra (first 5): ${extra.slice(0, 5).join(", ")}${extra.length > 5 ? ` ... +${extra.length - 5} more` : ""}`);
  console.log();
}

// Loops Status
{
  const outputBySource = new Map(output.open_loops.map((l: any) => [l.source_msg, l]));
  let correct = 0;
  let total = 0;
  const mismatches: string[] = [];

  for (const exp of answers.open_loops) {
    const out = exp.source_msgs.map((m: string) => outputBySource.get(m)).find(Boolean);
    if (out) {
      total++;
      if (out.status === exp.status) correct++;
      else mismatches.push(`${exp.source_msgs[0]}: expected ${exp.status}, got ${out.status}`);
    }
  }

  const score = total > 0 ? correct / total : 0;
  console.log(`LOOPS STATUS: ${(score * 100).toFixed(0)}% (${correct}/${total} matched loops)`);
  for (const m of mismatches.slice(0, 5)) console.log(`  ✗ ${m}`);
  if (mismatches.length > 5) console.log(`  ... and ${mismatches.length - 5} more`);
  console.log();
}

// Help Actions
{
  const expectedLoops = answers.open_loops.filter((l: any) => l.status === "open" && l.help);
  const outputBySource = new Map(output.open_loops.map((l: any) => [l.source_msg, l]));

  let correct = 0;
  let total = 0;
  const mismatches: string[] = [];

  for (const exp of expectedLoops) {
    const out = exp.source_msgs.map((m: string) => outputBySource.get(m)).find(Boolean);
    if (out && out.status === "open") {
      total++;
      const gotAction = out.help?.action ?? "none";
      if (gotAction === exp.help) correct++;
      else mismatches.push(`${exp.source_msgs[0]}: expected ${exp.help}, got ${gotAction}`);
    }
  }

  const score = total > 0 ? correct / total : 0;
  console.log(`HELP ACTIONS: ${(score * 100).toFixed(0)}% (${correct}/${total} matched open loops)`);
  for (const m of mismatches.slice(0, 5)) console.log(`  ✗ ${m}`);
  if (mismatches.length > 5) console.log(`  ... and ${mismatches.length - 5} more`);
}

console.log("\n" + "=".repeat(60));

// Summary
console.log("\nOUTPUT STATS:");
console.log(`  People: ${output.people.length} (expected: ${answers.people.length})`);
console.log(`  Orgs: ${output.organisations.length} (expected: ${answers.organisations.length})`);
console.log(`  Chats: ${output.chats.length} (expected: ${answers.chats.length})`);
console.log(`  Goals: ${output.goals.length} (expected: ${answers.goals?.length ?? "N/A"})`);
console.log(`  Loops: ${output.open_loops.length} (expected: ${answers.open_loops.length})`);

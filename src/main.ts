// Entry point. Usage: tsx src/main.ts <input_dir> <output.json>
//
// WALKING SKELETON: this mirrors the naive Python starter so we can verify the
// pipeline (parse -> build -> write -> checker) works end to end before adding
// any LLM reasoning. It puts everyone in "friend", makes each group chat its
// own organisation, and ties every 1:1 chat to the other person.

import { readInput, writeOutput } from "./io.js";
import type { Output, OrganisationOut, ChatOut } from "./types.js";

function buildNaiveOutput(input: ReturnType<typeof readInput>): Output {
  const { chats } = input;

  const peopleIds = new Set<string>();
  for (const c of chats) {
    for (const p of c.participants) {
      if (p !== "ME") peopleIds.add(p);
    }
  }

  const organisations: OrganisationOut[] = [];
  const ties: ChatOut[] = [];

  for (const c of chats) {
    if (c.is_group) {
      const orgId = "org_" + c.chat_id;
      organisations.push({
        id: orgId,
        name: c.name,
        type: "other",
        side: "work",
        role: "member",
      });
      ties.push({ chat_id: c.chat_id, organisation: orgId });
    } else {
      const other = c.participants.find((p) => p !== "ME");
      if (other) ties.push({ chat_id: c.chat_id, person: other });
    }
  }

  return {
    people: [...peopleIds].sort().map((id) => ({ id, circle: "friend" })),
    organisations,
    chats: ties,
    goals: [],
    open_loops: [],
  };
}

function main(): void {
  const [inputDir, outputPath] = process.argv.slice(2);
  if (!inputDir || !outputPath) {
    console.error("usage: tsx src/main.ts <input_dir> <output.json>");
    process.exit(2);
  }

  const input = readInput(inputDir);
  const output = buildNaiveOutput(input);
  writeOutput(outputPath, output);

  console.error(
    `wrote ${output.people.length} people, ${output.organisations.length} orgs, ` +
      `${output.chats.length} chats to ${outputPath}`,
  );
}

main();

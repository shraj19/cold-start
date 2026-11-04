// Merge all pass outputs into final output.json format

import type { Pass1Output, Pass2Output, Pass3Output } from "./schemas.js";
import type { Output, PersonOut, OrganisationOut, ChatOut, GoalOut, OpenLoopOut } from "../types.js";
import type { Chat, Seed } from "../types.js";

interface MergeInputs {
  pass1: Pass1Output[];
  pass2: Pass2Output;
  pass3: Pass3Output | null;
  seed: Seed;
  chats: Chat[];
}

/**
 * Build final output.json from all pass results
 */
export function buildFinalOutput(inputs: MergeInputs): Output {
  const { pass1, pass2, pass3, seed, chats } = inputs;

  // ----- PEOPLE -----
  // Priority: seed > pass3 > pass2
  const circleMap = new Map<string, { circle: PersonOut["circle"]; confidence: number }>();

  // From pass2
  for (const dec of pass2.circle_decisions) {
    circleMap.set(dec.person_id, { circle: dec.circle, confidence: dec.confidence });
  }

  // From pass3 (overrides pass2)
  if (pass3) {
    for (const ref of pass3.circle_refinements) {
      circleMap.set(ref.person_id, { circle: ref.circle, confidence: ref.confidence });
    }
  }

  // From seed (always wins)
  for (const [personId, circle] of Object.entries(seed.circles)) {
    circleMap.set(personId, { circle: circle as PersonOut["circle"], confidence: 1.0 });
  }

  // Build person-org links map
  const personLinks = new Map<string, PersonOut["links"]>();
  for (const link of pass2.person_org_links) {
    const existing = personLinks.get(link.person_id) ?? [];
    existing.push({ organisation: link.organisation_id, link: link.link });
    personLinks.set(link.person_id, existing);
  }

  // Collect all person IDs
  const allPersonIds = new Set<string>();
  for (const p1 of pass1) {
    p1.participants.forEach(p => allPersonIds.add(p));
  }

  const people: PersonOut[] = [...allPersonIds]
    .sort()
    .map(id => {
      const circleInfo = circleMap.get(id);
      const circle = circleInfo?.circle ?? "friend"; // Default to friend
      const links = personLinks.get(id);

      const person: PersonOut = { id, circle };
      
      // Only add links for staff and colleague circles
      // (spouse, child, parent, etc. don't need org links)
      if (links && links.length > 0 && (circle === "staff" || circle === "colleague")) {
        person.links = links;
      }
      
      return person;
    });

  // ----- ORGANISATIONS -----
  const organisations: OrganisationOut[] = pass2.org_decisions.map(org => ({
    id: org.id,
    name: org.name,
    type: org.type,
    side: org.side,
    role: org.role,
  }));

  // ----- CHATS -----
  // Map chats to person or organisation
  const chatOuts: ChatOut[] = [];

  for (const chat of chats) {
    const chatOut: ChatOut = { chat_id: chat.chat_id };

    if (!chat.is_group) {
      // 1:1 chat → map to the other person
      const otherPerson = chat.participants.find(p => p !== "ME");
      if (otherPerson) {
        chatOut.person = otherPerson;
      }
    } else {
      // Group chat → try to match to organisation
      const matchedOrg = organisations.find(org => {
        const chatNameLower = chat.name.toLowerCase();
        const orgNameLower = org.name.toLowerCase();
        return (
          chatNameLower.includes(org.id) ||
          chatNameLower.includes(orgNameLower.split(" ")[0]!) ||
          orgNameLower.includes(chatNameLower.split(" ")[0]!)
        );
      });

      if (matchedOrg) {
        chatOut.organisation = matchedOrg.id;
      } else {
        // Fallback: if it looks like home/family, map to home org
        const isHome = /ghar|home|family|परिवार|घर/i.test(chat.name);
        const homeOrg = organisations.find(o => o.id === "home");
        if (isHome && homeOrg) {
          chatOut.organisation = "home";
        } else {
          // Last resort: map to first participant
          const firstPerson = chat.participants.find(p => p !== "ME");
          if (firstPerson) {
            chatOut.person = firstPerson;
          }
        }
      }
    }

    chatOuts.push(chatOut);
  }

  // ----- GOALS -----
  // Priority: pass3 > pass2, but merge unique ones
  const goalMap = new Map<string, GoalOut>();

  for (const goal of pass2.goal_decisions) {
    goalMap.set(goal.title.toLowerCase(), {
      title: goal.title,
      area: goal.area,
      type: goal.type,
      horizon: goal.horizon,
      evidence: goal.evidence,
    });
  }

  if (pass3) {
    for (const goal of pass3.goal_refinements) {
      goalMap.set(goal.title.toLowerCase(), {
        title: goal.title,
        area: goal.area,
        type: goal.type,
        horizon: goal.horizon,
        evidence: goal.evidence,
      });
    }
  }

  const goals: GoalOut[] = [...goalMap.values()].slice(0, 10);

  // ----- OPEN LOOPS -----
  // Priority: pass3 > pass2
  const loopMap = new Map<string, OpenLoopOut>();

  for (const loop of pass2.loop_decisions) {
    const openLoop: OpenLoopOut = {
      title: loop.title,
      type: loop.type,
      owner: loop.owner,
      chat_id: loop.chat_id,
      source_msg: loop.msg_id,
      due: loop.due,
      status: loop.status,
      closed_by: loop.closed_by,
    };

    // Add help for open loops
    if (loop.status === "open" && loop.help_action) {
      openLoop.help = {
        action: loop.help_action,
        ...(loop.help_action === "assist" && loop.help_detail
          ? { next_step: loop.help_detail, needs_yes: true }
          : {}),
        ...(loop.help_action === "remind" && loop.help_detail
          ? { remind_at: loop.help_detail }
          : {}),
        ...(loop.help_action === "leave" && loop.help_detail
          ? { reason: loop.help_detail }
          : {}),
      };
    }

    loopMap.set(loop.msg_id, openLoop);
  }

  // Override with pass3 refinements
  if (pass3) {
    for (const loop of pass3.loop_refinements) {
      const openLoop: OpenLoopOut = {
        title: loop.title,
        type: loop.type,
        owner: loop.owner,
        chat_id: loop.chat_id,
        source_msg: loop.msg_id,
        due: loop.due,
        status: loop.status,
        closed_by: loop.closed_by,
      };

      if (loop.status === "open" && loop.help_action) {
        openLoop.help = {
          action: loop.help_action,
          ...(loop.help_action === "assist" && loop.help_detail
            ? { next_step: loop.help_detail, needs_yes: true }
            : {}),
          ...(loop.help_action === "remind" && loop.help_detail
            ? { remind_at: loop.help_detail }
            : {}),
          ...(loop.help_action === "leave" && loop.help_detail
            ? { reason: loop.help_detail }
            : {}),
        };
      }

      loopMap.set(loop.msg_id, openLoop);
    }
  }

  const open_loops: OpenLoopOut[] = [...loopMap.values()];

  return {
    people,
    organisations,
    chats: chatOuts,
    goals,
    open_loops,
  };
}

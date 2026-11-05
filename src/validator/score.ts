// Scoring logic - matches the challenge scoring rules

import type { Output, Message, Seed, Answers, Scores } from "./types.js";

/** F1 score helper */
function f1(matched: number, predicted: number, actual: number): number {
  if (predicted === 0 || actual === 0) return 0;
  const p = matched / predicted;
  const r = matched / actual;
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}

/** Jaccard similarity */
function jaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  const intersection = [...a].filter(x => b.has(x)).length;
  return intersection / union.size;
}

/** Get members of an organisation (chats + people linked to it) */
function orgMembers(orgId: string, chatsOut: Output["chats"], peopleOut: Output["people"]): Set<string> {
  const members = new Set<string>();

  for (const c of chatsOut) {
    if (c.organisation === orgId) {
      members.add(`c:${c.chat_id}`);
    }
  }

  for (const p of peopleOut) {
    if (p.links?.some(link => link.organisation === orgId)) {
      members.add(`p:${p.id}`);
    }
  }

  return members;
}

/** Match organisations by membership overlap */
function matchOrgs(out: Output, ans: Answers): {
  matched: Map<string, { yourId: string; score: number }>;
  nOurs: number;
  nYours: number;
} {
  const ours = new Map<string, Set<string>>();
  for (const o of ans.organisations) {
    ours.set(o.id, orgMembers(o.id, ans.chats, ans.people));
  }

  const yours = new Map<string, Set<string>>();
  for (const o of out.organisations) {
    yours.set(o.id, orgMembers(o.id, out.chats, out.people));
  }

  // Find best matches
  const pairs: Array<{ score: number; ourId: string; yourId: string }> = [];
  for (const [ourId, ourMembers] of ours) {
    for (const [yourId, yourMembers] of yours) {
      pairs.push({ score: jaccard(ourMembers, yourMembers), ourId, yourId });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const matched = new Map<string, { yourId: string; score: number }>();
  const usedOurs = new Set<string>();
  const usedYours = new Set<string>();

  for (const { score, ourId, yourId } of pairs) {
    if (score > 0 && !usedOurs.has(ourId) && !usedYours.has(yourId)) {
      matched.set(ourId, { yourId, score });
      usedOurs.add(ourId);
      usedYours.add(yourId);
    }
  }

  return { matched, nOurs: ours.size, nYours: yours.size };
}

/**
 * Score output against answer key
 */
export function score(out: Output, ans: Answers, seed: Seed, messages: Message[]): Scores {
  const s: Scores = {
    circles: null,
    organisations: null,
    chats: null,
    goals: null,
    loops_found: null,
    loops_closed: null,
    help: null,
  };

  // --- Circles ---
  const seededCircles = new Set(Object.keys(seed.circles || {}));
  const circleOut = new Map(out.people.map(p => [p.id, p.circle]));
  const scoredPeople = ans.people.filter(p => !seededCircles.has(p.id));

  if (scoredPeople.length > 0) {
    const correct = scoredPeople.filter(p => circleOut.get(p.id) === p.circle).length;
    s.circles = correct / scoredPeople.length;
  }

  // --- Organisations ---
  const { matched: orgMatches, nOurs, nYours } = matchOrgs(out, ans);
  if (nOurs > 0) {
    const totalScore = [...orgMatches.values()].reduce((sum, m) => sum + m.score, 0);
    s.organisations = totalScore / Math.max(nOurs, nYours);
  } else {
    s.organisations = 0;
  }

  // --- Chats ---
  const tieOut = new Map(out.chats.map(c => [c.chat_id, c]));
  let chatRight = 0;

  for (const c of ans.chats) {
    const mine = tieOut.get(c.chat_id);
    if (!mine) continue;

    if (c.person !== undefined) {
      if (mine.person === c.person) chatRight++;
    } else if (c.organisation !== undefined) {
      const match = orgMatches.get(c.organisation);
      if (mine.organisation && match?.yourId === mine.organisation) chatRight++;
    }
  }

  s.chats = ans.chats.length > 0 ? chatRight / ans.chats.length : 0;

  // --- Goals ---
  const seededGoalTitles = new Set((seed.goals || []).map(g => g.title));
  const seededGoals = ans.goals.filter(g => seededGoalTitles.has(g.title));
  const goalsAns = ans.goals.filter(g => !seededGoalTitles.has(g.title));

  // Filter out goals that match seeded goals (by area + overlapping evidence)
  const goalsOut = out.goals.filter(g => {
    return !seededGoals.some(sg => {
      const evidenceSet = new Set(g.evidence || []);
      const seededEvidence = new Set(sg.evidence || []);
      return g.area === sg.area && [...evidenceSet].some(e => seededEvidence.has(e));
    });
  });

  if (goalsAns.length > 0) {
    const usedAns = new Set<number>();
    let hits = 0;

    for (const g of goalsOut) {
      const evidenceSet = new Set(g.evidence || []);
      for (const [j, a] of goalsAns.entries()) {
        if (usedAns.has(j)) continue;
        const ansEvidence = new Set(a.evidence || []);
        if (g.area === a.area && [...evidenceSet].some(e => ansEvidence.has(e))) {
          usedAns.add(j);
          hits++;
          break;
        }
      }
    }

    s.goals = f1(hits, goalsOut.length, goalsAns.length);
  }

  // --- Open Loops ---
  const since = ans.loops_scored_from;
  const tsMap = new Map(messages.map(m => [m.id, m.ts]));

  // Filter loops by timestamp if cutoff specified
  let loopsOut = out.open_loops;
  let loopsAns = ans.open_loops;

  if (since !== undefined) {
    loopsOut = loopsOut.filter(l => (tsMap.get(l.source_msg) || 0) >= since);
    loopsAns = loopsAns.filter(a => {
      const minTs = Math.min(...a.source_msgs.map(m => tsMap.get(m) || 0));
      return minTs >= since;
    });
  }

  // Match loops by source message
  const pairs: Array<{ out: (typeof loopsOut)[number]; ans: (typeof loopsAns)[number] }> = [];
  const usedAns = new Set<number>();

  for (const l of loopsOut) {
    for (const [j, a] of loopsAns.entries()) {
      if (usedAns.has(j)) continue;
      if (a.source_msgs.includes(l.source_msg)) {
        usedAns.add(j);
        pairs.push({ out: l, ans: a });
        break;
      }
    }
  }

  const nAnsLoops = loopsAns.length;

  if (nAnsLoops > 0) {
    s.loops_found = f1(pairs.length, loopsOut.length, nAnsLoops);

    // Status scoring
    let closed = 0;
    for (const { out: l, ans: a } of pairs) {
      if (l.status === a.status) {
        closed++;
      } else if (a.status === "open") {
        closed--;  // Penalty for false close
      }
    }
    s.loops_closed = Math.max(0, closed / nAnsLoops);

    // Help scoring
    const labelled = loopsAns.filter(a => a.status === "open" && a.help);
    if (labelled.length > 0) {
      const pairsByAns = new Map(pairs.map(p => [p.ans, p.out]));
      let helped = 0;

      for (const a of labelled) {
        const l = pairsByAns.get(a);
        const action = l?.status === "open" ? l.help?.action : undefined;

        if (action === a.help) {
          helped++;
        } else if (a.help === "leave" && (action === "assist" || action === "remind")) {
          helped--;  // Penalty for unwanted help
        }
      }
      s.help = Math.max(0, helped / labelled.length);
    }
  }

  return s;
}

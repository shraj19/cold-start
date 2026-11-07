// Chain of Thought extraction - think first, then extract

import type { Message, Chat, Seed } from "../types/index.js";
import type { Batch } from "./batch.js";
import type { BatchOutput } from "./types.js";
import { batchOutputSchema } from "./types.js";
import { generatePlainText } from "../llm/index.js";

// ============================================================
// System Prompt (static - sent once per API call)
// ============================================================

const SYSTEM_PROMPT = `You are an expert at analyzing WhatsApp messages to extract structured data about people, organizations, relationships, goals, and tasks. ME is the phone owner whose chats we're analyzing.

<scoring-rules>
YOU ARE SCORED ON THESE CRITERIA - optimize for them:

1. CIRCLES: Exact match person_id → circle. 100% accuracy required.

2. ORGANIZATIONS: Scored by MEMBERSHIP OVERLAP (Jaccard similarity):
   - Membership = chats assigned to org + people linked to org
   - If you output an org but no chats/people link to it → 0 points
   - CRITICAL: You MUST assign group chats to org_id AND link staff/colleagues to orgs

3. CHATS: Exact match chat_id → person OR organisation.
   - 1:1 chats → person_id
   - Group chats → org_id (NEVER person_id for groups)

4. LOOPS: Matched by source_msg (the message that creates the task).
   - Pick the FIRST message that creates the obligation
   - If wrong source_msg, loop won't match even if title is perfect

5. HELP ACTIONS (most nuanced - pay attention):
   - "assist" = ME can do CONCRETE PREP WORK before the decision/action
     Examples: research options, draft a document, gather information
     Use when: "Book tickets" (ME can research flight options)
   - "remind" = ME's task but ME cannot do meaningful prep, just needs a nudge
     Examples: "Decide on offer", "Finish pitch deck" (ME must do it personally)
     Use when: The task requires ME's personal judgment/action that can't be prepped
   - "leave" = Someone else owns this task entirely, ME should NOT intervene
     Examples: "Vikram sends invoice" (colleague's job), "Karan calls plumber" (spouse took it)
   
   PENALTY: Suggesting "assist" when "remind" is correct loses points!
   Ask yourself: "Can an assistant actually DO prep work, or just remind ME to do it?"
</scoring-rules>

<analysis-steps>
1. PEOPLE: For each person, find relationship evidence (titles, context)
2. ORGANIZATIONS: Identify orgs ME belongs to (company, home)
3. PERSON-ORG LINKS: Staff → "home"/"supports", Colleagues → company/"runs"
4. CHATS: 1:1 → person_id, GROUP → org_id
5. GOALS: Future aspirations with evidence
6. LOOPS: source_msg (FIRST message), owner, status, help action
</analysis-steps>

<output-format>
Return TWO sections:

1. A <thinking> block with your step-by-step analysis
2. A JSON object:

{
  "circles": [{"person_id": "P01", "circle": "spouse|child|staff|colleague|friend|vendor|...", "confidence": 0.9, "evidence": ["M001"]}],
  "person_links": [{"person_id": "P02", "org_id": "home", "link": "runs|supports", "confidence": 0.9, "evidence": ["M006"]}],
  "orgs": [{"id": "home", "name": "Home", "type": "residence|company|...", "side": "home|work", "role": "owner|member|...", "confidence": 0.9, "evidence": ["M001"]}],
  "chats": [{"chat_id": "C01", "person_id": "P01", "confidence": 0.9, "evidence": ["M001"]}],
  "goals": [{"title": "string", "area": "work|health|...", "type": "habit|milestone|experience", "horizon": "3mo|1yr|3yr|5yr", "confidence": 0.9, "evidence": ["M001"]}],
  "loops": [{"title": "string", "type": "commitment|followup|deadline|question", "owner": "ME|P01", "chat_id": "C01", "source_msg": "M001", "due": "YYYY-MM-DD"|null, "status": "open|done|dropped", "closed_by": "M002"|null, "help": {"action": "assist|remind|leave", "next_step": "...", "remind_at": "...", "reason": "..."}|null, "confidence": 0.9}]
}

RULES:
- NEVER include ME in circles
- orgs: "home" for residence, lowercase for companies
- chats: 1:1 → person_id, GROUP → org_id
- help: only for open ME-owned loops; "remind" for personal decisions, "assist" only if prep possible
</output-format>`;

// ============================================================
// User Prompt (dynamic - per batch)
// ============================================================

function formatMessages(messages: Message[]): string {
  return messages
    .map(m => {
      const date = new Date(m.ts * 1000).toISOString().slice(0, 10);
      const sender = m.sender_id === "ME" ? "ME" : `${m.sender_id} (${m.sender_name})`;
      return `[${m.id}] ${date} ${m.chat_id} | ${sender}: ${m.body}`;
    })
    .join('\n');
}

function formatChats(chats: Chat[]): string {
  return chats
    .map(c => {
      const participants = c.participants.filter(p => p !== "ME").join(", ");
      return `${c.chat_id}: "${c.name}" (${c.is_group ? 'group' : '1:1'}) [${participants}]`;
    })
    .join('\n');
}

function buildUserPrompt(batch: Batch, seed: Seed, priorLoops?: Array<{source_msg: string; title: string; owner: string}>): string {
  const knownCircles = Object.entries(seed.circles)
    .map(([id, circle]) => `${id}: ${circle}`)
    .join(', ') || 'none';
  
  const knownOrgs = seed.organisations.join(', ') || 'none';
  
  const seedGoals = (seed.goals || [])
    .map(g => `"${g.title}" (${g.area})`)
    .join(', ') || 'none';

  let priorLoopsSection = '';
  if (priorLoops && priorLoops.length > 0) {
    priorLoopsSection = `\n<prior-open-loops>
These loops were found in earlier messages (source_msg outside this batch). 
If you see evidence they're now DONE or DROPPED, include them with updated status and closed_by.
${priorLoops.map(l => `- ${l.source_msg}: "${l.title}" (owner: ${l.owner})`).join('\n')}
</prior-open-loops>`;
  }

  return `<seed-data>
Known circles (use exactly): ${knownCircles}
Known organizations: ${knownOrgs}
Known goals: ${seedGoals}
</seed-data>${priorLoopsSection}

<chats>
${formatChats(batch.chats)}
</chats>

<messages>
${formatMessages(batch.messages)}
</messages>

Extract all people, organizations, chats, goals, and loops from these messages.`;
}

// ============================================================
// Parse Response
// ============================================================

/** Fix common LLM mistakes before schema validation */
function preprocessData(data: Record<string, unknown>): Record<string, unknown> {
  // Fix goal areas - map common mistakes to valid values
  const areaMap: Record<string, string> = {
    travel: 'experiences',
    vacation: 'experiences',
    leisure: 'experiences',
    trip: 'experiences',
    family: 'spouse',
    career: 'work',
    business: 'work',
    fitness: 'health',
    wellness: 'health',
    money: 'finances',
    personal: 'self',
  };
  
  if (Array.isArray(data.goals)) {
    data.goals = data.goals.map((g: Record<string, unknown>) => {
      if (typeof g.area === 'string' && areaMap[g.area.toLowerCase()]) {
        g.area = areaMap[g.area.toLowerCase()];
      }
      return g;
    });
  }
  
  // Fix org types - map invalid to valid values
  const validOrgTypes = new Set(['company', 'residence', 'vacation home', 'workspace', 'society', 'school', 'other']);
  const orgTypeMap: Record<string, string> = {
    vendor: 'company',
    supplier: 'company',
    client: 'company',
    business: 'company',
    home: 'residence',
    house: 'residence',
  };
  
  // Fix org roles
  const validOrgRoles = new Set(['owner', 'partner', 'helper', 'resident', 'parent', 'member', 'other']);
  const orgRoleMap: Record<string, string> = {
    client: 'member',
    customer: 'member',
    employee: 'member',
    staff: 'helper',
  };
  
  if (Array.isArray(data.orgs)) {
    data.orgs = data.orgs.map((o: Record<string, unknown>) => {
      if (typeof o.type === 'string') {
        const t = o.type.toLowerCase();
        if (!validOrgTypes.has(t)) {
          o.type = orgTypeMap[t] ?? 'other';
        }
      }
      if (typeof o.role === 'string') {
        const r = o.role.toLowerCase();
        if (!validOrgRoles.has(r)) {
          o.role = orgRoleMap[r] ?? 'other';
        }
      }
      return o;
    });
  }
  
  // Fix person_links - only "runs" and "supports" are valid
  const linkMap: Record<string, string> = {
    member: 'supports',
    works: 'runs',
    employee: 'runs',
    colleague: 'runs',
    owner: 'runs',
  };
  
  if (Array.isArray(data.person_links)) {
    data.person_links = data.person_links.map((l: Record<string, unknown>) => {
      if (typeof l.link === 'string') {
        const link = l.link.toLowerCase();
        if (link !== 'runs' && link !== 'supports') {
          l.link = linkMap[link] ?? 'supports';
        }
      }
      return l;
    });
  }
  
  return data;
}

function parseResponse(text: string): { thinking: string; data: BatchOutput } {
  const thinkingMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/);
  const thinking = thinkingMatch?.[1]?.trim() ?? '';

  let jsonPart = thinkingMatch 
    ? text.slice(text.indexOf('</thinking>') + '</thinking>'.length).trim()
    : text;

  jsonPart = jsonPart.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  const jsonMatch = jsonPart.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('  [DEBUG] No JSON found. Raw response:\n', text.slice(0, 2000));
    throw new Error('No JSON found in response');
  }

  try {
    let parsed = JSON.parse(jsonMatch[0]);
    parsed = preprocessData(parsed);  // Fix common mistakes
    const validated = batchOutputSchema.parse(parsed);
    return { thinking, data: validated };
  } catch (err) {
    console.error('  [DEBUG] JSON parse error. JSON part:\n', jsonMatch[0].slice(0, 2000));
    throw err;
  }
}

// ============================================================
// Main Extraction
// ============================================================

export interface PriorLoop {
  source_msg: string;
  title: string;
  owner: string;
}

export async function extractBatchCot(
  batch: Batch,
  seed: Seed,
  batchNum: number,
  totalBatches: number,
  priorLoops?: PriorLoop[]
): Promise<{ output: BatchOutput; thinking: string }> {
  console.error(`  Batch ${batchNum}/${totalBatches}: ${batch.messages.length} msgs, ${batch.chats.length} chats`);
  
  const userPrompt = buildUserPrompt(batch, seed, priorLoops);
  
  try {
    const text = await generatePlainText(userPrompt, { 
      system: SYSTEM_PROMPT,
      temperature: 0 
    });
    
    const { thinking, data } = parseResponse(text);
    
    const thinkingLines = thinking.split('\n').filter(l => l.trim()).length;
    console.error(`    ✓ ${thinkingLines} lines of reasoning`);
    console.error(`    ✓ ${data.circles.length} circles, ${data.orgs.length} orgs, ${data.chats.length} chats, ${data.goals.length} goals`);
    
    return { output: data, thinking };
  } catch (err) {
    console.error(`    ✗ ${err instanceof Error ? err.message : err}`);
    return {
      output: { circles: [], orgs: [], chats: [], goals: [], loops: [], person_links: [] },
      thinking: '',
    };
  }
}

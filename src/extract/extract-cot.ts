// Chain of Thought extraction - think first, then extract

import { z } from "zod";
import type { Message, Chat, Seed } from "../types/index.js";
import type { Batch } from "./batch.js";
import type { BatchOutput } from "./types.js";
import { 
  batchOutputSchema, 
  circleExtractSchema, 
  personLinkExtractSchema, 
  orgExtractSchema, 
  chatExtractSchema, 
  goalExtractSchema, 
  loopExtractSchema 
} from "./types.js";
import { generatePlainText, generate } from "../llm/index.js";
import { SYSTEM_PROMPT } from "./prompts.js";

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

function buildUserPrompt(batch: Batch, seed: Seed, priorLoops?: Array<{source_msg: string; title: string; owner: string | null}>): string {
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
  
  // Fix loop types - map common mistakes to valid values
  const validLoopTypes = new Set(['commitment', 'followup', 'deadline', 'question']);
  const loopTypeMap: Record<string, string> = {
    task: 'commitment',
    promise: 'commitment',
    todo: 'commitment',
    action: 'commitment',
    waiting: 'followup',
    pending: 'followup',
    'follow-up': 'followup',
    'follow up': 'followup',
    reminder: 'deadline',
    due: 'deadline',
    ask: 'question',
    query: 'question',
    request: 'commitment',
  };
  
  if (Array.isArray(data.loops)) {
    data.loops = data.loops
      .filter((l: Record<string, unknown>) => l && typeof l.source_msg === 'string')
      .map((l: Record<string, unknown>) => {
        if (typeof l.type === 'string') {
          const t = l.type.toLowerCase();
          if (!validLoopTypes.has(t)) {
            l.type = loopTypeMap[t] ?? 'commitment';  // default to commitment
          }
        }
        return l;
      });
  }
  
  return data;
}

/** Safely parse an array, keeping only valid items */
function safeParseArray<T>(
  arr: unknown,
  schema: z.ZodType<T>,
  label: string
): T[] {
  if (!Array.isArray(arr)) return [];
  
  const results: T[] = [];
  let errors = 0;
  
  for (let i = 0; i < arr.length; i++) {
    const result = schema.safeParse(arr[i]);
    if (result.success) {
      results.push(result.data);
    } else {
      errors++;
      if (errors <= 2) {  // Only log first 2 errors per section
        console.error(`    [SKIP] ${label}[${i}]: ${result.error.issues[0]?.message}`);
      }
    }
  }
  
  if (errors > 2) {
    console.error(`    [SKIP] ${label}: +${errors - 2} more errors`);
  }
  
  return results;
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
    
    // Partial validation - keep valid items even if some fail
    const data: BatchOutput = {
      circles: safeParseArray(parsed.circles, circleExtractSchema, 'circles'),
      person_links: safeParseArray(parsed.person_links, personLinkExtractSchema, 'person_links'),
      orgs: safeParseArray(parsed.orgs, orgExtractSchema, 'orgs'),
      chats: safeParseArray(parsed.chats, chatExtractSchema, 'chats'),
      goals: safeParseArray(parsed.goals, goalExtractSchema, 'goals'),
      loops: safeParseArray(parsed.loops, loopExtractSchema, 'loops'),
    };
    
    return { thinking, data };
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
  owner: string | null;
}

export async function extractBatchCot(
  batch: Batch,
  seed: Seed,
  batchNum: number,
  totalBatches: number,
  priorLoops?: PriorLoop[],
  fewShotPrompt?: string
): Promise<{ output: BatchOutput; thinking: string }> {
  console.error(`  Batch ${batchNum}/${totalBatches}: ${batch.messages.length} msgs, ${batch.chats.length} chats`);
  
  const userPrompt = buildUserPrompt(batch, seed, priorLoops);
  
  // Add few-shot prompt to system prompt if provided
  const systemPrompt = fewShotPrompt ? SYSTEM_PROMPT + '\n' + fewShotPrompt : SYSTEM_PROMPT;
  
  try {
    // Plain text generation — model outputs JSON freely, we parse + partial validate
    const text = await generatePlainText(userPrompt, { system: systemPrompt, temperature: 0 });

    const jsonPart = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const jsonMatch = jsonPart.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('  [DEBUG] No JSON found. Raw:\n', text.slice(0, 500));
      throw new Error('No JSON found in response');
    }

    const preprocessed = preprocessData(JSON.parse(jsonMatch[0]) as Record<string, unknown>);
    const data: BatchOutput = {
      circles:      safeParseArray(preprocessed['circles'],      circleExtractSchema,      'circles'),
      person_links: safeParseArray(preprocessed['person_links'], personLinkExtractSchema,  'person_links'),
      orgs:         safeParseArray(preprocessed['orgs'],         orgExtractSchema,         'orgs'),
      chats:        safeParseArray(preprocessed['chats'],        chatExtractSchema,        'chats'),
      goals:        safeParseArray(preprocessed['goals'],        goalExtractSchema,        'goals'),
      loops:        safeParseArray(preprocessed['loops'],        loopExtractSchema,        'loops'),
    };

    console.error(`    ✓ ${data.circles.length} circles, ${data.orgs.length} orgs, ${data.chats.length} chats, ${data.goals.length} goals`);
    return { output: data, thinking: '' };
  } catch (err) {
    console.error(`    ✗ ${err instanceof Error ? err.message : err}`);
    return {
      output: { circles: [], orgs: [], chats: [], goals: [], loops: [], person_links: [] },
      thinking: '',
    };
  }
}

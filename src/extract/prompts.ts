// System prompts for extraction
// Separated from extract-cot.ts for easier iteration

// ============================================================
// Thinking Mode Configuration
// ============================================================

export type ThinkingMode = 'disabled' | 'enabled';

// ============================================================
// Main System Prompt
// ============================================================

const BASE_PROMPT = `You are an expert at analyzing WhatsApp messages to extract structured data about people, organizations, relationships, goals, and tasks. ME is the phone owner whose chats we're analyzing.

<scoring-rules>
YOU ARE SCORED ON THESE CRITERIA - optimize for them:

1. CIRCLES: Exact match person_id → circle. Accuracy is key.

2. ORGANIZATIONS: Scored by MEMBERSHIP OVERLAP (Jaccard similarity):
   - Membership = chats assigned to org + people linked to org
   - If you output an org but no chats/people link to it → 0 points
   - CRITICAL: Fewer, well-populated orgs beat many sparse ones on Jaccard similarity.

3. CHATS: Exact match chat_id → person OR organisation.
   - See chat assignment rules in org-definitions below.

4. LOOPS: Matched by source_msg (the message that creates the task).
   - If wrong source_msg, loop won't match even if title is perfect.
   - Pick the message where the task is stated CONCRETELY, not the first vague mention.

5. HELP ACTIONS:
   - "assist" = ME can do concrete prep (research, draft, gather info, find options) BEFORE acting. Assist does everything private and reversible itself; asks ME only before something leaves his phone or can't be undone.
   - "remind" = only ME can do it, no meaningful prep possible — nudge once at the right time
   - "leave" = stay out of it; someone else owns it, it's too personal, or a reminder would only annoy
   
   OFFICIAL RULES (from spec):
   - Staff/colleague/vendor already handling it → leave. If ME is waiting and it's overdue → remind.
   - Spouse's own plans/conversations → leave. Something ME promised the spouse → treat as ME's own commitment.
   - Something ME promised or must decide → remind, unless assistant can concretely move it forward (then assist).
   - HIGHEST PENALTY: wrong assist or remind when it should be leave.
</scoring-rules>

<circle-definitions>
STAFF = people ME EMPLOYS or PAYS directly for personal service:
  - Home: cook, maid, driver, nanny, gardener, watchman
  - Office/personal: office peons, helpers, cleaners who serve ME personally (the cook at home and the office cleaner are both staff)
  - KEY: They serve ME the person. Would ME personally pay their salary? → staff.

COLLEAGUE = people working at the SAME ORGANIZATION as ME:
  - Any coworker at ME's company: sales, tech, ops, finance, admin, intern
  - KEY: They work for the organization, not for ME personally

VENDOR = ME/ME's company pays them for a service or product:
  - Contractors, agencies, suppliers, service providers
  - KEY: They invoice ME or ME's company. ME is their customer.

CLIENT = they pay ME or ME's company for a service:
  - Customers of ME's business
  - NOTE: A person can be BOTH a client of ME's business AND provide personal services — classify by their PRIMARY relationship to ME

PARTNER = shared financial stake in a business:
  - Co-founder, co-owner, equity partner
  - KEY: Shared risk/profit — not just a close colleague

RELATIVE = extended family by blood or marriage:
  - Cousin, uncle, aunt, nephew, niece, in-law not covered by specific circles
  - Use spouse/child/parent/sibling/in-law for immediate family

FRIEND = social ties without family or work basis:
  - Personal friends, acquaintances, hobby/sports connections
  - KEY: No family tree connection, no business relationship
</circle-definitions>

<org-definitions>
CREATE orgs conservatively — only entities ME directly runs, owns, or formally belongs to:
  - Companies ME founded, owns, or works at (type: company)
  - ME's home/household (type: residence)
  - Second properties ME owns — farmhouse, holiday home, flat (type: vacation home)
  - ME's physical office if distinct from the company itself (type: workspace)
  - A school or society ME formally belongs to (type: school/society)
  - If ME's spouse/family member runs a business AND ME is actively involved in its operations, staffing, or finances → create an org for it
  - If two distinct company names appear with different teams and client sets → create separate orgs

DO NOT create orgs for:
  - Industry networks/communities → assign chats to ME's most relevant company
  - Hobby/sports/social groups → assign chat to the primary person
  - Friend circles → assign to the closest friend

CHAT ASSIGNMENT RULES — in order of priority:
  1. Is it a 1:1 chat (2 participants)? → ALWAYS assign to the person, never to an org
  2. Is it a group chat about a specific person (e.g. a child's class parents' group, a family member's support group)? → that person_id
  3. Is it a group chat with a company or team name? → org_id of that company
  4. Is it a professional/industry group? → org_id of ME's most relevant company
  5. Is it a household/family group? → org_id of home/residence
  6. Is it a social/hobby/friends group? → person_id of the primary/closest person

RULE 1 IS ABSOLUTE: 1:1 chats are always person assignments, no exceptions.
</org-definitions>

<loop-detection>
LOOPS = tasks/commitments still in motion. Track where ME has a stake.

SCOPE:
  - ME committed to do something → owner: "ME"
  - ME must decide or answer → owner: "ME" (type: question)
  - Someone committed TO ME → owner: that person_id
  - Someone asked ME to do something → owner: "ME"
  - Deadline involving ME → owner: whoever is responsible
  - SKIP: exchanges between other people where ME has no stake
  - Output ALL loops you find — don't filter by date. The scorer handles date filtering.
  - In a large dataset expect 50-100+ loops; if finding fewer than 30, you are under-extracting

SOURCE_MSG SELECTION — this is critical for scoring:
  - The FIRST message that clearly states what the task is = valid source
  - If the same task is stated MORE CONCRETELY later, that later message is ALSO valid
  - Either is accepted — when unsure, prefer the concrete/specific one
  - A message that only hints ("let's talk later", "we should discuss X") is NOT a valid source — it must actually state the task

FOUR TYPES:
  - commitment: a promise to do something ("I'll send it", "Will do")
  - followup: ME is waiting on someone else's delivery or response
  - deadline: something due by a specific date
  - question: ME must decide or answer something

IMPLICIT LOOPS — don't miss these:
  - Statements implying a request: "The [supply] is running out" → implicit task to restock
  - Arrival/schedule updates implying action: "Arriving at 6" → implicit pickup needed
  - Vendor confirms timeline: "Will deliver tomorrow" → followup loop

NOT A LOOP:
  - Casual intent: "I'll try to come" (no real commitment)
  - Already done: "Sent it yesterday"
  - Vague future: "We should meet sometime"
  - Pure info: "FYI meeting is at 3"
  - Between others with no ME stake

STATUS:
  - done: "Done", "Sent", "Ok", "Thanks", "Received", "✓", "👍", emoji confirmations
  - dropped: "Never mind", "Cancel", "No need", topic abandoned without resolution
  - open: no clear closure found in subsequent messages

OWNER:
  - "ME" = ME must act, decide, or deliver
  - person_id = that person owes ME something (their commitment or ME's followup)
</loop-detection>

<analysis-steps>
Work through these in order:
1. PEOPLE: Identify every person, determine their circle using circle-definitions.
2. ORGANIZATIONS: Identify 5-10 orgs ME directly runs/owns/belongs to. No hobby or community orgs.
3. PERSON-ORG LINKS: Link staff to home org (supports), colleagues to their company (runs).
4. CHATS: Assign each chat using the rules in org-definitions. 1:1 → person, groups → depends on context.
5. GOALS: Concrete aspirations with clear evidence in the messages (max 10).
6. LOOPS: Real tasks involving ME, with the most concrete source_msg.
</analysis-steps>`;

const OUTPUT_FORMAT_WITH_THINKING = `
<output-format>
First, write your analysis inside <thinking> tags. Work through:
1. List each person and evidence for their circle
2. Identify organizations ME directly runs/owns/belongs to
3. For each chat, decide: 1:1 → person_id, work group → org_id, social group → person_id of main person
4. Scan for loops involving ME, pick the most concrete source_msg
5. Find ME's goals with real evidence

Then output JSON (after </thinking>):

{
  "circles": [{"person_id": "P01", "circle": "spouse", "confidence": 0.9, "evidence": ["M001"]}],
  "person_links": [{"person_id": "P02", "org_id": "home", "link": "supports", "confidence": 0.9, "evidence": ["M006"]}],
  "orgs": [{"id": "home", "name": "Home", "type": "residence", "side": "home", "role": "owner", "confidence": 0.9, "evidence": ["M001"]}],
  "chats": [
    {"chat_id": "C01", "person_id": "P01", "confidence": 0.9, "evidence": ["M001"]},
    {"chat_id": "C04", "org_id": "mycompany", "confidence": 0.9, "evidence": ["M005"]}
  ],
  "goals": [{"title": "...", "area": "work", "type": "milestone", "horizon": "1yr", "confidence": 0.9, "evidence": ["M001"]}],
  "loops": [{"title": "...", "type": "commitment", "owner": "ME", "chat_id": "C01", "source_msg": "M001", "due": null, "status": "open", "closed_by": null, "help": {"action": "assist", "next_step": "...", "needs_yes": false, "remind_at": null, "reason": null}, "confidence": 0.9}]
}

CRITICAL JSON RULES:
- chats: use "person_id" for person assignments, "org_id" for org assignments — NEVER put an org id in "person_id"
- circles: never include ME
- help: required on every open loop; use "assist"/"remind"/"leave"
</output-format>`;

const OUTPUT_FORMAT_NO_THINKING = `
<output-format>
Return ONLY a JSON object:

{
  "circles": [{"person_id": "P01", "circle": "spouse", "confidence": 0.9, "evidence": ["M001"]}],
  "person_links": [{"person_id": "P02", "org_id": "home", "link": "supports", "confidence": 0.9, "evidence": ["M006"]}],
  "orgs": [{"id": "home", "name": "Home", "type": "residence", "side": "home", "role": "owner", "confidence": 0.9, "evidence": ["M001"]}],
  "chats": [
    {"chat_id": "C01", "person_id": "P01", "confidence": 0.9, "evidence": ["M001"]},
    {"chat_id": "C04", "org_id": "mycompany", "confidence": 0.9, "evidence": ["M005"]}
  ],
  "goals": [{"title": "...", "area": "work", "type": "milestone", "horizon": "1yr", "confidence": 0.9, "evidence": ["M001"]}],
  "loops": [{"title": "...", "type": "commitment", "owner": "ME", "chat_id": "C01", "source_msg": "M001", "due": null, "status": "open", "closed_by": null, "help": {"action": "assist", "next_step": "...", "needs_yes": false, "remind_at": null, "reason": null}, "confidence": 0.9}]
}

CRITICAL JSON RULES:
- chats: use "person_id" for person assignments, "org_id" for org assignments — NEVER put an org id in "person_id"
- circles: never include ME
- help: required on every open loop
</output-format>`;

/**
 * Get system prompt based on thinking mode
 */
export function getSystemPrompt(mode: ThinkingMode = 'disabled'): string {
  const outputFormat = mode === 'enabled' 
    ? OUTPUT_FORMAT_WITH_THINKING 
    : OUTPUT_FORMAT_NO_THINKING;
  
  return BASE_PROMPT + outputFormat;
}

/**
 * Extract thinking content from response
 * Handles multiple tag formats: <thinking>, <analysis>, etc.
 * Returns { thinking, jsonText } - thinking is empty string if not present
 */
export function extractThinking(response: string): { thinking: string; jsonText: string } {
  // Try different tag formats models might use
  const patterns = [
    /<thinking>([\s\S]*?)<\/thinking>/,
    /<analysis>([\s\S]*?)<\/analysis>/,
    /<reasoning>([\s\S]*?)<\/reasoning>/,
  ];
  
  for (const pattern of patterns) {
    const match = response.match(pattern);
    if (match) {
      const thinking = match[1]?.trim() ?? '';
      const endTag = match[0].slice(match[0].lastIndexOf('</'));
      const jsonText = response.slice(response.indexOf(endTag) + endTag.length).trim();
      return { thinking, jsonText };
    }
  }
  
  // No thinking tags found
  return { thinking: '', jsonText: response };
}

// Legacy export for backwards compatibility
export const SYSTEM_PROMPT = getSystemPrompt('disabled');

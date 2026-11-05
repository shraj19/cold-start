// Prompts for V1 giant prompt approach

export const SYSTEM_PROMPT = `You are analyzing WhatsApp chats to extract structured information about relationships, organisations, goals, and pending tasks.

CRITICAL RULES:
- ME is the person whose chats we're analyzing - NEVER include ME in the people array
- NEVER fabricate or invent details - only extract what's explicitly in the messages
- Use seed data as ground truth when available
- If unsure about something, omit it rather than guess
- Output ONLY valid JSON - no markdown, no explanation, no code blocks

=== ORGANISATION IDs ===
Use simple, standard English IDs:
- For residence: use "home" (NOT "ghar", "house", etc.)
- For company: use lowercase name like "brightside", "acme"
- The user is "owner" of their home and their company

=== HELP ACTION LOGIC (CRITICAL) ===
For OPEN loops only, decide how assistant should help:

"assist" - Assistant can move it forward WITHOUT user doing the work:
  - Research options (flights, hotels, restaurants)
  - Draft messages or documents
  - Find information
  - Example: "Book Coorg tickets" → assist (can research options, needs user approval to book)

"remind" - Only the user can do the actual work, assistant just reminds:
  - Personal decisions only user can make
  - Work only user can do (pitch deck, design work)
  - Example: "Halcyon pitch deck due Friday" → remind (only ME can do the work)

"leave" - Stay OUT, do not remind or assist:
  - Someone ELSE (not ME) owns the task
  - Spouse's/partner's commitments - not assistant's place to nag
  - Colleague handling their own work
  - Example: "Karan calls the plumber" → leave (Karan owns it, don't remind wife about husband's task)
  - Example: "Vikram sends invoice" → leave (colleague owns it)

=== GOALS ===
Look for THREE types:
- habit: Regular activities (running, meditation)
- milestone: Specific targets with numbers/dates (10 clients by March)
- experience: Trips, events, celebrations (Coorg trip, anniversary dinner)

=== LINKS ===
- Colleagues "runs" the company WITH the user
- Staff "supports" the home
- Vendors do NOT link to organisations (they are external)
- Family (spouse, child, parent) do NOT link to organisations

=== OPEN LOOPS (IMPORTANT) ===
Extract ALL tasks/commitments/questions, including COMPLETED ones:
- "open" = still needs action
- "done" = completed (find the closing message that confirms completion)
- "dropped" = abandoned/cancelled

Look for these patterns:
- Questions asked: "What should I make?" → question (done when answered)
- Commitments made: "I'll book it" → commitment
- Tasks delegated: "Can you pick her up?" → commitment by that person
- Deadlines mentioned: "Due Friday" → deadline
- Waiting on someone: "Send me the proofs" → followup (done when received)

IMPORTANT: Include loops that were COMPLETED in the chat. Look for:
- Question asked, then answered later → status: "done"
- Task promised, then confirmed done → status: "done"  
- Request made, then fulfilled → status: "done"`;

// Goes at START of prompt (before raw data)
export const EXTRACTION_RULES = `EXTRACTION TASK
===============

Analyze the WhatsApp chat data and output a JSON object with EXACTLY this structure:

{
  "people": [
    {
      "id": "P123",                    // REQUIRED: person ID from messages
      "circle": "friend",              // REQUIRED: one of: spouse|child|parent|in-law|sibling|relative|friend|colleague|client|vendor|partner|staff
      "links": [                       // OPTIONAL: org connections
        {"organisation": "orgid", "link": "runs"}  // link must be "runs" or "supports"
      ],
      "looks_after": ["P456"]          // OPTIONAL: people they care for
    }
  ],
  "organisations": [
    {
      "id": "mycompany",               // REQUIRED: short lowercase id
      "name": "My Company Ltd",        // REQUIRED: display name
      "type": "company",               // REQUIRED: one of: company|residence|vacation home|workspace|society|school|other
      "side": "work",                  // REQUIRED: "home" or "work"
      "role": "owner"                  // REQUIRED: one of: owner|partner|helper|resident|parent|member|other
    }
  ],
  "chats": [
    {
      "chat_id": "C01",                // REQUIRED: chat_id from input
      "person": "P123"                 // For 1:1 chats: the other person's ID
    },
    {
      "chat_id": "C02",
      "organisation": "mycompany"      // For group chats: the relevant org ID
    }
  ],
  "goals": [
    {
      "title": "Learn Spanish",        // REQUIRED
      "area": "self",                  // REQUIRED: one of: self|spouse|kids|parents|work|friends|experiences|finances|health|home
      "type": "habit",                 // REQUIRED: one of: habit|milestone|experience
      "horizon": "1yr",                // REQUIRED: one of: 3mo|1yr|3yr|5yr
      "evidence": ["M001", "M045"]     // REQUIRED: message IDs as evidence
    }
  ],
  "open_loops": [
    {
      "title": "Send invoice to client",   // REQUIRED: max 60 chars
      "type": "commitment",                // REQUIRED: one of: commitment|followup|deadline|question
      "owner": "ME",                       // REQUIRED: "ME" or person ID
      "chat_id": "C01",                    // REQUIRED: where this came up
      "source_msg": "M123",                // REQUIRED: message ID that created this
      "status": "open",                    // REQUIRED: one of: open|done|dropped
      "due": "2024-03-15",                 // OPTIONAL: YYYY-MM-DD or null
      "closed_by": null,                   // OPTIONAL: message ID if closed
      "help": {                            // OPTIONAL: only for open loops
        "action": "remind"                 // REQUIRED in help: one of: assist|remind|leave
      }
    }
  ]
}

CRITICAL RULES:
1. Use EXACTLY the field names shown above (not "name" for people, not "org_links", not "source_msg_id")
2. Every chat MUST appear in "chats" array with either "person" OR "organisation" (not both, not neither)
3. Use seed.circles values as ground truth for known people
4. Do NOT link family members (spouse, child, parent, sibling) to organisations
5. Colleagues link with "runs", vendors/staff link with "supports"

DATA TO ANALYZE:`;

// Goes at END of prompt (after raw data)
export const OUTPUT_REMINDER = `
================================================================================
OUTPUT REQUIREMENTS - READ CAREFULLY
================================================================================

Return ONLY a valid JSON object. No markdown, no \`\`\`, no explanation.

FIELD NAMES (use EXACTLY these):
✓ people[].id, people[].circle, people[].links (NOT "org_links" or "name")
✓ people[].links[].organisation (NOT "organisation_id" or "org_id")
✓ chats[].chat_id (NOT "id")
✓ chats[].person OR chats[].organisation (exactly one per chat)
✓ open_loops[].source_msg (NOT "source_msg_id")
✓ open_loops[].status (REQUIRED, one of: open|done|dropped)

EVERY CHAT must be in the output - tie each to a person or organisation.

Output the JSON now:`;



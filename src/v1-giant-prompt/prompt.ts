// Prompts for V1 giant prompt approach

export const SYSTEM_PROMPT = `You are analyzing WhatsApp chats to extract structured information about relationships, organisations, goals, and pending tasks.

CRITICAL RULES:
- ME is the person whose chats we're analyzing - NEVER include ME in the people array
- NEVER fabricate or invent details - only extract what's explicitly in the messages
- Use seed data as ground truth when available
- If unsure about something, omit it rather than guess
- Output ONLY valid JSON - no markdown, no explanation, no code blocks`;

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



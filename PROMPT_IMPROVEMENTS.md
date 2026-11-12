# Prompt Improvements - Edge Cases Analysis

## Edge Cases from Reference Prompt (What They Handle Well)

### 1. **Indian Household Staff Context** 🔥
```
<indian-household-context>
In Indian households, these honorifics indicate staff relationships:
- "didi" (elder sister) after name = household staff: "Sunita didi"
- "bhaiya" (elder brother) = male staff: "Raju bhaiya"
- "driver" in name = driver staff: "Raju driver"
- "ji" = respectful suffix for staff or elders

Staff behavioral patterns:
- Report task completion: "Anya ko ghar chhod diya"
- Ask about tasks: "kya banana hai?"
- Acknowledge instructions: "Theek hai didi/bhaiya"
</indian-household-context>
```

**Why This Helps**: Prevents models from confusing staff with relatives/friends

**Our Current Issue**: We just say "staff" with minimal context

---

### 2. **Detailed Circle Table with Indicators** 🔥
```
| Circle | Indicators |
|--------|------------|
| spouse | Romantic partner, shares family decisions, "❤️" in chat name, discusses kids together |
| staff | Household help - uses honorifics (didi, bhaiya, ji), reports task completion |
| colleague | Works WITH ME at same company, discusses team business |
| vendor | ME pays THEM for services (printers, shops, delivery) |
| client | Pays ME's company for services |
```

**Why This Helps**: Concrete behavioral indicators prevent confusion

**Our Current Issue**: We list circles without clear differentiation

---

### 3. **Explicit "NEVER" Rules** 🔥
```
- NEVER include "ME" in the people array
- NEVER add a link for clients or vendors — they do business WITH the org but are NOT members of it
- ⚠️ Organisation referenced in chat MUST exist in that chat's organisations array
- ❌ "other" is INVALID — use "friend" for acquaintances, "colleague" for ex-colleagues
```

**Why This Helps**: Prevents common hallucinations

**Our Current Issue**: We have some rules but not comprehensive NEVER blocks

---

### 4. **Signal Types with Examples** 🔥
```
KEY DISTINCTIONS:
- "I'll book the tickets" → commitment (ME is owed_by)
- "Das ji, brochure proofs kab tak?" → followup_needed (ME asked P07; owed_by: P07)
- "Not yet, will send tonight" → commitment_updated, closes the original commitment's msg_id
- "Never mind, got it elsewhere" → cancellation, closes the original followup/commitment msg_id
```

**Why This Helps**: Shows exact patterns with examples

**Our Current Issue**: We describe loop types but lack concrete examples

---

### 5. **Wrong vs Right Format Examples** 🔥
```
⚠️ LINKS FORMAT - MUST use these exact field names:
❌ WRONG: { "org_id": "brightside", "type": "runs" }
✅ CORRECT: { "organisation": "brightside", "link": "runs" }
```

**Why This Helps**: Prevents schema errors

**Our Current Issue**: We don't show wrong examples

---

## Proposed Changes to Our SYSTEM_PROMPT

### Change 1: Add Indian Household Context

**Insert after `<analysis-steps>` before `<loop-detection>`:**

```typescript
<indian-household-context>
Indian households often employ domestic staff. Detect them by:

HONORIFICS (strong indicators):
- "didi" suffix = female staff: "Sunita didi", "Nayna didi"
- "bhaiya" suffix = male staff: "Raju bhaiya"
- "ji" suffix = respectful (staff or vendor): "Das ji"
- Role in name: "Raju driver", "cook", "maid"

BEHAVIORAL PATTERNS (confirm staff):
- Report task completion: "Anya ko ghar chhod diya", "Khana ready hai"
- Ask instructions: "Kya banana hai?", "Kab aana hai?"
- Acknowledge orders: "Theek hai", "Ji madam", "Done madam"
- Use sir/madam consistently

CRITICAL: If someone has "didi/bhaiya/ji" AND shows staff behavior → circle="staff", NOT "friend" or "relative"
</indian-household-context>
```

---

### Change 2: Add Circle Indicators Table

**Replace current circles list with detailed table:**

```typescript
<circles-with-indicators>
Valid circles (ONLY these 12 - NO EXCEPTIONS):

| Circle | When to Use | Behavioral Indicators |
|--------|-------------|----------------------|
| spouse | Romantic partner | Discusses family decisions together, "❤️" in name, talks about kids/home |
| child | ME's child | Young, being picked up from school/tuition, "beta", "bachcha" |
| parent | ME's parent | "Papa", "Mummy", "Mom", "Dad", gives parental advice |
| in-law | Spouse's family | "Sasurji", "Saasuma", spouse's parents/siblings |
| sibling | Brother/sister | "Bhai", "Didi", discusses family matters as peers |
| relative | Extended family | Aunts, uncles, cousins - family but not immediate |
| friend | Social relationship | Casual chat, shared hobbies (sports, movies), no work context |
| colleague | Works WITH ME | Same company, discusses team/projects, work-only topics |
| client | Pays ME's company | Business relationship, discusses deliverables they're paying for |
| vendor | ME pays THEM | Provides services TO ME (printer, shop, delivery) |
| partner | Business co-owner | Co-owns business with ME, strategic decisions together |
| staff | Household help | Uses honorifics (didi/bhaiya/ji), reports tasks, "sir"/"madam" |

COMMON MISTAKES TO AVOID:
- ❌ Ex-colleague discussing old times → friend (NOT colleague)
- ❌ Family friend with "Aunty/Uncle" → friend (NOT relative)
- ❌ Vendor who says "ji" → vendor (NOT staff - they work for themselves)
- ❌ Client's employee → if they work for client's company: client relationship
</circles-with-indicators>
```

---

### Change 3: Add Explicit NEVER Rules

**Add before `<output-format>`:**

```typescript
<never-rules>
CRITICAL - NEVER DO THESE (common hallucinations):

PEOPLE:
- ❌ NEVER include "ME" in circles array
- ❌ NEVER use "other" as circle - pick closest match from the 12 valid circles
- ❌ NEVER link clients/vendors to orgs - they do business WITH org, not IN org

ORGANISATIONS:
- ❌ NEVER create org for vendor/client companies ME doesn't work at
- ❌ NEVER use uppercase in org id - must be lowercase: "brightside" not "Brightside"
- ❌ NEVER reference org in chat.org_id that doesn't exist in orgs array

CHATS:
- ❌ NEVER assign group chat (is_group=true) to person_id - MUST use org_id
- ❌ NEVER assign 1:1 chat (is_group=false) to org_id - MUST use person_id

LOOPS:
- ❌ NEVER pick reminder message as source_msg - pick the FIRST commitment message
- ❌ NEVER add help action to closed loops (done/dropped) - only open loops

PERSON LINKS:
- ❌ NEVER link people who just MENTION an org - only link if they WORK at/for it
- ❌ NEVER use link="colleague" or "staff" - use "runs" or "supports"
</never-rules>
```

---

### Change 4: Add Loop Examples

**Add to `<loop-detection>` section:**

```typescript
LOOP EXAMPLES (learn these patterns):

✅ COMMITMENT:
"I'll book the tickets by Friday" → type: commitment, owner: ME, source_msg: this message

✅ FOLLOWUP:
"Raj, did you send that invoice?" → type: followup, owner: P05 (Raj owes ME), source_msg: this message

✅ QUESTION:
"Should we accept the Zest offer?" → type: question, owner: ME (ME must decide), source_msg: this message

✅ CLOSURE PATTERNS:
"Done ✓" / "Booked" / "Sent" / "Attached" / "Proofs are ready madam" → status: done, closed_by: this message

❌ COMMON MISTAKES:
- "Let me check" is NOT a commitment (vague, no clear action)
- "Maybe we should..." is NOT a commitment (just a suggestion)
- "I'm thinking about..." is NOT a commitment (just considering)
- Reminder "Don't forget to book tickets" → NOT a new loop if original commitment exists
</loop-detection>
```

---

### Change 5: Add Wrong vs Right Examples

**Add to `<output-format>`:**

```typescript
<format-examples>
❌ WRONG vs ✅ RIGHT:

CIRCLES:
❌ {"person_id": "ME", "circle": "spouse"} → NEVER include ME
✅ {"person_id": "P01", "circle": "spouse"}

❌ {"person_id": "P02", "circle": "other"} → No "other" allowed
✅ {"person_id": "P02", "circle": "friend"}

PERSON LINKS:
❌ {"person_id": "P02", "org_id": "brightside", "type": "runs"} → Wrong field names
✅ {"person_id": "P02", "org_id": "home", "link": "supports"}

CHATS:
❌ {"chat_id": "C01", "person_id": "P01", "org_id": "home"} → Can't have both
✅ {"chat_id": "C01", "person_id": "P01"} → 1:1 chat

❌ {"chat_id": "C02", "person_id": "P01"} (but C02 is group chat) → Group must use org_id
✅ {"chat_id": "C02", "org_id": "home"}

ORGS:
❌ {"id": "Brightside Design", "name": "Brightside Design"} → ID must be lowercase slug
✅ {"id": "brightside", "name": "Brightside Design"}

LOOPS:
❌ {"owner": "Raj"} → Use person ID, not name
✅ {"owner": "P05"}

❌ {"status": "done", "help": {"action": "remind"}} → Don't add help to closed loops
✅ {"status": "done", "help": null}
</format-examples>
```

---

## Summary of Changes

| # | What | Why | Expected Impact |
|---|------|-----|-----------------|
| 1 | Indian household context | Detect staff correctly | +5-10% circles accuracy |
| 2 | Circle indicators table | Differentiate colleague/friend/staff | +10-15% circles accuracy |
| 3 | Explicit NEVER rules | Prevent hallucinations | +5% across all categories |
| 4 | Loop examples | Better loop detection | +10-20% loop finding |
| 5 | Wrong vs Right format | Reduce schema errors | Fewer validation skips |

**Total Expected Improvement: +20-30% on dev dataset** (from 30% → 50-60%)

---

## Next Steps

1. ✅ Review proposed changes
2. 🔄 Update SYSTEM_PROMPT in extract-cot.ts
3. 🧪 Test on dev dataset with thinking enabled
4. 📊 Compare before/after scores
5. 📝 Document what worked

Would you like me to implement these changes now?

# Cold Start Challenge — Writeup

## What I Focused On and Why

**Circles and chats** first — strongest signals, highest confidence returns. Relationship markers (titles, names, chat names, group membership) are reliable even without fine-tuning.

**Loops and help actions** — 28/100 points combined, highest single bloc. I invested most prompt engineering here. The core challenge is picking the right `source_msg` and not confusing casual statements with real commitments.

**Organizations** — scored on Jaccard similarity so a few well-populated orgs beat many sparse ones. Strategy: conservative creation, consolidate industry communities into the main company.

I didn't optimize goals heavily — sparse signal in two weeks of data, and not labeled on the dev set.

## Approach

### Single Large Batch
All messages are sent in one call per batch (up to 800K tokens). Keeps full conversation context intact — a message like "ok sir" only reveals hierarchy with the surrounding exchange visible.

### Chain-of-Thought Extraction
The model reasons first (inside `<thinking>` tags), then outputs JSON. This catches implicit patterns: a staff member's leave notice is a followup loop for whoever manages the house; a vendor's "will deliver tomorrow" is a followup for ME.

### Confidence-Based Merge
When batches disagree, highest confidence wins. Terminal loop states (done/dropped) override open — the batch that saw the closing message has the right answer.

### Post-Processing
Only data-driven validation — drops loops whose `source_msg` isn't in the input. No hardcoded IDs that would fail on the hidden set.

## Cost

**Submission model:** `deepseek/deepseek-v4.1-flash-1017` via OpenRouter  
**Pricing:** ~$0.035/M input, $0.50/M output tokens  
**Estimated cost:** ~$0.009–0.015 per 1,000 messages (≈ 0.25× baseline)

Where tokens go: ~90% message content, ~8% system prompt, ~2% output JSON.

## Where It's Wrong

| Part | Expected accuracy | Main failure mode |
|------|-------------------|-------------------|
| Circles | ~75% | colleague↔staff, relative↔friend at edges |
| Organisations | ~25-40% | Missing implicit secondary orgs (spouse's business) |
| Chats | ~85-90% | Group chats with ambiguous context |
| Loops found | ~20-30% | Wrong `source_msg` (picks vague msg not concrete one) |
| Loop status | ~40-60% | Implicit closures ("ok" ≠ always done) |
| Help actions | ~50-60% | assist vs remind boundary is subjective |

**Biggest known weakness:** loop `source_msg` selection. The model finds the right conceptual task but points to a slightly different message than the answer key. Even a correct loop title doesn't score if the message ID is wrong.

**What I'd fix with more time:** a post-processing step that, for each found loop, searches nearby messages for a better-matching `source_msg` candidate using the loop title as a semantic anchor.

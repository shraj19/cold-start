# Cold Start Challenge — Writeup

## What I Focused On

**Circles and chat assignment** — these have the clearest signals in conversation patterns. Relationship words ("sir", "bhai", "mom"), message frequency, and group membership provide strong evidence.

**Loop extraction pipeline** — the most challenging part. Built cross-batch tracking so loops created early can be marked done/dropped when closure messages appear in later batches.

**Robustness over optimization** — free/cheap models produce inconsistent outputs. The system gracefully handles malformed JSON, invalid enums, and partial extractions rather than failing entirely.

## Approach

### Chat-Based Batching

Messages are grouped by chat, keeping complete conversations together:

```
Messages grouped by chat → Token-limited batches → LLM extraction → Merge
```

**Why?** Splitting a conversation mid-thread loses context needed to infer relationships. A message like "ok sir" only reveals hierarchy if you see the full exchange.

### Cross-Batch Loop Tracking

Open loops from earlier batches are passed forward, so later batches can recognize closures:

```
Batch 1: finds "I'll send invoice" (open)
         ↓ passed as prior context
Batch 2: sees "Invoice sent" → marks loop done
```

### Confidence-Based Merge

When batches disagree, highest confidence wins. Terminal states (done/dropped) override open — the batch that saw the closing message has better context.

### Post-Processing

Only data-driven validation:
- Drop loops with invalid `source_msg` (not in input messages)
- No hardcoded IDs that would break on hidden set

## Cost

**Model:** `deepseek/deepseek-v4.1-flash-1017` via OpenRouter

**Pricing:** $0.07/M input, $0.28/M output tokens

**Estimated cost:** ~$0.02–0.04 per 1,000 messages

**Where tokens go:**
- ~90% on message content in prompts
- ~8% on system prompt (scoring rules, format)
- ~2% on output generation

## Where It's Wrong

### Expected Failure Modes

| Category | Expected Accuracy | Issue |
|----------|-------------------|-------|
| Circles | ~75-80% | Confuses colleague↔staff, relative↔friend |
| Organizations | ~20-30% | Missing implicit orgs not named directly |
| Chats | ~75-85% | Some group chats misassigned |
| Loops found | ~30-40% | False positives from casual statements |
| Loop status | ~40-50% | Misses implicit closures ("Thanks" = done?) |
| Help actions | ~50% | assist vs remind boundary is subjective |

### Specific Weaknesses

1. **Loop false positives** — "I'll try to come" extracted as commitment when it's not
2. **Implicit organizations** — "the office" creates an org, but which one?
3. **Help action subjectivity** — what counts as "assistant can prep" varies by person
4. **Cross-chat loops** — task in one chat, closure in another (~10% of cases)

### What I Didn't Optimize

- **Organizations** — requires understanding implicit membership from context
- **Help actions** — would need real user feedback to calibrate assist/remind/leave
- **Goals** — sparse signal in short time windows; not scored heavily on dev

## Files

```
run.sh              # Entry: ./run.sh <input_dir> <output.json>
src/
├── main.ts         # CLI wrapper
├── extract/        # Core pipeline
│   ├── index.ts    # Orchestrator
│   ├── prompts.ts  # System prompt
│   ├── batch-by-chat.ts
│   ├── extract-cot.ts
│   ├── merge.ts
│   └── post-process.ts
├── types/          # Schemas
├── io/             # File I/O
└── llm/            # LLM client with retry
docs/
├── DIAGRAMS.md     # Architecture diagrams
└── APPROACHES.md   # Design decisions
```

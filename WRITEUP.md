# Cold Start Challenge — Writeup

## What I Focused On

**Loop extraction accuracy** — specifically status detection (open/done/dropped) and help action classification (assist/remind/leave). These are the most nuanced parts of the scoring rubric, and early iterations showed 60-70% accuracy here while circles/chats were already at 100%.

**Multi-batch architecture** — designed for 30K+ messages where single-call extraction would exceed context limits. The system uses sliding-window batching with code-based merge, keeping costs low while maintaining accuracy.

## Approach

### Chain of Thought Extraction

Each batch goes through a two-phase LLM call:
1. **Thinking phase** — step-by-step reasoning about people, relationships, and tasks
2. **Structured output** — JSON matching the output schema

The system prompt embeds the scoring rubric directly, so the model optimizes for what's actually measured:
- Help action definitions (assist = prep work possible, remind = just needs nudge, leave = someone else's task)
- Source message selection (first message creating the obligation)
- Circle classification rules

### Sliding Window Batching

```
Messages sorted by time → Window of 1000 msgs → LLM → BatchOutput
                       → Next window (100 overlap) → LLM → BatchOutput
                                                          ↓
                                              Code-based merge (no LLM)
```

**Why overlap?** Context continuity. A task created in batch N might be closed in batch N+1 — overlap ensures the closing message sees enough prior context.

**Cross-batch loop tracking:** Open loops from earlier batches are passed forward as context, so later batches can recognize closures even when the source message isn't in their window.

### Code-Based Merge

No LLM tokens spent on merging. For each entity type:
- **Circles/Chats:** Dedupe by ID, highest confidence wins, seed overrides
- **Loops:** Dedupe by source_msg, **terminal states (done/dropped) beat open** — the batch that saw a closing message has more context
- **Goals:** Group by area + title similarity, combine evidence

## Costs

**For 30,000 messages (~34 batches):**

| Model | Input Tokens | Output Tokens | Total Cost |
|-------|-------------|---------------|------------|
| DeepSeek | ~1.4M | ~68K | **~$0.25** |
| GPT-4o | ~1.4M | ~68K | ~$4.50 |

Using DeepSeek (`deepseek-chat`) at $0.14/1M input, $0.28/1M output.

**Where the money goes:**
- ~95% on message content in user prompts (40K tokens per batch)
- ~3% on system prompt (repeated per batch, but only 800 tokens)
- ~2% on output generation

**For the example dataset (29 messages, 1 batch):** ~$0.001

## Where It's Wrong

### Expected Errors

| Category | Expected Accuracy | Common Mistakes |
|----------|-------------------|-----------------|
| Circles | 95-100% | Confusing staff vs vendor for service providers |
| Chats | 95-100% | Rare — 1:1 vs group is explicit in metadata |
| Loops Found | 75-85% | Missing subtle commitments ("I'll think about it") |
| Loop Status | 90-100% | Missing implicit closures (thumbs up = done?) |
| Help Actions | 85-95% | assist vs remind boundary is subjective |

### Specific Failure Modes

1. **Implicit closures** — "👍" or "done" without explicit reference to which task
2. **Chained commitments** — "I'll book tickets" followed by "Actually, let me check prices first" — which is the source message?
3. **Hindi/Hinglish nuance** — "Theek hai" can mean acknowledgment OR commitment depending on context
4. **Help action edge cases** — "Finish the pitch deck" could be assist (help draft) or remind (ME must do it personally)

### Robustness

- **Invalid enum values:** Preprocessing maps common LLM mistakes (leisure→experiences, vendor→company, member→supports)
- **Partial JSON:** Falls back gracefully if one batch fails — other batches still contribute
- **Schema validation:** Zod validates every batch output before merge

## Files

```
run.sh              # Entry point: ./run.sh <input_dir> <output.json>
src/main.ts         # CLI wrapper
src/extract/        # Extraction pipeline
  index.ts          # Orchestrator (batching + merge)
  batch.ts          # Sliding window (1000 msgs, 100 overlap)
  extract-cot.ts    # LLM extraction with Chain of Thought
  merge.ts          # Code-based merge (no LLM)
  types.ts          # BatchOutput schema
src/types/          # Input/output schemas
src/validator/      # Scoring logic (matches challenge server)
```

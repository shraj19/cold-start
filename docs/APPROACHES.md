# Approaches Considered

A summary of design decisions and alternatives evaluated during development.

---

## Batching Strategies

| Strategy | Description | Result |
|----------|-------------|--------|
| **Time-based sliding window** | Split messages chronologically with overlap | Breaks mid-conversation context |
| **Chat-based batching** ✅ | Keep complete chats together in batches | Better relationship inference |
| **Parallel extraction** | Multiple LLM calls in parallel per batch | More API calls, no accuracy gain |
| **Single mega-prompt** | All data in one call | Context too large, worse extraction |

**Decision:** Chat-based batching. Preserves conversation context, critical for circle/loop detection.

---

## Prompt Engineering

| Approach | Result |
|----------|--------|
| **Chain of Thought** | Tried `<thinking>` tags — free models ignore them |
| **Few-shot examples** | 17.4/56 — worse than zero-shot (23.2/56) |
| **Compressed prompts** | 21.8/56 — slightly worse |
| **Scoring rules in prompt** | Helps model prioritize what matters |

**Decision:** Zero-shot with explicit scoring rules. Free models respond better to direct instructions than examples.

---

## Cross-Batch Loop Tracking

**Problem:** A loop created in batch 1 may be closed in batch 3.

**Solution:** Pass "prior open loops" to each subsequent batch:
```
Batch 1 → finds Loop A (open) → pass to Batch 2
Batch 2 → sees "Done!" message → marks Loop A (done)
```

---

## Data Store Options

| Option | Considered For | Decision |
|--------|----------------|----------|
| **In-memory Map** ✅ | Message/chat lookup | Used — simple, sufficient for dataset size |
| **SQLite + FTS** | Full-text search | Not needed — LLM sees all messages |
| **Vector embeddings** | Semantic search | Overkill — would add latency without accuracy gain |

---

## Merge Strategy

Multiple batches may extract the same entity differently.

| Entity | Merge Rule |
|--------|------------|
| **Circles** | Seed overrides all; else highest confidence |
| **Organizations** | Dedupe by name similarity |
| **Chats** | Highest confidence assignment |
| **Goals** | Group by title similarity, combine evidence, cap at 10 |
| **Loops** | Dedupe by source_msg; terminal status (done/dropped) wins over open |

---

## Post-Processing

**Kept (data-driven):**
- Validate loop `source_msg` exists in input messages

**Removed (test-specific):**
- Hardcoded org ID mapping (would break on hidden set)

---

## Model Selection

| Model | Score | Cost | Notes |
|-------|-------|------|-------|
| ERNIE 5.5 Flash (free) | 23.2/56 | $0 | High variance between runs |
| DeepSeek V4.1 Flash | TBD | $0.07/M input | More consistent, better reasoning |

**Submission model:** `deepseek/deepseek-v4.1-flash-1017`

---

## Tools & Libraries

- **Vercel AI SDK** — LLM client with retry logic
- **Zod** — Schema validation for LLM outputs
- **tsx** — Run TypeScript directly, no build step

---

## What Wasn't Pursued

| Idea | Why Not |
|------|---------|
| **Fine-tuning** | Rules prohibit it |
| **Multi-agent orchestration** | Added complexity, no evidence of benefit |
| **Embedding-based deduplication** | Simple string matching sufficient |
| **External knowledge bases** | Challenge requires inference from chat only |

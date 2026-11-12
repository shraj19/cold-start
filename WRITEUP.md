# Cold Start Challenge — Writeup

## What I Focused On

**Circles and chat assignment** — these scored highest (76% and 79% on dev) with relatively straightforward prompt engineering. The model correctly identifies relationships from conversation patterns.

**Loop extraction** — the most challenging part. Open loops scored only 25% due to high false positive rate (80% of extracted loops were incorrect). Status detection and help classification remain weak points.

**Cost optimization** — using free models (ERNIE via OpenRouter) to minimize cost while maintaining acceptable accuracy.

## Approach

### Chat-Based Batching

The system groups messages by chat, ensuring complete conversations stay together:

```
Messages grouped by chat → Complete chats per batch → LLM → BatchOutput
                                                          ↓
                                              Code-based merge + post-processing
```

**Why chat-based?** Context integrity. Splitting a conversation mid-thread loses relationship signals and loop status changes.

**Cross-batch loop tracking:** Open loops from earlier batches are passed forward, so later batches can recognize closures.

### Prompt Engineering Experiments

| Approach | Score | Result |
|----------|-------|--------|
| CoT batching (baseline) | **23.2/56** | Best |
| Compressed prompt | 21.8/56 | Worse |
| Few-shot examples | 17.4/56 | Much worse |
| Hybrid 2-call approach | 12.8/56 | Much worse |

**Key finding:** Weak/free models need smaller focused calls, not compressed prompts or few-shot examples. The hybrid approach (all data in 2 calls) scored 45% worse than batching.

### Post-Processing

Deterministic fixes after LLM extraction:
- Map org names to expected ID format
- Validate loop source_msg IDs exist
- Normalize enum values (e.g., `acquaintance` → `friend`)

## Costs

**Model:** `baidu/ernie-5.5-flash-preview:free` via OpenRouter

**Cost:** $0.00 (free tier)

At OpenRouter's paid pricing for this model, estimated ~$0.01-0.02 per 1,000 messages.

**Where tokens go:**
- ~90% on message content in prompts
- ~8% on system prompt (scoring rules, format)
- ~2% on output generation

## Where It's Wrong

### Dev Set Results (23.2/56)

| Category | Score | Issues |
|----------|-------|--------|
| Circles | 9.1/12 (76%) | Confuses colleague↔staff, relative↔friend |
| Organisations | 1.1/8 (14%) | Missing orgs (Nexus DaaS, Farmhouse, Office) |
| Chats | 6.3/8 (79%) | Some group chats misassigned |
| Loops found | 3.5/14 (25%) | 80% false positives |
| Loops closed | 3.2/14 (23%) | Misses implicit closures |

### Specific Failure Modes

1. **Loop false positives** — Model extracts casual statements as commitments ("I'll try to come" is not a loop)
2. **Missing organizations** — Some orgs mentioned in context aren't explicitly identified
3. **Circle confusion** — Staff vs colleague boundary unclear for some service providers
4. **Help action subjectivity** — assist vs remind boundary is inherently subjective

### Robustness

- **Invalid enums:** Preprocessing maps common mistakes to valid values
- **Partial failures:** Graceful fallback if one batch fails
- **Schema validation:** Zod validates every output before merge

## Predicted vs Actual Failures

| Predicted | Actual |
|-----------|--------|
| Loops ~75-85% | Loops 25% — much worse than expected |
| Circles ~95% | Circles 76% — slightly worse |
| Chats ~95% | Chats 79% — worse than expected |
| Orgs decent | Orgs 14% — much worse (missing entities) |

**Why the gap:** Free models are weaker than paid alternatives. The baseline was built assuming GPT-4o or DeepSeek quality. ERNIE struggles with nuanced extraction.

## Files

```
run.sh              # Entry point: ./run.sh <input_dir> <output.json>
src/main.ts         # CLI wrapper
src/extract/        # Extraction pipeline
  index.ts          # Orchestrator (batching + merge + post-process)
  batch-by-chat.ts  # Chat-based batching
  extract-cot.ts    # LLM extraction
  merge.ts          # Code-based merge
  post-process.ts   # Deterministic fixes
src/types/          # Input/output schemas
src/validator/      # Scoring logic
```

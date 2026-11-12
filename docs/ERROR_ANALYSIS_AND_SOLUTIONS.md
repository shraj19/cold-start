# Error Analysis and Solutions

## Current Status
- **Best Score:** 23.2/56 (CoT batching baseline, saved in `dev-no-fewshot.json`)
- **Model:** ERNIE 5.5 Flash Preview (free via OpenRouter)

## What We Tried and Results

| Approach | Score | Notes |
|----------|-------|-------|
| CoT batching (baseline) | **23.2/56** | Best result |
| Compressed prompt | 21.8/56 | Worse - weak models need scaffolding |
| Longer prompts | 21.3/56 | Worse |
| Few-shot examples | 17.4/56 | Much worse |
| CoT thinking block | 17.7/56 | Much worse |
| Hybrid 2-call approach | 12.8/56 | Much worse - model struggles with all data at once |

## Key Findings

### 1. Org ID Format Doesn't Affect Score
- We output: `postmyad`, `nexus`, `home`
- Answers expect: `O5`, `O7`, `O6`
- **But scoring uses membership overlap (Jaccard similarity)**, not ID matching
- Post-processing to map IDs doesn't change score

### 2. LLM Output Varies Each Run
- Each run produces different results due to model randomness
- Best strategy: run multiple times, keep best output
- The 23.2/56 score was a specific good run

### 3. Weak Models Need Smaller Focused Calls
- CoT batching (smaller chunks) works better than 2 big calls
- The hybrid approach (all data in 2 calls) scored 45% worse
- Model struggles to maintain focus on large context

### 4. Loop False Positives
- 80% of extracted loops are false positives
- Aggressive filtering (cap at 2 per chat) hurt recall
- Minimal validation (check source_msg exists) is safer

## Current Performance (Baseline)

**Dev Dataset:** 23.2/56 (41.4%)
- Circles: 9.1/12 (76%)
- Organisations: 1.1/8 (14%)
- Chats: 6.3/8 (79%)
- Loops found: 3.5/14 (25%)
- Loops closed: 3.2/14 (23%)

---

## Error Analysis

### 1. LOOPS - Biggest Problem (80% false positives!)

| Metric | Value |
|--------|-------|
| Expected | 63 |
| Our output | 120 |
| Matched correctly | 24 (38% recall) |
| False positives | 96 (80% of output is wrong!) |
| Precision | 20% |
| F1 Score | ~0.26 |

**Root cause:** Model over-detects loops. Every casual mention becomes a "commitment".

### 2. ORGANISATIONS (14% score)

| Expected (Answers) | Our Output | Issue |
|-------------------|------------|-------|
| O5 = PostMyAd | postmyad | ID format mismatch |
| O7 = NEXUS | nexus | ID format mismatch |
| O6 = Home | home | ID format mismatch |
| O1 = Nexus DaaS | ❌ missing | Not detected |
| O2 = Farmhouse | ❌ missing | Not detected |
| O3 = Office | ❌ missing | Not detected |
| O4 = Radiant | radiant | ID format mismatch |

**Root cause:** 
- We generate lowercase name IDs (`postmyad`), answers use format (`O5`)
- Missing 3 orgs completely (Nexus DaaS, Farmhouse, Office)

### 3. CIRCLES (75.6% accuracy)

| Metric | Value |
|--------|-------|
| Expected people | 41 |
| Correct | 31 |
| Wrong | 8 |
| Missing | 2 |

**Common confusions:**
- colleague ↔ staff
- relative ↔ colleague  
- sibling ↔ relative
- client ↔ vendor

---

## What We Tried (That Failed)

| Approach | Result | Why It Failed |
|----------|--------|---------------|
| Longer prompts with more rules | Score dropped 41% → 38% | Weak models get worse with more constraints |
| Few-shot examples | Score dropped 41% → 31% | Added tokens without adding capability |
| Chain-of-thought thinking | Score dropped 41% → 32% | Model can't reason through steps - just adds error surface |
| Prompt compression | Score dropped 41% → 39% | Removed helpful scaffolding that weak models need |

**Key insight:** All prompt engineering approaches made things WORSE on weak free-tier model (ERNIE).

---

## Expert Recommendations (ChatGPT + Claude Consensus)

### Strong Consensus (Both Agree)

1. **Decompose into stages** - Don't ask one LLM call to do everything
   - Separate calls for loops, orgs, circles
   - Chunk by conversation/time window
   
2. **Deterministic code for IDs/dedup** - Don't use LLM for things that don't need semantic understanding
   - Entity registry with aliases
   - ID assignment in code
   - Deduplication in code
   
3. **Verify/filter pass for loops** - Treat first pass as high-recall candidate generation
   - Binary YES/NO verification per candidate
   - Evidence-based with reject option
   - Weak models do better at binary judgments than open-ended extraction

4. **Categorize false positives first** - Understand WHY before fixing
   - One-time events?
   - Casual suggestions?
   - Repeated mentions of same event?
   - Hypothetical plans?
   - Completed activities?

### Key Principle

> "Stop trying to solve this by making the prompt more elaborate. A weak model can become less reliable when given too many simultaneous constraints. Prompting cannot compensate for an inherently poorly decomposed extraction task."

---

## Recommended Implementation Order

| Order | Action | Expected Impact | Effort |
|-------|--------|-----------------|--------|
| 1 | **Categorize 96 false positive loops** | Understand the problem | Low |
| 2 | **Add deterministic dedup + alias resolution** | Fix org IDs, reduce duplicates | Medium |
| 3 | **Add YES/NO verification pass for loops** | Cut false positives | Medium |
| 4 | **Decompose into separate calls** | Most architectural change | High |
| 5 | **Benchmark stronger models** | Know if model is bottleneck | Low |

---

## Architecture Options

### Current Architecture (Single Call)
```
Raw messages → LLM (extract everything) → JSON output
```

### Proposed Architecture (Multi-Stage)
```
Raw messages
    ↓
Stage 1: Candidate extraction (LLM)
    - Identify possible entities, activities, relationships
    ↓
Stage 2: Validation (LLM + Code)
    - Binary YES/NO verification for loops
    - Evidence checking
    ↓
Stage 3: Entity resolution (Code)
    - Alias matching
    - ID assignment
    - Deduplication
    ↓
Validated structured output
```

### Task Distribution

| Task | Method |
|------|--------|
| Extracting message IDs | Code |
| Assigning canonical IDs | Code |
| Removing duplicate loops | Code |
| Matching org aliases | Code + fuzzy matching |
| Detecting potential entities | LLM |
| Understanding relationships | LLM |
| Determining if activity is recurring | LLM + validation rules |

---

## Open Questions

1. **How are loops currently extracted?**
   - Feeding batches and asking LLM to generate all loops directly
   - Need to check if many of 120 are duplicates of same loop

2. **What patterns cause false positives?**
   - Need to categorize the 96 false positive loops
   - Likely 2-3 patterns account for most (greetings, acknowledgments, etc.)

3. **Why are 3 orgs missing?**
   - Nexus DaaS, Farmhouse, Office
   - Are they in group chats? How are they mentioned?

---

## Files Reference

**Dev outputs saved:**
- `dev-no-fewshot.json` - Best baseline (23.2/56)
- `dev-with-fewshot.json` - With few-shot (17.4/56)
- `output_thinking_short.json` - With thinking block (17.7/56)
- `output_improved.json` - With prompt improvements (21.0/56)
- `output_fixed_dev.json` - Compressed + fixed (21.8/56)

**Answers:**
- `dev/answers/answers.json` - Ground truth

---

## Next Steps

1. [ ] Categorize the 96 false positive loops
2. [ ] Check how many of 120 loops are duplicates
3. [ ] Implement deterministic org alias resolution
4. [ ] Add loop verification pass
5. [ ] Benchmark with decomposed architecture

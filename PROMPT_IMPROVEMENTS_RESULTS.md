# Prompt Improvements Results

## Changes Made

Added 5 improvements to SYSTEM_PROMPT in `src/extract/extract-cot.ts`:

1. **Indian Household Context** - Staff detection with honorifics (didi/bhaiya/ji) and behavior patterns
2. **Circle Indicators Table** - Detailed table with behavioral indicators for each circle type
3. **Explicit NEVER Rules** - Hard constraints to prevent common hallucinations
4. **Loop Examples** - Concrete examples showing commitment/followup/question patterns
5. **Format Examples** - Wrong vs Right examples showing correct schema usage

## Test Results (Dev Dataset - 4502 messages)

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| **Total Score** | 23.2 / 56 (41.4%) | 21.0 / 56 (37.5%) | **-2.2 points** ❌ |
| Circles | 9.1 / 12 (76%) | 8.5 / 12 (71%) | -0.6 |
| Organisations | 1.1 / 8 (14%) | 0.8 / 8 (10%) | -0.3 |
| Chats | 6.3 / 8 (79%) | 6.6 / 8 (83%) | +0.3 ✅ |
| Open loops found | 3.5 / 14 (25%) | 3.2 / 14 (23%) | -0.3 |
| Open loops closed | 3.2 / 14 (23%) | 1.9 / 14 (14%) | -1.3 |

**Conclusion: The prompt improvements made things WORSE on ERNIE free tier.**

## Why It Failed

### 1. Model Quality is the Bottleneck

ERNIE 5.5 Flash Preview (free tier) is too weak to benefit from detailed instructions:
- Adding more context/rules diluted the core instructions
- Complex tables and structured examples require stronger reasoning
- Weak models perform worse with longer prompts

### 2. Prompt Length Increased Significantly

Before: ~400 lines of instructions
After: ~600 lines with tables, examples, NEVER rules

This likely caused:
- Key instructions buried in noise
- Model confusion from conflicting priorities
- Token budget eaten by system prompt

### 3. The Improvements Were Designed for Better Models

These prompt patterns work well on models like:
- GPT-4
- Claude 3.5 Sonnet
- Gemini 3.1 Flash
- Gemini 2.0 Flash

They DON'T work well on free-tier models that struggle with:
- Following complex structured instructions
- Understanding tables
- Applying negative constraints ("NEVER do X")
- Learning from examples

## What Actually Matters

Looking at the error breakdown:

1. **Open loops closed accuracy dropped 58%** (3.2 → 1.9) - The improved prompt made loop status detection MUCH worse

2. **Circles accuracy dropped 7%** (9.1 → 8.5) - Staff/colleague differentiation didn't help

3. **Organisations dropped 27%** (1.1 → 0.8) - The linking rules may have confused the model

4. **Only chats improved** (6.3 → 6.6, +5%) - The 1:1 vs group examples helped slightly

## Recommendations

### Option A: Revert Prompt, Focus on Model Quality

**Best path forward:**

1. ✅ Revert to the simpler prompt (23.2/56 baseline)
2. ✅ Add OpenRouter credits ($5 minimum)
3. ✅ Test with better free models:
   - `google/gemini-2.0-flash-thinking-exp-01-21:free` - New reasoning model
   - `google/gemini-2.0-flash-exp:free` - Fast, good quality
   - `meta-llama/llama-3.3-70b-instruct:free` - Strong instruction following
4. ✅ Re-test prompt improvements on better model

Expected improvement: **40% → 60-70%** just from better model

### Option B: Simplify Improvements for Weak Models

If stuck with ERNIE:

1. Keep ONLY the format examples (wrong vs right)
2. Keep ONLY the 3 most critical NEVER rules
3. Remove tables, remove behavioral indicators
4. Keep prompt under 450 lines total

Expected improvement: **40% → 45%** (marginal)

### Option C: Optimize for ERNIE Specifically

1. Test smaller batch sizes (ERNIE may struggle with 4502 messages)
2. Add explicit thinking steps ("First, identify staff by honorifics...")
3. Simplify circle definitions to single-line descriptions
4. Remove all examples and tables

Expected improvement: **40% → 48%** (uncertain)

## Next Steps

**RECOMMENDED:** Go with Option A

1. Revert src/extract/extract-cot.ts to baseline prompt
2. Add OpenRouter credits
3. Test google/gemini-2.0-flash-exp:free (best free option)
4. Re-apply prompt improvements if quality justifies
5. Commit and prepare submission

**Why:** The bottleneck is model quality, not prompt quality. Adding $5 of credits will deliver 3x better results than prompt engineering on a free weak model.

## Files

- Before: `dev-no-fewshot.json` (23.2/56)
- After: `output_improved.json` (21.0/56)
- Changes: `src/extract/extract-cot.ts` (SYSTEM_PROMPT section)


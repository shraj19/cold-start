# Cold Start — AI-Assisted Development Log

Tool: Kiro (Claude-based agent), with consultation of ChatGPT and Claude directly at key decision points.

---

## Nov 4 — Architecture Design

Explored store architecture options. Discussed vector DB (LanceDB vs in-memory embeddings) — decided in-memory for 30K scale, no external dependency needed.

Designed pipeline structure. Started with multi-pass folder (pass1-3, merge). User pushed back on complexity: "remove multi-pass and make pipeline folder, llm.ts is confusing." Simplified LLM client to a single export.

Built V1 giant prompt approach (src/v1-giant-prompt/). Key insight from user: "LLMs lose in middle — important prompts at start and finish." Restructured prompt: EXTRACTION_RULES → data → OUTPUT_REMINDER.

**Score:** Example 54.6/74 — Circles 1.0, Orgs 0.88, Chats 1.0, Loops 0.63, Help 0.0

---

## Nov 5 — Multi-Pass + Schema Fixes

Tried hybrid extractor: 59.4/74 on example. Fixed org ID generation (use first word only) → 60.7/74.

Designed 3-pass architecture with confidence tracking. User: "i think we should do at least few chats at once in phase 1." Batched multiple chats per call → score dropped 62.3 → 47.1/74. Reverted to per-chat. Lesson: batching multiple conversations per call loses per-conversation focus.

Schema validation failures: prompt was describing wrong field names (organisation_id instead of organisation). Fixed. Added "NEVER include ME in people", "NEVER fabricate details" rules.

Hit Gemini rate limits (20 RPD). Rotated models: gemini-3.6-flash → 3.8-flash → 3.1-flash-lite.

---

## Nov 5-6 — V2 Batching + Model Research

Built V2 with token-aware batching. User: "why using smaller batch size?" Analyzed dev data: 4502 msgs, ~214K tokens, ~48 tokens/msg average.

**Critical architecture decision — parallel vs sequential:** User asked for honest review. Sequential is correct — parallel breaks loop detection (a closure message in batch 2 can't mark a loop from batch 1 as done). Decided: 1M context model, single batch for dev.

Researched free OpenRouter models with 1M context + JSON mode. Found: baidu/ernie-5.5-flash-preview:free is the only viable option. Configured, ran — 1 batch but schema validation failed. Fixed Zod schemas (defaults, nullable), added circle/goal area preprocessing.

Previous 16-batch DeepSeek run: 7% circles, 35% chats, 9% loops. Single batch with ERNIE: significantly better.

**Plain text vs structured output:** Tried switching from plain text to generate() with explicit batchOutputSchema. Structured output returned empty chats/goals, took 292 seconds. Tried hybrid (structured with fallback) — still empty. Reverted to plain text + partial validation — all fields populated, 85 seconds. Lesson: structured output too conservative for complex nested schemas; partial validation works better.

**Gap analysis vs spec:** User pasted challenge requirements. Found missing: looks_after field, owner: null for followups. Added wife's conversations rule, overdue followups rule. Fixed priorLoops token budget — maxTokens didn't account for prior loop context passed between batches.

**Chat-based vs time-sorted batching:** User: "would batching based on full chats have been better than time-sorted?" Created batch-by-chat.ts, tested both approaches — identical score (17.0/56). Chat-based kept as default for correctness (conversations stay intact).

**Few-shot prompting:** Created src/extract/few-shot.ts with --few-shot flag. User provided reference prompt with edge cases — created PROMPT_IMPROVEMENTS.md with 5 improvements: Indian household context, circle indicators table, explicit NEVER rules, loop examples, wrong vs right format examples.

**Score:** Dev 16.7/56, Example 63.5/74

---

## Nov 11 — CoT + Delphi Analysis

Added thinking block to prompt — tested 17.7/56 (worse). User: "how would we know why it did wrong — save thinking output." Added debug logging to save raw LLM response.

User: "run 3 subagents for analysis with Delphi method." Launched agents A (Codebase), B (Research), C (Data) in parallel. Findings: schema key mismatches, need to track all loops, compress prompt.

Tried compressed prompt + org_id fix — chats improved but overall score worse. User: "why same metrics but lower score?" Explained hidden sub-scoring (Goals category dropped when goals=0).

User consulted ChatGPT and Claude directly on prompt design:
- ChatGPT: recommended decomposition, deterministic code, verification passes
- Claude: similar — strong consensus on decomposition and deterministic processing
Compiled both responses → stored in docs/ERROR_ANALYSIS_AND_SOLUTIONS.md

Tried parallel extraction approach (6 parallel LLM calls) — 12.8/56, worse than 23.2 baseline. User: "Don't redesign — revert to CoT baseline, add only safe changes." Reverted.

---

## Nov 12 — Prompt Tuning + Submission

Enabled thinking mode (CoT). ERNIE truncated output with thinking enabled — fixed extractThinking() to handle `<analysis>` tags too. With fixed thinking: Circles 71%, Chats 91%.

Analyzed thinking output to identify failure patterns:
- Circles: colleague↔staff confusion, relative↔friend at edges
- Chats: 1:1 chats with colleagues being assigned to org instead of person (WRONG rule)
- Orgs: creating too many (22 vs 7 expected) — industry communities should fold into main company
- Loops: wrong source_msg selection, finding different messages than answer key

Re-read problem spec carefully — found missing rules:
- "A group can belong to a person: a child's class parents' group belongs to the child"
- "The office cleaner is staff" (not just home help)
- Source msg: both first valid AND concrete are accepted, not just concrete
- Help actions: exact FAQ rules (staff/vendor already handling → leave; overdue → remind)

User caught that "1:1 → org for colleagues" rule was wrong from the start. Manual inspection confirmed 8/11 chat errors came from this one bad rule. Removed it.

Fixed horizon normalization (model outputting "1 year" instead of "1yr") in preprocessing.

**Score progression this session:** 17.5 (baseline) → 19.3 → 18.3 (over-corrected) → 22.4/56

Decided on DeepSeek V4.1 Flash 1017 for submission: $0.035/$0.50 per 1M tokens (~0.25× baseline cost → ~10-12/12 cost points). Added batch preset, updated .env.example, removed leaked API keys from comments.

Squash-merged prompt-tuning branch into main. Final state: 22.4/56 dev, valid output, clean repo.

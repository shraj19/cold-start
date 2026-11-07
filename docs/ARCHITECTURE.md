# Cold Start Extraction Architecture (v0.2.0)

This document describes the working extraction model for the WhatsApp chat analysis challenge.

---

## High-Level Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         EXTRACTION PIPELINE                                     │
└─────────────────────────────────────────────────────────────────────────────────┘

     INPUT                      PROCESS                         OUTPUT
┌─────────────┐           ┌─────────────────┐            ┌─────────────────┐
│ messages.jsonl│          │                 │            │                 │
│ chats.jsonl  │ ────────► │  Sliding Window │ ────────► │  output.json    │
│ seed.json    │          │  Batch Extract  │            │                 │
└─────────────┘           │  + Code Merge   │            │  - people       │
                          │                 │            │  - organisations│
                          └─────────────────┘            │  - chats        │
                                                         │  - goals        │
                                                         │  - open_loops   │
                                                         └─────────────────┘
```

---

## Batching Strategy

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    SLIDING WINDOW BATCHING                                      │
└─────────────────────────────────────────────────────────────────────────────────┘

Messages (sorted by timestamp):
│ 1 │ 2 │ 3 │ 4 │ 5 │ 6 │ 7 │ 8 │ 9 │10 │11 │12 │13 │14 │15 │16 │17 │18 │...

Window = 1000 messages, Overlap = 100, Step = 900

Batch 1: msgs    1 - 1000   ████████████████████████████████████████
Batch 2: msgs  901 - 1900                                    ████████████████████████████████████████
Batch 3: msgs 1801 - 2800                                                                    ████████████████████████████████████████
                                                             ↑
                                                        100 msg overlap
                                                     (context continuity)

For 30,000 messages → ~34 batches → ~34 API calls
```

---

## Per-Batch Extraction Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       SINGLE BATCH EXTRACTION                                   │
└─────────────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────────┐
                    │         SYSTEM PROMPT           │
                    │  (static, ~800 tokens)          │
                    │                                 │
                    │  - Scoring rules                │
                    │  - Analysis steps               │
                    │  - Output format + schema       │
                    │  - Help action definitions      │
                    └─────────────────────────────────┘
                                   +
                    ┌─────────────────────────────────┐
                    │          USER PROMPT            │
                    │  (dynamic, ~40K tokens)         │
                    │                                 │
                    │  - Seed data (known circles)    │
                    │  - Prior open loops (if any)    │
                    │  - Chats metadata               │
                    │  - Messages (1000 max)          │
                    └─────────────────────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────────┐
                    │            LLM                  │
                    │    (DeepSeek / GPT-4 / Claude)  │
                    └─────────────────────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────────┐
                    │          RESPONSE               │
                    │                                 │
                    │  <thinking>                     │
                    │    step-by-step reasoning...    │
                    │  </thinking>                    │
                    │                                 │
                    │  { JSON output }                │
                    └─────────────────────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────────┐
                    │       PREPROCESSING             │
                    │                                 │
                    │  Fix invalid enums:             │
                    │  - leisure → experiences        │
                    │  - vendor → company             │
                    │  - member → supports            │
                    └─────────────────────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────────┐
                    │        BatchOutput              │
                    │                                 │
                    │  - circles[]                    │
                    │  - person_links[]               │
                    │  - orgs[]                       │
                    │  - chats[]                      │
                    │  - goals[]                      │
                    │  - loops[]                      │
                    └─────────────────────────────────┘
```

---

## Cross-Batch Context Passing

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    PRIOR LOOPS CONTEXT PASSING                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

   Batch 1                      Batch 2                      Batch 3
  ┌─────────┐                  ┌─────────┐                  ┌─────────┐
  │ msgs    │                  │ msgs    │                  │ msgs    │
  │ 1-1000  │                  │ 901-1900│                  │ 1801-2800│
  └────┬────┘                  └────┬────┘                  └────┬────┘
       │                            │                            │
       ▼                            ▼                            ▼
  ┌─────────┐                  ┌─────────┐                  ┌─────────┐
  │   LLM   │                  │   LLM   │                  │   LLM   │
  └────┬────┘                  └────┬────┘                  └────┬────┘
       │                            ▲                            ▲
       │     priorLoops[]           │     priorLoops[]           │
       │  ┌──────────────────┐      │  ┌──────────────────┐      │
       └─►│ M001: "Book..."  │──────┘  │ M001: "Book..."  │──────┘
          │ M016: "Decide..."|         │ M016: "Decide..."|
          └──────────────────┘         │ M027: "Send..."  │
                                       └──────────────────┘
                                       (accumulates open loops)

WHY: Later batch might see closing message for a loop whose source_msg
     it doesn't have. Passing prior loops lets it recognize the closure.

TOKEN COST: ~15 tokens per open loop
WORST CASE: 150 loops × 15 = 2250 tokens (~5% of batch)
```

---

## Code-Based Merge

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      CODE-BASED MERGE (merge.ts)                                │
│                          No LLM tokens spent                                    │
└─────────────────────────────────────────────────────────────────────────────────┘

   BatchOutput 1        BatchOutput 2        BatchOutput 3
        │                    │                    │
        └────────────────────┼────────────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │      mergeBatches()          │
              └──────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
┌───────────────┐  ┌─────────────────┐  ┌───────────────┐
│ mergeCircles  │  │   mergeOrgs     │  │  mergeChats   │
│               │  │                 │  │               │
│ Dedupe by     │  │ Dedupe by       │  │ Dedupe by     │
│ person_id     │  │ normalized name │  │ chat_id       │
│               │  │                 │  │               │
│ Seed overrides│  │ Highest conf    │  │ Highest conf  │
│ Highest conf  │  │ wins            │  │ wins          │
└───────────────┘  └─────────────────┘  └───────────────┘

        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    │
┌───────────────┐  ┌─────────────────────────────┐│
│  mergeGoals   │  │      mergeLoops             ││
│               │  │                             ││
│ Group by      │  │ Dedupe by source_msg        ││
│ area + title  │  │                             ││
│ similarity    │  │ STATUS PRIORITY:            ││
│               │  │ ┌─────────────────────────┐ ││
│ Combine       │  │ │ done > dropped > open   │ ││
│ evidence      │  │ │                         │ ││
│               │  │ │ (terminal states win -  │ ││
│ Max 10 goals  │  │ │  that batch saw closing │ ││
└───────────────┘  │ │  message)               │ ││
                   │ └─────────────────────────┘ ││
                   │                             ││
                   │ Strip "help" if not open    ││
                   └─────────────────────────────┘│
                             │                    │
                             ▼                    │
              ┌──────────────────────────────┐    │
              │        Final Output          │◄───┘
              │                              │
              │  people[], organisations[],  │
              │  chats[], goals[], loops[]   │
              └──────────────────────────────┘
```

---

## Open Loops Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         OPEN LOOPS EXTRACTION FLOW                              │
└─────────────────────────────────────────────────────────────────────────────────┘

                              INPUT (per batch)
                                    │
                    ┌───────────────┴───────────────┐
                    │  Messages + Chats + Seed      │
                    │  + Prior Open Loops (if any)  │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            LLM EXTRACTION                                       │
│                                                                                 │
│  For each loop found, LLM outputs:                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐    │
│  │ {                                                                      │    │
│  │   "title": "Book Coorg tickets",         ← descriptive title          │    │
│  │   "type": "commitment",                  ← commitment|followup|       │    │
│  │                                             deadline|question         │    │
│  │   "owner": "ME",                         ← ME or person_id            │    │
│  │   "chat_id": "C01",                      ← where it originated        │    │
│  │   "source_msg": "M001",    ◄─────────── CRITICAL: first msg creating  │    │
│  │                                          obligation (used for dedup)  │    │
│  │   "due": "2026-10-27",                   ← extracted/inferred date    │    │
│  │   "status": "open|done|dropped",                                      │    │
│  │   "closed_by": "M005"|null,             ← msg that closed it          │    │
│  │   "help": {...}|null,                   ← only if open + ME-owned     │    │
│  │   "confidence": 0.9                     ← used for merge priority     │    │
│  │ }                                                                      │    │
│  └────────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         HELP OBJECT (for open ME-owned loops)                   │
│                                                                                 │
│  ┌────────────────────────────────────────────────────────────────────────┐    │
│  │ "help": {                                                              │    │
│  │   "action": "assist|remind|leave",                                     │    │
│  │              │       │      │                                          │    │
│  │              │       │      └─► Someone else owns, don't intervene     │    │
│  │              │       └────────► ME must do it, just needs nudge        │    │
│  │              └────────────────► ME can do prep work (research, draft)  │    │
│  │                                                                        │    │
│  │   "next_step": "Research homestay options",  ← concrete action        │    │
│  │   "remind_at": "2026-10-25",                 ← when to surface        │    │
│  │   "reason": "Can research before deciding"   ← why this action        │    │
│  │ }                                                                      │    │
│  └────────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Token Budget Per Batch

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         TOKEN BUDGET (per API call)                             │
└─────────────────────────────────────────────────────────────────────────────────┘

INPUT TOKENS (~42,000 total)
├── System Prompt (fixed)                          ~800 tokens
├── User Prompt
│   ├── Seed data                                  ~100 tokens
│   ├── Prior open loops (0-150 loops)             ~0-2,250 tokens
│   ├── Chats metadata                             ~200 tokens
│   └── Messages (1000 msgs × 40 tokens)           ~40,000 tokens
│
OUTPUT TOKENS (~2,000)
├── <thinking> reasoning                           ~1,000 tokens
└── JSON output                                    ~1,000 tokens


MODEL CONTEXT LIMITS:
┌─────────────┬───────────┬──────────────┬─────────┐
│ Model       │ Limit     │ Per Batch    │ Status  │
├─────────────┼───────────┼──────────────┼─────────┤
│ DeepSeek    │ 64K       │ ~42K         │ ✅ OK   │
│ GPT-4o      │ 128K      │ ~42K         │ ✅ OK   │
│ Claude      │ 200K      │ ~42K         │ ✅ OK   │
└─────────────┴───────────┴──────────────┴─────────┘


COST ESTIMATE (30,000 messages → 34 batches):
┌─────────────┬───────────────┬──────────────┬─────────────┐
│ Model       │ Input Cost    │ Output Cost  │ Total       │
├─────────────┼───────────────┼──────────────┼─────────────┤
│ DeepSeek    │ $0.14/1M      │ $0.28/1M     │ ~$0.25      │
│ GPT-4o      │ $2.50/1M      │ $10.00/1M    │ ~$4.50      │
│ Claude      │ $3.00/1M      │ $15.00/1M    │ ~$5.50      │
└─────────────┴───────────────┴──────────────┴─────────────┘
```

---

## Eval Scores (v0.2.0)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CURRENT SCORES (example dataset)                        │
└─────────────────────────────────────────────────────────────────────────────────┘

                    Single Batch              Multi-Batch (3)
                    (29 msgs)                 (15 msgs each)
                    ─────────────────────────────────────────
Circles             100%                      100%
Chats               100%                      100%
Loops Found         80% F1                    81-86% F1
Loops Status        100%                      100%  ← fixed with merge
Help Actions        100%                      80-100%


KEY IMPROVEMENTS IN v0.2.0:
─────────────────────────────
✅ Loops Status: 70% → 100%  (merge prefers terminal states)
✅ Help Actions: 60% → 100%  (scoring rules in prompt)
✅ Batch failures: fixed     (preprocessing invalid enums)
```

---

## File Structure

```
src/extract/
├── index.ts          # Main pipeline orchestrator
├── batch.ts          # Sliding window batching (window=1000, overlap=100)
├── extract-cot.ts    # LLM extraction with Chain of Thought
│   ├── SYSTEM_PROMPT # Scoring rules, schema, help definitions
│   ├── buildUserPrompt() # Seed + prior loops + chats + messages
│   └── preprocessData()  # Fix invalid enums before validation
├── merge.ts          # Code-based merge (no LLM)
│   ├── mergeCirclesAndLinks()
│   ├── mergeOrgs()
│   ├── mergeChats()
│   ├── mergeGoals()
│   └── mergeLoops()  # Terminal states > open
└── types.ts          # BatchOutput schema (Zod)

evals/
├── cold-start.eval.ts  # Evalite scorers
└── run-verbose.ts      # Detailed eval output
```

---

## Version History

| Tag | Description |
|-----|-------------|
| v0.2.0 | Multi-batch extraction with code-based merge, prior loops passing |
| v2-deepseek-batched | Initial batched extraction |
| v1.0-example-74 | Single-call extraction, 74/74 on example |

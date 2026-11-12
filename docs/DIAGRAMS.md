# Architecture Diagrams

## Full Extraction Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FULL EXTRACTION PIPELINE                             │
└─────────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────┐
                    │   Input Files    │
                    │  messages.jsonl  │
                    │   chats.jsonl    │
                    │    seed.json     │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   io/read.ts     │
                    │  Parse JSONL     │
                    └────────┬─────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │     Chat-Based Batching      │
              │    (batch-by-chat.ts)        │
              │                              │
              │  Group messages by chat_id   │
              │  Keep complete conversations │
              │  Never split a chat          │
              └──────────────┬───────────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
           ▼                 ▼                 ▼
    ┌────────────┐    ┌────────────┐    ┌────────────┐
    │  Batch 1   │    │  Batch 2   │    │  Batch N   │
    │ (chats+    │    │ (chats+    │    │ (chats+    │
    │  messages) │    │  messages) │    │  messages) │
    └─────┬──────┘    └─────┬──────┘    └─────┬──────┘
          │                 │                 │
          ▼                 ▼                 ▼
    ┌────────────┐    ┌────────────┐    ┌────────────┐
    │ LLM Call   │    │ LLM Call   │    │ LLM Call   │
    │extract-cot │    │extract-cot │    │extract-cot │
    │            │    │            │    │            │
    │ + prior    │◄───│ + prior    │◄───│            │
    │   loops    │    │   loops    │    │            │
    └─────┬──────┘    └─────┬──────┘    └─────┬──────┘
          │                 │                 │
          ▼                 ▼                 ▼
    ┌────────────┐    ┌────────────┐    ┌────────────┐
    │BatchOutput │    │BatchOutput │    │BatchOutput │
    │ - circles  │    │ - circles  │    │ - circles  │
    │ - orgs     │    │ - orgs     │    │ - orgs     │
    │ - chats    │    │ - chats    │    │ - chats    │
    │ - goals    │    │ - goals    │    │ - goals    │
    │ - loops    │    │ - loops    │    │ - loops    │
    └─────┬──────┘    └─────┬──────┘    └─────┬──────┘
          │                 │                 │
          └─────────────────┼─────────────────┘
                            │
                            ▼
              ┌──────────────────────────────┐
              │        MERGE (merge.ts)      │
              │                              │
              │  - Dedupe by ID/source_msg   │
              │  - Highest confidence wins   │
              │  - Seed overrides all        │
              │  - Terminal status wins      │
              └──────────────┬───────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │  POST-PROCESS (post-process) │
              │                              │
              │  - Map org IDs (name → O5)   │
              │  - Validate loop source_msg  │
              │  - Normalize enums           │
              └──────────────┬───────────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   output.json    │
                    └──────────────────┘
```

---

## Goals Extraction Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           GOALS EXTRACTION PIPELINE                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Batch 1    │     │   Batch 2    │     │   Batch N    │
│  (messages)  │     │  (messages)  │     │  (messages)  │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       ▼                    ▼                    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  LLM Call    │     │  LLM Call    │     │  LLM Call    │
│  extract-cot │     │  extract-cot │     │  extract-cot │
│              │     │              │     │              │
│ "Extract     │     │ "Extract     │     │ "Extract     │
│  goals from  │     │  goals from  │     │  goals from  │
│  messages"   │     │  messages"   │     │  messages"   │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       ▼                    ▼                    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ BatchOutput  │     │ BatchOutput  │     │ BatchOutput  │
│  goals: [    │     │  goals: [    │     │  goals: [    │
│   {title,    │     │   {title,    │     │   {title,    │
│    area,     │     │    area,     │     │    area,     │
│    type,     │     │    type,     │     │    type,     │
│    horizon,  │     │    horizon,  │     │    horizon,  │
│    conf: 0.9 │     │    conf: 0.8 │     │    conf: 0.7 │
│    evidence: │     │    evidence: │     │    evidence: │
│    ["M001"]} │     │    ["M500"]} │     │    ["M900"]} │
│  ]           │     │  ]           │     │  ]           │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                            ▼
              ┌─────────────────────────────────────┐
              │         MERGE GOALS (merge.ts)      │
              │                                     │
              │  Step 1: Collect all goals          │
              │          from all batches           │
              │                                     │
              │          allGoals = [g1, g2, ...]   │
              └──────────────────┬──────────────────┘
                                 │
                                 ▼
              ┌─────────────────────────────────────┐
              │  Step 2: Group by similarity        │
              │                                     │
              │  IF same area AND title overlap>50% │
              │  THEN group together                │
              │                                     │
              │  groups = [                         │
              │    [g1, g4, g7],  ← same goal       │
              │    [g2],          ← unique          │
              │    [g3, g5],      ← same goal       │
              │  ]                                  │
              └──────────────────┬──────────────────┘
                                 │
                                 ▼
              ┌─────────────────────────────────────┐
              │  Step 3: Pick best from each group  │
              │                                     │
              │  FOR each group:                    │
              │    best = highest confidence        │
              │    evidence = combine all evidence  │
              │                                     │
              │  goals = [best1, best2, best3, ...] │
              └──────────────────┬──────────────────┘
                                 │
                                 ▼
              ┌─────────────────────────────────────┐
              │  Step 4: Sort by evidence count     │
              │                                     │
              │  More evidence = appeared in more   │
              │  batches = more confident           │
              │                                     │
              │  goals.sort((a,b) =>                │
              │    b.evidence.length -              │
              │    a.evidence.length)               │
              └──────────────────┬──────────────────┘
                                 │
                                 ▼
              ┌─────────────────────────────────────┐
              │  Step 5: CAP AT 10                  │
              │                                     │
              │  return goals.slice(0, 10)          │
              │                                     │
              │  ⚠️ Challenge rule: max 10 goals    │
              │  ⚠️ Invented goals cost points      │
              └──────────────────┬──────────────────┘
                                 │
                                 ▼
              ┌─────────────────────────────────────┐
              │           Final Output              │
              │                                     │
              │  goals: [                           │
              │    { title, area, type, horizon,    │
              │      evidence: ["M001", "M500"] },  │
              │    ...                              │
              │  ]  // max 10 items                 │
              └─────────────────────────────────────┘
```

---

## Loops Extraction Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LOOPS EXTRACTION PIPELINE                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Batch 1    │     │   Batch 2    │     │   Batch 3    │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       ▼                    │                    │
┌──────────────┐            │                    │
│  LLM Call    │            │                    │
│              │            │                    │
│ Found loops: │            │                    │
│ - Loop A     │────────────┼───► passed as      │
│   (open)     │            │    "prior loops"   │
│ - Loop B     │            │                    │
│   (open)     │            ▼                    │
└──────────────┘     ┌──────────────┐            │
                     │  LLM Call    │            │
                     │              │            │
                     │ Prior loops: │            │
                     │ - Loop A     │            │
                     │ - Loop B     │            │
                     │              │            │
                     │ Found:       │────────────┼───► passed forward
                     │ - Loop A     │            │
                     │   (DONE!) ◄──│── saw      │
                     │ - Loop C     │   closing  │
                     │   (open)     │   message  │
                     └──────────────┘            ▼
                                          ┌──────────────┐
                                          │  LLM Call    │
                                          │              │
                                          │ Prior loops: │
                                          │ - Loop B     │
                                          │ - Loop C     │
                                          │              │
                                          │ Found:       │
                                          │ - Loop B     │
                                          │   (open)     │
                                          │ - Loop D     │
                                          │   (open)     │
                                          └──────────────┘
                                                 │
                    ┌────────────────────────────┘
                    │
                    ▼
     ┌──────────────────────────────────────────┐
     │            MERGE LOOPS (merge.ts)        │
     │                                          │
     │  Dedupe by source_msg                    │
     │                                          │
     │  Status priority:                        │
     │  done/dropped > open                     │
     │  (terminal states win - that batch       │
     │   saw the closing message)               │
     └────────────────────┬─────────────────────┘
                          │
                          ▼
     ┌──────────────────────────────────────────┐
     │       POST-PROCESS (post-process.ts)     │
     │                                          │
     │  - Validate source_msg exists            │
     │  - Drop loops with invalid IDs           │
     └────────────────────┬─────────────────────┘
                          │
                          ▼
     ┌──────────────────────────────────────────┐
     │              Final Output                │
     │                                          │
     │  open_loops: [                           │
     │    { title, type, owner, chat_id,        │
     │      source_msg, status, help }          │
     │  ]                                       │
     └──────────────────────────────────────────┘
```

---

## Codebase Structure

```
src/
├── main.ts                 # CLI entry point
├── env.ts                  # Environment variables
│
├── extract/                # Extraction pipeline
│   ├── index.ts            # Orchestrator
│   ├── batch.ts            # Token-based batching
│   ├── batch-by-chat.ts    # Chat-based batching
│   ├── extract-cot.ts      # LLM extraction + prompts
│   ├── merge.ts            # Merge batch outputs
│   ├── post-process.ts     # Deterministic fixes
│   ├── few-shot.ts         # Few-shot examples
│   └── types.ts            # BatchOutput types
│
├── types/                  # Schema types
│   ├── enums.ts            # CIRCLES, ORG_TYPES, etc.
│   ├── input.ts            # Message, Chat, Seed
│   └── output/             # Person, Organisation, etc.
│
├── io/                     # File I/O
├── llm/                    # LLM client
└── validator/              # Scoring
```

# Incremental Processing Architecture for Cold Start

## Overview

This document outlines the transition from our current batch-processing multi-pass pipeline to an incremental, context-aware processing model inspired by Mem0, Graphiti, and Dolphin.

---

## Current vs Proposed Architecture

### Current (Batch)
```
┌─────────────────────────────────────────────────────────────────┐
│                    ALL CONVERSATIONS                             │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PASS 1: Per-chat extraction                   │
│     (138 LLM calls, no context between chats)                    │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PASS 2: Global synthesis                      │
│     (1 massive LLM call, often fails on large data)              │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OUTPUT: final JSON                            │
└─────────────────────────────────────────────────────────────────┘
```

### Proposed (Incremental)
```
┌────────────┐     ┌────────────┐     ┌────────────┐
│   Chat 1   │     │   Chat 2   │     │   Chat N   │
└─────┬──────┘     └─────┬──────┘     └─────┬──────┘
      │                  │                  │
      ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                CONTEXT-AWARE PROCESSING                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │               GLOBAL CONTEXT STORE                        │   │
│  │  people: [...], circles: [...], orgs: [...],             │   │
│  │  memberships: [...], goals: [...], open_loops: [...]     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           ↑                                      │
│            read existing  │  write updates                       │
│                           │                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              PER-CONVERSATION PROCESSOR                   │   │
│  │                                                           │   │
│  │  1. LLM extracts entities & relationships                │   │
│  │  2. Code resolves against existing context               │   │
│  │  3. LLM proposes ADD/UPDATE actions                      │   │
│  │  4. Code validates & applies changes                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                GLOBAL CONSOLIDATION (periodic)                   │
│  - Merge duplicate entities                                      │
│  - Resolve contradictions                                        │
│  - Update loop statuses                                          │
└─────────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OUTPUT: final JSON                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Global Context Store

A persistent, in-memory (or file-backed) store that accumulates extracted information across conversations.

```typescript
// src/incremental/context-store.ts

interface GlobalContextStore {
  // Entities
  people: Map<string, Person>;        // keyed by person_id
  organizations: Map<string, Org>;    // keyed by org_id
  
  // Relationships
  circles: Map<string, Circle>;       // person_id -> circle
  memberships: Map<string, Membership[]>;  // person_id -> org memberships
  
  // Trackables
  goals: Map<string, Goal>;
  open_loops: Map<string, OpenLoop>;
  
  // Evidence
  evidenceIndex: Map<string, string[]>;  // entity_id -> [msg_ids]
  
  // Temporal tracking
  lastUpdated: Map<string, Date>;     // entity_id -> last modified
}

interface ContextStore {
  // Read
  getPerson(id: string): Person | null;
  searchPeople(query: string, fuzzy?: boolean): Person[];
  getExistingPeopleForChat(chatParticipants: string[]): Person[];
  
  // Write (always with evidence)
  addPerson(person: Person, evidence: string[]): void;
  updatePerson(id: string, updates: Partial<Person>, evidence: string[]): void;
  
  // Conflict detection
  findSimilarPerson(name: string, signals: string[]): Person | null;
  
  // Persistence
  save(path: string): void;
  load(path: string): void;
}
```

### 2. Per-Conversation Processor

Processes one conversation at a time with access to existing context.

```typescript
// src/incremental/conversation-processor.ts

interface ConversationProcessorInput {
  chat: Chat;
  messages: Message[];
  existingContext: GlobalContextStore;
  seed: Seed;
}

interface ExtractionResult {
  // What the LLM extracted
  people: ExtractedPerson[];
  relationships: ExtractedRelationship[];
  loops: ExtractedLoop[];
  goals: ExtractedGoal[];
}

interface ProposedChanges {
  // What actions to take
  peopleToAdd: Person[];
  peopleToUpdate: { id: string; updates: Partial<Person>; evidence: string[] }[];
  
  loopsToAdd: OpenLoop[];
  loopsToUpdate: { id: string; updates: Partial<OpenLoop>; evidence: string[] }[];
  
  goalsToAdd: Goal[];
  // ... etc
}

async function processConversation(input: ConversationProcessorInput): Promise<ProposedChanges> {
  // Step 1: Gather relevant existing context for this chat
  const relevantContext = {
    existingPeople: input.existingContext.getExistingPeopleForChat(input.chat.participants),
    existingOrgs: input.existingContext.getAllOrgs(),
    existingGoals: input.existingContext.getAllGoals(),
    recentLoops: input.existingContext.getRecentLoops(30), // last 30 days
  };

  // Step 2: LLM extraction with context
  const extraction = await extractWithContext(input.chat, input.messages, relevantContext);

  // Step 3: Entity resolution (code-driven)
  const resolvedPeople = resolveEntities(extraction.people, relevantContext.existingPeople);
  
  // Step 4: LLM proposes actions
  const proposedChanges = await proposeChanges(extraction, resolvedPeople, relevantContext);

  // Step 5: Validation (code-driven)
  validateProposedChanges(proposedChanges);

  return proposedChanges;
}
```

### 3. Entity Resolution

Prevents duplicates using fuzzy matching + LLM confirmation.

```typescript
// src/incremental/entity-resolution.ts

interface ResolutionResult {
  action: "ADD" | "UPDATE" | "SKIP";
  existingId?: string;  // if UPDATE
  confidence: number;
}

function resolvePersonEntity(
  extracted: ExtractedPerson,
  existing: Person[]
): ResolutionResult {
  // Step 1: Exact match
  const exactMatch = existing.find(p => p.name.toLowerCase() === extracted.name.toLowerCase());
  if (exactMatch) {
    return { action: "UPDATE", existingId: exactMatch.id, confidence: 1.0 };
  }

  // Step 2: Fuzzy match (Levenshtein distance)
  const fuzzyMatches = existing
    .map(p => ({ person: p, distance: levenshtein(p.name, extracted.name) }))
    .filter(m => m.distance < 3)  // Max 2 character differences
    .sort((a, b) => a.distance - b.distance);

  if (fuzzyMatches.length > 0) {
    // Step 3: LLM confirmation for fuzzy matches
    const isSame = await llmConfirmSamePerson(extracted, fuzzyMatches[0].person);
    if (isSame) {
      return { action: "UPDATE", existingId: fuzzyMatches[0].person.id, confidence: 0.9 };
    }
  }

  // Step 4: No match found
  return { action: "ADD", confidence: 1.0 };
}
```

### 4. Extraction Prompt (Context-Aware)

```typescript
const CONTEXT_AWARE_EXTRACTION_PROMPT = `
You are extracting structured information from a WhatsApp conversation.

=== EXISTING CONTEXT ===
The following people are ALREADY KNOWN. If you see them in this chat, reference them by ID, don't create duplicates:

${existingPeople.map(p => `- ${p.id}: ${p.name} (${p.circle}) - ${p.notes || "no notes"}`).join("\n")}

=== EXISTING ORGANIZATIONS ===
${existingOrgs.map(o => `- ${o.id}: ${o.name} (${o.type})`).join("\n")}

=== EXISTING OPEN LOOPS ===
These are active tasks/commitments. Mark as DONE or DROPPED if this conversation resolves them:
${existingLoops.map(l => `- ${l.id}: "${l.title}" owned by ${l.owner}`).join("\n")}

=== THIS CONVERSATION ===
${formatConversation(chat, messages)}

=== YOUR TASK ===
Extract:
1. NEW PEOPLE - Only if they don't match anyone in EXISTING CONTEXT
2. UPDATES TO EXISTING PEOPLE - Reference by ID, describe what changed
3. RELATIONSHIP EVIDENCE - Signals about circle (spouse, colleague, etc.)
4. LOOP UPDATES - New loops, or status changes to existing loops
5. GOAL EVIDENCE - Any explicit goals or aspirations mentioned

For each extraction, include:
- source_msg_ids: [message IDs that support this]
- confidence: 0.0-1.0
`;
```

### 5. Global Consolidation

Runs periodically (or after all conversations) to clean up the context store.

```typescript
// src/incremental/consolidation.ts

async function consolidateContext(store: GlobalContextStore): Promise<void> {
  // 1. Merge duplicate people (different IDs, same person)
  const duplicatePairs = findDuplicatePeople(store.people);
  for (const [keep, remove] of duplicatePairs) {
    mergePeople(store, keep, remove);
  }

  // 2. Resolve contradictions
  const contradictions = findContradictions(store);
  for (const contradiction of contradictions) {
    const resolution = await llmResolveContradiction(contradiction);
    applyResolution(store, resolution);
  }

  // 3. Update loop statuses based on timeline
  updateLoopStatuses(store);

  // 4. Connect organizations to people
  inferOrganizationMemberships(store);
}

function findContradictions(store: GlobalContextStore): Contradiction[] {
  const contradictions: Contradiction[] = [];
  
  // Example: Person has two different circles from different chats
  for (const [personId, circles] of store.circleEvidence) {
    if (circles.length > 1 && new Set(circles.map(c => c.circle)).size > 1) {
      contradictions.push({
        type: "circle_conflict",
        personId,
        conflicting: circles,
      });
    }
  }
  
  return contradictions;
}
```

---

## File Structure

```
src/incremental/
├── context-store.ts       # Global context store implementation
├── conversation-processor.ts  # Per-conversation processing
├── entity-resolution.ts   # Fuzzy matching + LLM confirmation
├── extraction.ts          # Context-aware LLM extraction
├── consolidation.ts       # Post-processing cleanup
├── prompts.ts             # Extraction prompts
└── types.ts               # TypeScript interfaces

src/
├── main-incremental.ts    # Entry point for incremental mode
└── main-multipass.ts      # Keep existing batch mode
```

---

## CLI Interface

```bash
# Full incremental processing
npx tsx src/main-incremental.ts <input_dir> <output.json> [--state state.json]

# Process single conversation (for debugging)
npx tsx src/main-incremental.ts process-one <chat_id> <input_dir> <state.json>

# Run consolidation on existing state
npx tsx src/main-incremental.ts consolidate <state.json> <output.json>

# Convert state to final output
npx tsx src/main-incremental.ts export <state.json> <output.json>
```

---

## Migration Path

### Phase 1: State Persistence (Quick Win)
- Keep current multi-pass architecture
- Save Pass 1 results to `pass1-results.json`
- Save Pass 2 results to `pass2-results.json`
- Allow rerunning Pass 2/3 without re-running Pass 1 ✅ **(DONE)**

### Phase 2: Context-Aware Pass 1
- Modify Pass 1 to accept existing context
- Process chats in chronological order
- Pass previous extractions as context to next chat
- Accumulate results incrementally

### Phase 3: Entity Resolution
- Add fuzzy matching for people
- Add LLM confirmation for uncertain matches
- Deduplicate during extraction, not after

### Phase 4: Consolidation
- Add periodic consolidation step
- Handle contradictions with temporal awareness
- Support bi-temporal queries (optional)

---

## Key Differences from Our Plan

| Aspect | Our Original Plan | Industry Pattern |
|--------|------------------|------------------|
| **Processing Order** | All at once, then synthesize | One at a time, accumulate |
| **Context Window** | Entire dataset in Pass 2 | Relevant subset per chat |
| **Deduplication** | Post-hoc in Pass 2 | During extraction |
| **State** | Stateless | Persistent context store |
| **Contradictions** | Not handled | LLM resolution or invalidation |

---

## Expected Benefits

1. **Scalability** - Can process 30k+ messages without overwhelming LLM context
2. **Resumability** - Can stop/restart without losing progress
3. **Quality** - Better entity resolution with fuzzy matching
4. **Debugging** - Easier to trace issues to specific conversations
5. **Efficiency** - Only re-process changed conversations on updates

---

## Comparison to Original Plan

The plan from the other chat aligns well with industry patterns:

| Plan Element | Industry Equivalent | Status |
|--------------|---------------------|--------|
| "Process one conversation at a time" | Mem0/Graphiti incremental | ✅ Aligned |
| "LLM handles understanding, code handles orchestration" | All systems | ✅ Aligned |
| "Global context store" | Mem0 vector+graph, Graphiti Neo4j | ✅ Aligned |
| "Pass existing context to LLM" | Context-aware extraction | ✅ Aligned |
| "Code validates and applies changes" | Kernal's structured tools | ✅ Aligned |
| "Identify duplicate people/orgs" | Entity resolution everywhere | ✅ Aligned |
| "Never discard original messages" | Evidence provenance | ✅ Aligned |

The plan is well-aligned with industry best practices. The main implementation work is:
1. Building the Global Context Store
2. Adding entity resolution with fuzzy matching
3. Making extraction context-aware
4. Adding consolidation step

---

## Next Steps

1. **Immediate**: Test current multi-pass on dev data with fixed rate limiting
2. **Short-term**: Implement Phase 1 (separate passes) - **DONE**
3. **Medium-term**: Implement Phase 2 (context-aware Pass 1)
4. **Competition deadline**: Ensure batch mode works for submission
5. **Post-competition**: Full incremental architecture

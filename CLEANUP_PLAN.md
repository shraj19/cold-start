# Codebase Cleanup Plan for Submission

## Issues Found

### 1. Dead Code
- ✅ **src/extract/extract.ts** - Old structured output extraction (105 lines) - NEVER USED
- ✅ **src/llm/generate.ts** - `generate()` and `generateArray()` functions - NEVER USED (only `generatePlainText` is used)
- **evals/node_modules** - Orphaned node_modules with no package.json

### 2. Over-Modularization
**io/ folder** (113 total lines split into 6 files):
- `read.ts` (30 lines)
- `write.ts` (7 lines)  
- `types.ts` (22 lines)
- `example.ts` (28 lines)
- `store.ts` (8 lines)
- `index.ts` (18 lines)

**Problem**: Too granular for such simple code. A single `io.ts` file would be clearer.

### 3. Missing Opportunities for Classes

#### A. DataStore (already a class - GOOD)
```typescript
// src/store/data-store.ts - 94 lines
class DataStore {
  constructor(input: StoreInput)
  getChat(chatId: string)
  getMessage(msgId: string)
  searchMessages(query)
  // etc
}
```
This is well-structured ✅

#### B. Batch Creation - Could Benefit from Class
```typescript
// src/extract/batch.ts - 183 lines
// Currently: loose functions
function getBatchOptions(model: string): BatchOptions
function estimateMessageTokens(msg: Message): number
function createBatches(messages: Message[], chats: Chat[]): Batch[]

// Better: BatchBuilder class
class BatchBuilder {
  constructor(private options: BatchOptions) {}
  
  estimateTokens(msg: Message): number { }
  createBatches(messages: Message[], chats: Chat[]): Batch[] { }
}

// Usage:
const builder = BatchBuilder.fromModel(modelName);
const batches = builder.createBatches(messages, chats);
```

**BUT**: For submission, this refactor is RISKY. Current code works. Don't break it.

#### C. Validator - Already Well-Structured
```typescript
// src/validator/ - multiple files totaling ~700 lines
// Has clear separation:
// - score.ts: scoring logic
// - validate.ts: validation rules
// - index.ts: check function
// - main.ts: CLI entry
```
This is fine ✅

#### D. Merger - Could Use Class But Functional Works
```typescript
// src/extract/merge.ts - 310 lines
// Currently: separate functions for each entity type
function mergeCircles()
function mergeOrgs()
function mergeChats()
function mergeGoals()
function mergeLoops()
function mergeBatches() // orchestrator

// Could be:
class BatchMerger {
  constructor(private seed: Seed) {}
  
  mergeCircles(batches: BatchOutput[]): Person[]
  mergeOrgs(batches: BatchOutput[]): Organisation[]
  merge(batches: BatchOutput[]): MergedOutput
}
```

**BUT**: Current functional approach is clear. No compelling reason to change.

### 4. Unnecessary Dependencies
- ✅ **@ai-sdk/google** - Removed (we only use OpenAI-compatible API now)

---

## Recommended Actions (Priority Order)

### HIGH PRIORITY (Do Before Submission)

1. ✅ **Delete dead extraction code**
   ```bash
   rm src/extract/extract.ts
   ```
   - 105 lines of unused structured output code
   - Confuses readers

2. ✅ **Simplify llm/generate.ts**
   - Remove `generate()` and `generateArray()` functions
   - Keep only `generatePlainText()` (the one we actually use)
   - Saves ~60 lines

3. **Merge io/ folder into single file**
   ```bash
   # Consolidate into src/io.ts (113 lines total)
   rm -rf src/io/
   ```
   - Reduces mental overhead
   - Still well-organized (example, read, write sections)

4. **Delete orphaned evals/node_modules**
   ```bash
   rm -rf evals/node_modules
   ```

5. **Remove unused exports**
   - `src/extract/index.ts` exports `extractBatch` (old method) - remove
   - Check for other unused exports

### MEDIUM PRIORITY (Nice to Have)

6. **Add comments to complex functions**
   - `preprocessData()` - why each mapping exists
   - `safeParseArray()` - explain partial validation
   - `createBatches()` - explain overlap logic

7. **Consolidate type files**
   - `src/types/output/` has 6 tiny files (18-41 lines each)
   - Could be one `src/types/output.ts` (159 lines total)
   - **BUT**: Current structure is navigable, not broken

### LOW PRIORITY (Skip for Submission)

8. **Class refactors** - Too risky, current code works
9. **Renaming** - Unnecessary churn
10. **Advanced TypeScript** - Overengineering

---

## Why NOT Use Classes Everywhere?

### When Functional Is Better
1. **Stateless transformations** (our merge functions)
   - Input → Output, no state to manage
   - Pure functions are easier to test
   - No lifecycle to think about

2. **Simple utilities** (token estimation)
   - One-off calculations
   - No shared state
   - Class would add boilerplate

3. **Pipeline steps** (extraction, validation)
   - Linear flow: read → extract → merge → validate
   - Classes would obscure the flow
   - Composition > Inheritance here

### When Classes Shine
1. **Stateful objects** (DataStore)
   - Manages maps of chats/messages
   - Methods operate on internal state
   - Clear lifecycle (construct once, query many)

2. **Strategy pattern** (if we had multiple extractors)
   - Interface: `Extractor.extract()`
   - Implementations: `CoTExtractor`, `FewShotExtractor`
   - **BUT**: We only have one strategy, so no need

3. **Complex builders** (if batch creation had 10+ options)
   - Fluent API: `builder.withOverlap(10%).withMaxTokens(100K).build()`
   - **BUT**: We have 3 simple presets, overkill

---

## Our Codebase Philosophy

**Current approach**: Mostly functional with DataStore as the only class

**Why it works**:
- Pipeline is linear: input → batches → extract → merge → output
- Most steps are pure transformations
- DataStore is the only stateful component
- Clear flow, easy to trace

**What we avoid**:
- Class hierarchies (no need for polymorphism)
- Over-abstraction (no generic `Processor<T>` interfaces)
- Premature optimization (YAGNI)

---

## Files to Delete

```
src/extract/extract.ts          # 105 lines - old structured output
evals/node_modules/              # Orphaned dependencies
```

## Files to Simplify

```
src/llm/generate.ts              # Remove generate() and generateArray()
src/io/*                         # Merge into single src/io.ts
```

## Files to Keep As-Is

```
src/store/data-store.ts          # Class is appropriate here ✅
src/extract/batch.ts             # Functional is fine
src/extract/merge.ts             # Functional is fine
src/validator/                   # Well-organized
src/extract/extract-cot.ts       # Core logic, works well
```

---

## Estimated Impact

| Action | Lines Removed | Lines Added | Net Change |
|--------|---------------|-------------|------------|
| Delete extract.ts | -105 | 0 | -105 |
| Simplify generate.ts | -60 | 0 | -60 |
| Merge io/ folder | -113 | +113 | 0 (clearer) |
| Delete evals/node_modules | - | - | Cleaner repo |
| Remove unused exports | -10 | 0 | -10 |
| **TOTAL** | **-288** | **+113** | **-175 lines** |

**Result**: ~6% smaller codebase, significantly clearer structure.

---

## Implementation Order

1. Delete dead code (no risk)
2. Run tests (ensure nothing breaks)
3. Consolidate io/ folder (low risk)
4. Run tests again
5. Clean up exports
6. Final typecheck
7. Test on example dataset
8. Ready for submission

**Time estimate**: 15-20 minutes
**Risk**: Low (mostly deletions)

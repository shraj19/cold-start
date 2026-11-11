# Naming Audit & Issues

## File/Folder Names - Generally Good ✅

### Clear Names
- ✅ `src/extract/` - clear purpose
- ✅ `src/validator/` - clear purpose
- ✅ `src/llm/` - clear (LLM interaction)
- ✅ `src/store/` - clear (data storage/lookup)
- ✅ `src/types/` - clear

### Potential Issues
- `src/io/` - generic but acceptable (input/output operations)

---

## Function Names - Some Issues

### ❌ AMBIGUOUS NAMES

#### 1. `extract()` - Too Generic
```typescript
// src/extract/index.ts
export async function extract(
  chats: Chat[],
  messages: Message[],
  seed: Seed
): Promise<Output>
```

**Problem**: "extract" what? From what format?

**Better names**:
- `extractFromWhatsApp()` - if specific to WhatsApp
- `extractEntities()` - if generic entity extraction
- `runExtractionPipeline()` - emphasizes it's the full pipeline
- `analyzeChatHistory()` - domain-focused

**Current usage**: `extract()` is called from `main.ts` - it's the MAIN pipeline function

**Recommendation**: `runExtractionPipeline()` or keep `extract()` but add JSDoc


#### 2. `check()` - Vague
```typescript
// src/validator/index.ts
export function check(answer: Output, store: DataStore): CheckResult
```

**Problem**: Check what? Returns validation result.

**Better names**:
- `validateOutput()` 
- `checkAgainstExpected()`
- `verifyExtraction()`

**Recommendation**: `validateOutput()`


#### 3. `loadStore()` - Unclear What Type
```typescript
// src/io/store.ts
export function loadStore(input: Input): DataStore
```

**Problem**: "Load" from where? It's actually CREATING a store from input.

**Better names**:
- `createDataStore()` (already exists in src/store/index.ts!)
- `buildStoreFromInput()`

**ISSUE**: We have TWO functions that do the same thing!
- `src/io/store.ts`: `loadStore(input: Input): DataStore`
- `src/store/index.ts`: `createStore(input: StoreInput): DataStore`

**Recommendation**: Delete `io/store.ts`, use `createStore()` from `store/index.ts`


#### 4. `loadExample()` - Ambiguous
```typescript
// src/io/example.ts
export function loadExample(): ExampleData
```

**Problem**: Which example? From where?

**Better names**:
- `loadExampleDataset()`
- `loadTestExample()`
- `getExampleData()`

**Recommendation**: `loadExampleDataset()`


### ✅ CLEAR NAMES

- `extractBatchCot()` - clear: extract from batch using Chain of Thought
- `createBatches()` - clear
- `mergeBatches()` - clear
- `writeOutput()` - clear
- `readInput()` - clear
- `validateOutput()` - wait, this doesn't exist! Should rename `check()`

---

## Variable Names - Many Issues

### ❌ SINGLE LETTER / TOO SHORT

```typescript
// src/extract/merge.ts
function mergeCircles(batches: BatchOutput[], seed: Seed): Person[] {
  const m = new Map<string, CircleExtract>();  // ❌ 'm'? Map? Merged?
  const byPerson = new Map<string, CircleExtract[]>();  // ✅ Better
  
  for (const b of batches) {  // ❌ 'b'? batch!
    for (const c of b.circles) {  // ❌ 'c'? circle!
```

**Better**:
```typescript
  const bestCircleByPerson = new Map<string, CircleExtract>();
  
  for (const batch of batches) {
    for (const circle of batch.circles) {
```

### ❌ AMBIGUOUS ABBREVIATIONS

```typescript
// src/extract/batch.ts
function estimateMessageTokens(msg: Message): number {  // ❌ msg
  const date = new Date(msg.ts * 1000);  // ❌ ts (timestamp)
```

**Better**:
```typescript
function estimateMessageTokens(message: Message): number {
  const date = new Date(message.timestamp * 1000);
```

**BUT**: The Message type itself uses `ts` - this is from the input schema, can't change.


```typescript
// src/extract/extract-cot.ts
function formatChats(chats: Chat[]): string {
  return chats.map(c => {  // ❌ c
    const participants = c.participants.filter(p => p !== "ME");  // ❌ p
```

**Better**:
```typescript
  return chats.map(chat => {
    const participants = chat.participants.filter(person => person !== "ME");
```

### ❌ TOO GENERIC

```typescript
// src/extract/extract-cot.ts
function parseResponse(text: string): { thinking: string; data: BatchOutput }
                                                            // ❌ 'data'
```

**Better**:
```typescript
function parseResponse(text: string): { thinking: string; extractedData: BatchOutput }
// or
function parseResponse(text: string): { thinking: string; batchOutput: BatchOutput }
```

```typescript
// src/extract/merge.ts
function mergeLoops(batches: BatchOutput[], seed: Seed): Loop[] {
  const m = new Map<string, LoopExtract>();  // ❌ 'm'
```

**Better**:
```typescript
  const loopsBySourceMessage = new Map<string, LoopExtract>();
```

### ❌ INCONSISTENT NAMING

```typescript
// Sometimes we use full words:
const bestCircleByPerson = new Map<...>();

// Sometimes abbreviations:
const m = new Map<...>();

// Sometimes prefixes:
const byPerson = new Map<...>();
```

**Recommendation**: Pick ONE pattern:
- `<entity>By<key>Map` - e.g., `circleByPersonMap`
- `<key>To<entity>Map` - e.g., `personToCircleMap`
- `best<Entity>By<key>` - e.g., `bestCircleByPerson`

---

## Type Names - Mostly Good

### ✅ CLEAR TYPES
- `BatchOutput` - clear
- `MergedOutput` - clear
- `CircleExtract` - clear (extracted circle data with confidence)
- `DataStore` - clear

### ⚠️ POTENTIAL CONFUSION

```typescript
// We have:
Output - final output type
BatchOutput - output from one batch

// Better naming?
FinalOutput vs BatchOutput
ExtractedOutput vs BatchExtraction
```

**Recommendation**: Keep as-is, but add JSDoc to clarify

---

## Abbreviations Used

### Context-Specific (OK in limited scope)
- `msg` → `message` (used in loops, OK)
- `cot` → Chain of Thought (in function name `extractBatchCot` - OK, established term)
- `ts` → timestamp (from input schema, can't change)
- `org` → organisation (consistent throughout, OK)

### Loop Variables (PROBLEMATIC)
- `c` for circle/chat
- `b` for batch
- `p` for person
- `l` for loop
- `g` for goal
- `m` for map

**These should be full words in non-trivial loops.**

---

## Recommended Changes

### HIGH PRIORITY (Confusing / Duplicate)

1. **Delete duplicate store creation**
   ```bash
   # DELETE: src/io/store.ts (duplicates src/store/index.ts)
   ```

2. **Rename ambiguous functions**
   ```typescript
   // src/validator/index.ts
   - export function check(...)
   + export function validateOutput(...)
   
   // src/io/example.ts
   - export function loadExample()
   + export function loadExampleDataset()
   ```

3. **Fix single-letter variables in merge.ts**
   ```typescript
   - const m = new Map<...>()
   + const bestByKey = new Map<...>()
   
   - for (const b of batches)
   + for (const batch of batches)
   
   - for (const c of b.circles)
   + for (const circle of batch.circles)
   ```

### MEDIUM PRIORITY (Clarity)

4. **Add JSDoc to ambiguous functions**
   ```typescript
   /**
    * Main extraction pipeline: batches messages, extracts entities with LLM,
    * merges results with confidence scoring.
    */
   export async function extract(...)
   ```

5. **Rename generic variables in parseResponse**
   ```typescript
   - return { thinking, data }
   + return { thinking, batchOutput }
   ```

6. **Expand loop variables in complex functions**
   - Only in non-trivial loops (>5 lines)
   - Keep short names in simple maps: `chats.map(c => c.id)` is fine

### LOW PRIORITY (Consistency)

7. **Standardize Map naming pattern**
   - Choose one: `entityByKeyMap` or `bestEntityByKey`
   - Apply consistently

8. **Consider renaming extract() to extractEntities()**
   - More descriptive
   - BUT: "extract" is domain-standard, might keep

---

## Files to Review for Naming

1. ✅ **src/extract/merge.ts** - MOST ISSUES (single letters everywhere)
2. **src/extract/extract-cot.ts** - some single letters in loops
3. **src/validator/index.ts** - `check()` is vague
4. **src/io/store.ts** - DELETE (duplicate)
5. **src/io/example.ts** - `loadExample()` could be clearer

---

## Summary

### Deletions
- `src/io/store.ts` - duplicate of `createStore` in src/store/

### Renames
- `check()` → `validateOutput()`
- `loadExample()` → `loadExampleDataset()`
- `data` variable → `batchOutput` or `extractedData`
- All single-letter variables in merge.ts → full words

### Improvements Needed
- Fix loop variables in merge.ts (highest impact)
- Add JSDoc to main pipeline functions
- Standardize Map variable naming

**Estimated impact**: Much clearer code, easier for evaluators to understand.

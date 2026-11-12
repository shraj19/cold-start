# Few-Shot Learning Results

## Implementation

Created optional few-shot learning support:
- `src/extract/few-shot.ts` - Builds few-shot examples from example dataset
- CLI flag: `--few-shot <example_dir>`
- Token overhead: ~810 tokens

## Test Results on Dev Dataset (4502 messages, 138 chats)

### Without Few-Shot (Baseline)
```
Part                         Score    Points
Circles                       0.76    9.1 / 12  ✅ Best
Organisations                 0.14    1.1 / 8
Chats                         0.79    6.3 / 8
Open loops found              0.25    3.5 / 14  ✅ Best
Open loops closed right       0.23    3.2 / 14  ✅ Best
Total from the data                  23.2 / 56  (41%)
```

**Characteristics:**
- More aggressive extraction (188 people, 10 orgs, 120 loops)
- Some hallucination (2 validation errors)
- Higher recall, acceptable precision

### With Few-Shot
```
Part                         Score    Points
Circles                       0.61    7.3 / 12  ⬇️ -1.8
Organisations                 0.12    1.0 / 8   ⬇️ -0.1
Chats                         0.82    6.5 / 8   ⬆️ +0.2
Open loops found              0.12    1.6 / 14  ⬇️ -1.9 ❌
Open loops closed right       0.07    0.9 / 14  ⬇️ -2.3 ❌
Total from the data                  17.4 / 56  (31%)
```

**Characteristics:**
- More conservative extraction (85 people, 5 orgs, 46 loops)
- Zero validation errors (no skipped items)
- Lower recall, higher precision (but worse overall)

## Comparison

| Metric | Without | With | Change |
|--------|---------|------|--------|
| **Total Score** | **23.2/56** | **17.4/56** | **-5.8 (-25%)** ❌ |
| Circles | 9.1 | 7.3 | -1.8 |
| Organisations | 1.1 | 1.0 | -0.1 |
| Chats | 6.3 | 6.5 | +0.2 ✅ |
| Loops Found | 3.5 | 1.6 | -1.9 ❌ |
| Loops Closed | 3.2 | 0.9 | -2.3 ❌ |

### Output Size

| Entity | Without | With | Change |
|--------|---------|------|--------|
| People | 188 | 85 | -55% |
| Organisations | 10 | 5 | -50% |
| Chats | 138 | 138 | 0% |
| Goals | 9 | 4 | -56% |
| Open Loops | 120 | 46 | -62% |

## Analysis

### Why Did Few-Shot Hurt Performance?

#### 1. **Made Model Too Conservative**
The example dataset (29 messages, 6 chats) has:
- 8 people
- 2 orgs
- 6 chats
- 2 goals
- 15 loops

ERNIE learned: "Don't extract too many entities"

But dev dataset (4502 messages, 138 chats) naturally has:
- ~100+ people
- ~5-10 orgs
- 138 chats
- ~5-10 goals
- ~50-100 loops

**Result**: Model underestimated everything based on small example.

#### 2. **Loop Detection Suffered Most**
- Without few-shot: 25% recall (3.5/14)
- With few-shot: 12% recall (1.6/14)

**Why**: Example showed only specific loop patterns. Model became too strict about what qualifies as a loop.

#### 3. **Chat Assignment Improved Slightly**
- Without few-shot: 79% (6.3/8)
- With few-shot: 82% (6.5/8)

**Why**: Example correctly showed 1:1 → person_id, group → org_id pattern. This is simple and transferable.

### When Would Few-Shot Help?

#### Scenario A: Different Domain
If dev dataset had dramatically different conversation style (e.g., formal business vs casual family), few-shot could help adapt.

**But**: Our example and dev are similar domains (WhatsApp personal/work chats)

#### Scenario B: Better Model
A higher-quality model (GPT-4, Claude, Gemini paid) could:
- Learn patterns without overgeneralizing
- Scale entity counts appropriately
- Extract nuanced loop detection rules

**But**: ERNIE free tier lacks this sophistication

#### Scenario C: Multiple Examples
Instead of 1 small example, use 3-5 diverse examples:
- Small chat (6 chats, 29 msgs)
- Medium chat (30 chats, 500 msgs)  
- Large chat (100+ chats, 3000+ msgs)

**But**: Token cost becomes prohibitive (~2-3K tokens per example)

## Conclusion

### For ERNIE Free Tier: **DON'T Use Few-Shot** ❌

**Reasons**:
1. Makes model too conservative (-25% score)
2. Hurts loop detection most (critical metric)
3. Adds 810 tokens overhead for negative value
4. Works better without examples (41% vs 31%)

### For Better Models: **Few-Shot MAY Help** ⚠️

Would need testing with:
- `google/gemini-3.1-flash-lite`
- `anthropic/claude-3.5-sonnet`
- `openai/gpt-4o`

Expected improvement with quality model + few-shot: 10-15%

### For Submission: **Use Without Few-Shot**

Best config:
```bash
npm start -- input_dir output.json
# No --few-shot flag
```

**Why**: 41% > 31% on dev dataset

---

## Implementation Quality ✅

Despite poor results, the implementation is:
- ✅ **Modular** - Separate few-shot.ts file
- ✅ **Optional** - CLI flag, doesn't affect default behavior
- ✅ **Well-integrated** - Passes through entire pipeline
- ✅ **Documented** - Token overhead calculated and logged
- ✅ **Testable** - Easy to compare with/without

**Value**: Good infrastructure even if not used now. Can be enabled later with better model.

---

## Recommendations

1. ✅ **Keep few-shot code** - Good feature for future
2. ✅ **Don't use by default** - Hurts ERNIE performance
3. 🔄 **Retest with paid model** - May help with Gemini/Claude
4. 📝 **Document in README** - Explain when to use it
5. 🎯 **Focus on better model** - Bigger impact than few-shot

**Bottom line**: Few-shot is well-implemented but doesn't help ERNIE. Need better model to leverage it.

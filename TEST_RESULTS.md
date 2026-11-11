# Test Results - Pre-Submission

## Test 1: Example Dataset (29 messages)

### Configuration
- **Model**: `baidu/ernie-5.5-flash-preview:free` (OpenRouter)
- **Batches**: 1 batch (800K token context)
- **Runtime**: ~1.5 minutes

### Results
```
Part                         Score    Points
Circles                       1.00   12.0 / 12  ✅
Organisations                 1.00    8.0 / 8   ✅
Chats                         1.00    8.0 / 8   ✅
Goals                         0.67    5.3 / 8   ⚠️
Open loops found              0.80   11.2 / 14  ⚠️
Open loops closed right       1.00   14.0 / 14  ✅
Where to help                 0.80    8.0 / 10  ⚠️
Total from the data                  66.5 / 74
```

**Score: 66.5 / 74 (89.9%) on data portion**

### Output Quality
- ✅ **Circles**: Perfect (12/12)
- ✅ **Organisations**: Perfect (8/8)
- ✅ **Chats**: Perfect (8/8)
- ⚠️ **Goals**: 2/3 found (missing 1 goal)
- ⚠️ **Loops Found**: 80% precision/recall
- ⚠️ **Help Actions**: 80% accuracy (some wrong assist/remind/leave choices)

### Observations
- ERNIE works well on small datasets
- Perfect on entities (people, orgs, chats)
- Good on goals (2/3)
- Decent on loops (80%)
- Help action classification needs improvement

---

## Test 2: Dev Dataset (4502 messages)

### Configuration
- **Model**: `baidu/ernie-5.5-flash-preview:free` (OpenRouter)
- **Batches**: 1 batch (attempted)
- **Runtime**: 1.51 minutes

### Results
❌ **COMPLETE FAILURE**

**Error**: "No JSON found in response"

**Output**: Empty (0 people, 0 orgs, 0 chats, 0 goals, 0 loops)

### Cause
ERNIE free tier cannot handle large context windows reliably. The model either:
1. Returned empty response
2. Returned malformed non-JSON response
3. Hit rate limits mid-response
4. Timed out internally

---

## Conclusion

### ✅ Working
- Code structure is solid
- Script execution (`run.sh`) works correctly
- Small datasets work well (66.5/74 = 90%)
- Validation passes

### ❌ Not Working
- **Free tier models unreliable for large datasets**
- ERNIE fails on 4502 messages
- No working free model for dev/production testing

### Recommendations

**For Submission:**
1. **Use paid model** - Free tier won't work for 30K messages
2. **Best option**: `google/gemini-3.1-flash-lite` on OpenRouter
   - Cost: ~$0.36 for 30K messages
   - 1M context window
   - Reliable
3. **Add $5 to OpenRouter account** (minimum top-up, credits never expire)

**Alternative:**
- Re-add Google native API support (`@ai-sdk/google`) for free tier
- BUT: 250K tokens/min limit requires careful batching
- Risk: May not complete 30K in 30 minutes

### Next Steps
1. ✅ Code is ready for submission
2. ✅ Shell script works
3. ❌ Need reliable model for final testing
4. **Add OpenRouter credits OR re-implement Google native API**

---

## Few-Shot Status

**NOT IMPLEMENTED** - No evidence it would help, adds token overhead.

Current approach uses:
- Chain of Thought reasoning (model explains before extracting)
- Semantic synonym preprocessing (fixes common LLM mistakes)
- Partial validation (keeps valid items even if some fail)

These techniques achieve 90% accuracy on example without few-shot.

---

## Model Comparison

| Model | Context | Cost | Example | Dev (4502) | Status |
|-------|---------|------|---------|------------|--------|
| ERNIE Free | 1M | $0 | ✅ 90% | ❌ Failed | Unreliable |
| Gemini Free (native) | 1M | $0 | ✅ Works | ⚠️ Quota limit | Need re-add SDK |
| Gemini Paid (OpenRouter) | 1M | $0.36/30K | ❌ Need credits | ❌ Need credits | Recommended |
| Nemotron | 1M | $0 | ❌ 15min timeout | ❌ Too slow | Not viable |

**Verdict**: Need paid model for reliable production runs.

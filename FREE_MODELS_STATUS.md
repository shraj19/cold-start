# Free Model Testing Status

## Current Findings

### ❌ ERNIE 5.5 Flash (baidu/ernie-5.5-flash-preview:free)
- **Status**: Provider returned error
- **Issue**: Backend throttling/overloaded
- **Context**: 1M context, response_format support
- **Verdict**: Unreliable for testing

### ❌ Gemini via OpenRouter (google/gemini-3.5-flash, google/gemini-3.8-flash)
- **Status**: "User not found" error
- **Issue**: Requires $5 minimum credit top-up
- **Verdict**: Not free anymore on OpenRouter

### ✅ Google Native API (gemini-3.5-flash)
- **Status**: WORKS
- **Cost**: Free (250K tokens/min limit)
- **Issue**: We removed Google native SDK support in cleanup
- **Verdict**: Need to add back for testing OR use paid model

### 🤔 Nemotron Super VL
- **Status**: 15+ minute timeout
- **Verdict**: Too slow

### 🤔 Inkling
- **Status**: Blocked ("agentic harnesses only")
- **Verdict**: Not available

## Conclusion

**For testing WITHOUT few-shot:**
1. **Option A**: Re-add Google native API support (requires @ai-sdk/google dependency)
2. **Option B**: Add $5 to OpenRouter and use `google/gemini-3.1-flash-lite` ($0.36 for 30K run)
3. **Option C**: Use a different paid model

**Recommendation**: Add $5 to OpenRouter for reliable testing. It's pay-as-you-go, credits never expire.

## Few-Shot Status

**NOT IMPLEMENTED** in current code. The `src/io/example.ts` exists but is never used in extraction pipeline.

To implement few-shot:
1. Load example with `loadExample()`
2. Add example input/output to system prompt or user prompt
3. Test with/without to measure impact

**Without evidence of improvement, few-shot adds ~3K tokens overhead per batch.**

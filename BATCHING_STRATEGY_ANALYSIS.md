# Batching Strategy Analysis

## Current Approach: Time-Sorted with Token-Aware Sliding Window

### How It Works
```typescript
// 1. Sort ALL messages by timestamp (across all chats)
messages.sort((a, b) => a.ts - b.ts);

// 2. Create sliding window batches with token limits
// Example with 3 batches:
// Batch 1: Messages 1-1000  (overlap: msgs 900-1000)
// Batch 2: Messages 900-1900 (overlap: msgs 1800-1900) 
// Batch 3: Messages 1800-4502

// 3. For each batch, include all chats that appear in those messages
```

### Pros ✅
1. **Temporal coherence** - Events unfold chronologically
2. **Loop closure detection** - If task created in batch 1, closed in batch 2, the overlap helps detect it
3. **Context continuity** - Overlapping messages help with cross-batch references
4. **Simpler for LLM** - Natural chronological flow

### Cons ❌
1. **Chat fragmentation** - A single chat conversation is split across multiple batches
2. **Context loss** - LLM sees partial conversations, loses full chat context
3. **Relationship inference harder** - Can't see full person behavior across entire chat history
4. **Duplicate entities** - Same person/org/chat extracted in multiple batches → merge complexity

---

## Alternative: Chat-Based Batching

### How It Would Work
```typescript
// 1. Group messages by chat_id
const messagesByChat = groupBy(messages, m => m.chat_id);

// 2. Create batches by packing complete chats
// Batch 1: Chats C01, C02, C03, C04 (total tokens < maxTokens)
// Batch 2: Chats C05, C06, C07, C08
// Batch 3: Chats C09, C10, ...

// 3. Each batch contains FULL conversation history for each chat
```

### Pros ✅
1. **Complete chat context** - LLM sees entire conversation for each chat
2. **Better circle detection** - Can observe full behavioral pattern (formal at work, casual with friends)
3. **Better loop detection** - All tasks/commitments in one chat visible together
4. **No entity duplication** - Each chat extracted once → simpler merge
5. **Chat assignment easier** - Full participant list and context available

### Cons ❌
1. **No temporal ordering** - Events not in chronological sequence
2. **Cross-chat loop closure hard** - If person says "I'll do X" in Chat A, then confirms "Done" in Chat B, we miss the closure
3. **Harder to track evolving relationships** - A person might be "colleague" in early messages, "friend" in later messages
4. **Uneven batch sizes** - One very long chat could dominate a batch, others are tiny

---

## Hybrid Approach: Time-Sorted Chats with Complete Messages

### How It Would Work
```typescript
// 1. For each chat, find its first message timestamp
const chatStartTimes = chats.map(chat => ({
  chat_id: chat.chat_id,
  first_msg: Math.min(...messagesByChat[chat.chat_id].map(m => m.ts))
}));

// 2. Sort chats by their start time
chatStartTimes.sort((a, b) => a.first_msg - b.first_msg);

// 3. Pack complete chats into batches chronologically
// Batch 1: Complete C01, Complete C02, Complete C03
// Batch 2: Complete C04, Complete C05, ...
```

### Pros ✅
1. **Rough temporal ordering** - Chats appear in order they started
2. **Complete chat context** - Full conversation history per chat
3. **Better relationship/loop detection** - Same as pure chat-based
4. **Simpler entity merging** - Less duplication

### Cons ❌
1. **Still misses cross-chat closures** - Same as pure chat-based
2. **Chat start time may not reflect content** - A chat started in Jan but most activity in Dec
3. **Long-running chats bias** - A chat spanning 6 months gets all messages in one batch

---

## Which is Better for Our Use Case?

### Current Scoring (Time-Sorted Sliding Window)
- ✅ **Example (29 msgs, 6 chats)**: 90% accuracy (66.5/74)
- ❌ **Dev (4502 msgs, 138 chats)**: 30% accuracy (16.7/56)

### Root Cause Analysis

**Why is dev so much worse?**

1. **Chat fragmentation is SEVERE**:
   - Dev has 138 chats, 4502 messages
   - Average ~33 msgs/chat
   - In time-sorted batches, each chat is split across multiple batches
   - LLM never sees complete conversation context

2. **Entity duplication causes merge errors**:
   - Same person appears in multiple batches with different circles
   - Merge logic picks highest confidence, but context was incomplete in each batch
   - Result: 66% circle accuracy (should be higher)

3. **Org extraction fails (6%)**: 
   - Orgs are inferred from group chats + staff/colleague mentions
   - In fragmented chats, LLM doesn't see full participant list or work context
   - Can't correctly identify "Brightside Design" if only sees 2 of 20 messages

4. **Loop detection fails (10%)**:
   - Task created in message 5, closed in message 25
   - If split across batches, closure not detected
   - Overlap helps but isn't sufficient for 138 chats

### Would Chat-Based Be Better?

**YES, likely significantly better for:**

1. **Circles** (66% → 85%+)
   - Full conversation reveals relationship clearly
   - "Hey buddy!" throughout 50 messages → friend
   - "Yes sir, I'll handle it" throughout → staff

2. **Organisations** (6% → 70%+)
   - Group chat with full participant list visible
   - Work discussions throughout chat → company
   - Home chats with family members → residence

3. **Chats** (80% → 95%+)
   - Full participant context
   - Clear group vs 1:1 distinction

4. **Loops** (?% → ?%)
   - **BETTER** for within-chat loops (most loops)
   - **WORSE** for cross-chat loops (rare but important)

### Trade-off: Cross-Chat Loop Closure

**Example**:
```
Chat A (Work): "I'll send you the invoice by Friday"
Chat B (Family): "Finally sent that work invoice today!"
```

- **Time-sorted**: Can detect this (both in chronological sequence)
- **Chat-based**: Misses this (Chat A and Chat B in different batches)

**How common is this?**
- From example dataset: Most loops are within-chat
- Cross-chat mentions are rare (~5-10% of loops)

**Mitigation**: 
- Accept 5-10% loss on cross-chat loops
- Gain 30-40% on all other metrics
- Net win

---

## Recommendation

### Switch to Chat-Based Batching

**Implementation**:
```typescript
// src/extract/batch.ts

export function createBatches(messages: Message[], chats: Chat[]): Batch[] {
  // Group messages by chat
  const messagesByChat = new Map<string, Message[]>();
  for (const msg of messages) {
    const list = messagesByChat.get(msg.chat_id) ?? [];
    list.push(msg);
    messagesByChat.set(msg.chat_id, list);
  }
  
  // Sort each chat's messages by time (keep chronological within chat)
  for (const [chatId, msgs] of messagesByChat) {
    msgs.sort((a, b) => a.ts - b.ts);
  }
  
  // Sort chats by first message timestamp
  const chatsWithTime = chats.map(chat => ({
    chat,
    firstMsg: Math.min(...(messagesByChat.get(chat.chat_id) ?? []).map(m => m.ts))
  }));
  chatsWithTime.sort((a, b) => a.firstMsg - b.firstMsg);
  
  const batches: Batch[] = [];
  let currentBatch: Batch = { messages: [], chats: [] };
  let currentTokens = 0;
  const options = getBatchOptions();
  
  for (const { chat } of chatsWithTime) {
    const chatMessages = messagesByChat.get(chat.chat_id) ?? [];
    const chatTokens = chatMessages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0)
                     + estimateChatTokens(chat);
    
    // If adding this chat exceeds limit, start new batch
    if (currentTokens + chatTokens > options.maxTokens && currentBatch.messages.length > 0) {
      batches.push(currentBatch);
      currentBatch = { messages: [], chats: [] };
      currentTokens = 0;
    }
    
    // Add chat to current batch
    currentBatch.messages.push(...chatMessages);
    currentBatch.chats.push(chat);
    currentTokens += chatTokens;
  }
  
  // Push final batch
  if (currentBatch.messages.length > 0) {
    batches.push(currentBatch);
  }
  
  return batches;
}
```

### Expected Impact

| Metric | Current (Time) | Expected (Chat) | Improvement |
|--------|----------------|-----------------|-------------|
| Circles | 66% | 85%+ | +20% |
| Orgs | 6% | 70%+ | +65% |
| Chats | 80% | 95%+ | +15% |
| Loops (within-chat) | 10% | 60%+ | +50% |
| Loops (cross-chat) | ? | -10% | -10% |
| **Total** | **30%** | **70%+** | **+40%** |

### Why This Is Better

1. **Context is king** - LLM performance scales with context quality
2. **Complete conversations** provide clear signals for relationships
3. **Entity extraction** is fundamentally a per-chat task:
   - "Who am I talking to?" (circle)
   - "What org is this group?" (organisation)
   - "What are we discussing?" (goals, loops)
4. **Merge becomes simpler** - Less duplication, higher confidence signals

### When to Use Time-Sorted

- **Very few chats** (< 10) with many messages each
- **Cross-chat loops are critical** (e.g., project management tracking)
- **Temporal causality matters** (e.g., news analysis, event detection)

For WhatsApp extraction with 100+ chats, **chat-based is superior**.

---

## Action Items

1. ✅ Commit current code
2. 🔄 Implement chat-based batching
3. 🧪 Test on dev dataset
4. 📊 Compare scores
5. 📝 Document results

If chat-based gives 70%+ on dev, ship it. If not, investigate hybrid approaches.

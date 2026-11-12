# Cold Start — Session Transcripts
# Tool: Kiro (Claude-based agent) + Claude/ChatGPT consultation

---

## Session 1 — Problem Understanding & Research (Nov 4)

user: read the problem statement. research what similar work exists on relationship extraction from chat data and cold start for personal assistants. i want to understand where this fits in the literature before we build anything

agent: Read the spec. Related work: relationship extraction from social networks, commitment detection from email corpora (CMU), personal knowledge graphs from messaging data. Key finding: relationship signals are strongest in 1:1 chat names and group membership, not individual message content. Standard NER fails on mixed Hindi/English/Hinglish. Cold start framing is closest to "user modeling from implicit signals."

user: the implicit context problem is the core difficulty here. "ok sir" means nothing without the surrounding exchange. so single-message classification is out — we need full conversation context. what does that mean for token limits

agent: Full conversation context at 20K messages × 100 tokens = 2M tokens. Way beyond most models. So batching is unavoidable, but the batching strategy matters a lot — split by conversation, not by time. Split mid-conversation and you lose the signals that make relationship inference possible.

user: right. and the circle isn't about the person, it's about how ME relates to them. same person is colleague at work and friend at cricket. that rules out entity linking approaches entirely. lets start with naive baseline to establish a floor, then work up

agent: Building naive baseline — single giant prompt, all messages, seed data, schema. Gets us a score floor before any optimization.

---

## Session 2 — V1 Build & Schema Debugging (Nov 5)

user: score is 54.6 on example. loops are 0.63 and help is 0. looking at the output the model is picking the wrong source message — takes the vague setup message not the concrete request. and field names are wrong in the JSON output

agent: Source msg: model picks "M003: let's discuss this later" instead of "M007: please send invoice by Friday." Added rule: pick the message where the task is stated most concretely. Field names: prompt was showing organisation_id but schema uses organisation. Added exact JSON example showing field names.

user: LLMs lose attention in the middle of long prompts. put the extraction rules at the top and the output reminder at the bottom. data goes in the middle

agent: Restructured: EXTRACTION_RULES → DATA → OUTPUT_REMINDER. Loop and help action rules now at both ends.

user: i batched multiple chats per call and score dropped from 62 to 47. why

agent: When multiple conversations are processed together, the model's attention distributes across them. "ok sir done" in C03 loses meaning when the model is simultaneously processing C07 and C12. Per-chat extraction keeps focus on one relationship at a time. 15-point drop confirms — reverted.

---

## Session 3 — Scaling to Dev Dataset (Nov 5-6)

user: 4502 messages at 48 tokens each is only 214K tokens. most 1M context models can handle that in one call. why are we creating 16 batches

agent: Default batch was 45K tokens — conservative estimate. You're right, at 214K tokens we fit everything in one call. The 16-batch run with DeepSeek gave 7% circles, 35% chats, 9% loops — terrible, because cross-batch loop detection was broken.

user: parallel vs sequential batching — give me an honest answer

agent: Sequential is correct. Loop detection requires the batch that sees "Done ✓" to know about the open loop from an earlier batch. Parallel breaks this — each batch is independent. Sequential with prior loops passed forward is the right architecture.

user: tried structured output and got empty chats and goals. why

agent: Structured mode fails silently on any constraint violation — rejects the whole output rather than accepting partial results. Plain text with partial validation: each field parsed independently, bad entries skipped, rest kept. 85 seconds vs 292 seconds. Plain text is the right call.

user: would batching by full chats have been better than time-sorted messages

agent: Tested both. Scores identical at 17.0/56 for dev. Chat-based is architecturally cleaner for multi-batch scenarios — when hidden set needs 3 batches, full conversations stay together. Kept chat-based as default.

---

## Session 4 — Error Analysis (Nov 11)

user: launch 3 parallel subagents — Delphi method. one on codebase, one on research, one on data analysis. i want independent views before deciding next steps

agent: Launched. Agent A: schema key mismatches, org ID generation. Agent B: decomposition + verification passes. Agent C: 80% loop false positive rate, org Jaccard failing because we create too many sparse orgs.

user: stop agent A — going beyond scope

agent: Stopped. Findings compiled. Most actionable: org ID generation and schema keys.

user: compressed the prompt and same individual metrics improved but overall score dropped. what is happening

agent: Goals category: when goals array is empty, scorer computes 0/total_goals = 0 rather than skipping. A missing category costs more than a mediocre one. The compression was silently dropping goals.

user: i want external opinions on this. give me a brief prompt i can take to ChatGPT and Claude separately

agent: Provided brief problem + approach + specific questions on decomposition and org scoring.

user: (pasted ChatGPT response) decompose, deterministic code, verification passes. (pasted Claude response) same recommendations — strong consensus

agent: Both independently converge on decomposition and deterministic post-processing. Storing findings in docs/. This confirms the direction.

user: don't redesign. revert to CoT baseline, add only safe changes that don't risk breaking what works

agent: Reverted. Parallel extraction scored 12.8/56 — worse than baseline. CoT with targeted safe additions only.

---

## Session 5 — Prompt Tuning (Nov 12)

user: enable thinking mode. i want to see what the model is actually reasoning about before we tune prompts blind

agent: Enabled. ERNIE truncated — model using <analysis> tags not <thinking>. Fixed extractThinking(). With fix: Circles 71%, Chats 91%. Thinking shows model correctly identifies family and colleagues but creating 22 orgs vs 7 expected — industry communities becoming separate orgs.

user: i said earlier that 1:1 chats should always map to person not org. you checked the spec and said i was wrong. check the actual data

agent: Manual inspection: 8 of 11 chat errors come from the "1:1 with colleague → org" rule I added. Every 1:1 chat in the answers maps to a person — no exceptions. I disputed it based on one edge case. You were right. Rule removed.

user: re-read the problem spec fully. what rules are we actually missing vs what we assumed

agent: Found 4 missing rules: (1) "A group can belong to a person — a child's class parents' group belongs to the child." (2) "The office cleaner is staff" — we were restricting staff to home only. (3) Source msg: "we accept the first message that says what the task is, AND the concrete one" — we were saying concrete only. (4) Help action FAQ gives exact leave/remind/assist rules. All added.

user: "5-10 orgs" in the prompt — that number is not from the problem statement. where did it come from

agent: Inferred from dev data answers (7 orgs). That's overfitting — we can't hardcode that for the hidden set where the user might have more or fewer orgs. Changed to qualitative: "orgs should be few, most people have one home, one or two companies, maybe a second property."

user: score

agent: 22.4/56. Up from 19.3. Chats 7.3/8, Circles 9.1/12.

---

## Session 6 — Model Selection & Submission (Nov 12)

user: test all viable cheap models on example. i want to know which gives best quality per dollar, not just best quality

agent: ERNIE: 60.7/74 at $0.28/$1.13 per M. DeepSeek V4.1 Flash 1017: 60.6/74 at $0.035/$0.50 per M. GLM 5.3 Flash: 52.3/74, times out on dev. Claude Haiku 5.5 and GPT-6 Luna batch: fail — require OpenRouter async batch API, not standard chat completions. Non-starters.

user: deepseek is effectively the same quality but 8x cheaper on input. cost is scored separately so this directly translates to points

agent: At 0.24x baseline cost, DeepSeek gets ~11/12 cost points. ERNIE at 1.4x baseline gets ~4/12. 7 point difference just from model choice while maintaining identical quality score.

user: what about the grader's clean container — will it have node installed. npm install won't work without internet

agent: Correct — spec says "no internet except model endpoint." npm install fails. Pre-bundled dist/main.cjs with esbuild: 1.6MB single file, only needs node which every container has. run.sh uses bundle first, tsx fallback second.

user: run ernie 3 times on dev. i want to see how much variance there is — grader runs once so this matters

agent: Scores: 20.7, 23.1, 23.3. Chats dropped from 7.2 to 5.5 in run 1 — LLM non-determinism. 2.6pt range. DeepSeek scored 22.7 consistently on dev. Variance is another reason to prefer DeepSeek — more predictable behavior on the single grader run.

user: submit with deepseek

agent: Submitted. github.com/shraj19/cold-start. Model: deepseek/deepseek-v4.1-flash-1017. Dev: 22.7/56 vs baseline 17.5/56.

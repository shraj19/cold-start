# Submission Checklist

## Deadline: 12 Nov, 23:59 IST

---

## Required Files

- [ ] **run.sh** - Takes input folder and output path, runs with one command
- [ ] **WRITEUP.md** - At most 2 pages covering:
  - [ ] What you focused on and why
  - [ ] Your approach
  - [ ] What it costs and where the money goes
  - [ ] Where it's wrong: expected mistakes and roughly how often
- [ ] **ai-logs/** folder - Transcripts of AI sessions (Claude, Cursor, ChatGPT, etc.)
- [ ] **schema.json** - Output schema (already in starter kit)
- [ ] **.gitignore** - Must exclude the data folder

---

## Code Requirements

- [ ] Reads `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` from environment
- [ ] Outputs valid `output.json` matching schema
- [ ] Runs in clean container with no internet except model endpoint
- [ ] Completes within **30 minutes**
- [ ] Clean install + one command execution

---

## Output Schema (5 parts)

1. **People** - Each person with circle and org links
2. **Organisations** - Type, side, role + tie every chat to person OR org
3. **Goals** - Up to 10 goals with area, type, horizon, evidence messages
4. **Open loops** - Title, type, owner, chat_id, source_msg, due, status, closed_by
5. **Where to help** - For open loops: assist/remind/leave with details

---

## Scoring Breakdown (100 points)

| Part | Points | Our Status |
|------|--------|------------|
| Circles | 12 | 9.1/12 (76%) ✅ |
| Organisations | 8 | 1.1/8 (14%) ⚠️ |
| Chats | 8 | 6.3/8 (79%) ✅ |
| Goals | 8 | Not scored on dev |
| Open loops found | 14 | 3.5/14 (25%) ⚠️ |
| Open loops closed right | 14 | 3.2/14 (23%) ⚠️ |
| Where to help | 10 | Not scored on dev |
| Cost | 12 | Free model = $0 ✅ |
| Write-up | 7 | TODO |
| Runs with one command | 7 | ✅ |
| **Total** | **100** | **23.2/56 on dev** |

---

## Pre-Submit Verification

- [ ] Run `bash run.sh dev output.json` - completes without error
- [ ] Run validator: `npx tsx src/validator/main.ts dev output.json`
- [ ] Output is valid JSON matching schema
- [ ] No data files committed (check .gitignore)
- [ ] WRITEUP.md is complete and under 2 pages
- [ ] ai-logs/ folder has conversation transcripts
- [ ] GitHub repo is accessible (add `rmaslunia` as collaborator if private)

---

## Submission Form Fields

- [ ] Full name
- [ ] Email (same as registration)
- [ ] GitHub repo URL
- [ ] Commit hash (`git rev-parse HEAD`)
- [ ] Model ID (e.g., `baidu/ernie-5.5-flash-preview:free`)

---

## Key Notes from FAQ

1. **Cost scoring**: Free models priced at paid version rate. Cost score relative to baseline ($0.038/1k msgs)
2. **Voice transcripts**: ~50 in hidden set, treat same as text
3. **quoted_id**: Always null, don't depend on quotes
4. **Where to help**: Labelled on every open loop in hidden key
5. **Loop source_msg**: Pick the FIRST message that creates the obligation

---

## Current Best Output

- File: `dev-no-fewshot.json`
- Score: **23.2/56**
- Model: `baidu/ernie-5.5-flash-preview:free`

---

## TODO Before Submission

1. [ ] Verify run.sh works from clean state
2. [ ] Write WRITEUP.md
3. [ ] Organize ai-logs/ folder
4. [ ] Final test run on dev
5. [ ] Get commit hash
6. [ ] Submit form

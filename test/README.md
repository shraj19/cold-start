# Test Dataset

Curated subset of `dev/` for faster iteration and testing.

## Stats
- **20 chats** (from 138 in dev)
- **1,340 messages** (from 4,502 in dev)
- **~31K tokens** estimated (fits in single batch)
- **48 open loops** to evaluate
- **10 people**, **5 organisations**

## Selection Criteria
Chats selected for diversity:
- **Family**: C10 (spouse), C30/C41 (parents), C102 (sibling)
- **Work - Companies**: C09, C50, C11 (O1, O4, O5)
- **Work - Clients**: C34, C56, C95, C77 (O7 - Nexus clients)
- **Home**: C07, C06, C91 (O6 - residence)
- **Friends/Relatives**: C38, C119, C94, C26, C114, C82

## Ground Truth
`answers/answers.json` contains filtered ground truth from dev answers.

## Usage
```bash
# Run V1 (giant prompt) on test
pnpm start test

# Run V2 (batched) on test
pnpm v2 test
```

## Token Budget
- Single batch fits in ~100K prompt budget
- Can use as few-shot example for other datasets

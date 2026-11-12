// Apply post-processing to a saved output file

import { postProcess } from '../src/extract/post-process.js';
import { readFileSync, writeFileSync } from 'fs';

const inputFile = process.argv[2] || 'dev-no-fewshot.json';
const outputFile = process.argv[3] || 'dev-baseline-postprocessed.json';

// Load the output
const output = JSON.parse(readFileSync(inputFile, 'utf-8'));

// Load messages to get valid IDs (JSONL format)
const messagesRaw = readFileSync('dev/messages.jsonl', 'utf-8');
const messages = messagesRaw.trim().split('\n').map(line => JSON.parse(line));
const validMsgIds = new Set(messages.map((m: any) => m.id));

console.log('Valid msg IDs:', validMsgIds.size);
console.log('Loops before:', output.open_loops.length);
console.log('Orgs before:', output.organisations.map((o: any) => o.id));

const fixed = postProcess(output, validMsgIds);

console.log('Loops after:', fixed.open_loops.length);
console.log('Orgs after:', fixed.organisations.map((o: any) => o.id));

writeFileSync(outputFile, JSON.stringify(fixed, null, 2));
console.log(`Saved to ${outputFile}`);

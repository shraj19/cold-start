// Preprocessor: Convert raw WhatsApp data into LLM-friendly structured format.
// This reduces token count significantly while preserving semantic information.

import type { Chat, Message, Seed } from "./types.js";

// ----- Person Profile -----
export interface PersonProfile {
  id: string;
  names: string[]; // All names used for this person
  chatIds: string[]; // Chats they appear in
  messageCount: number;
  sentToMe: number; // Messages they sent to ME
  meReplied: number; // Messages ME sent to them
  topics: string[]; // Key topics discussed
  addressPatterns: string[]; // How they address ME or vice versa
  sampleMessages: string[]; // 3-5 representative messages
  isGroup: boolean; // Appears in groups?
  is1to1: boolean; // Has 1:1 chat?
}

// ----- Chat Summary -----
export interface ChatSummary {
  chatId: string;
  name: string;
  isGroup: boolean;
  participants: string[];
  messageCount: number;
  dateRange: { start: string; end: string };
  topSenders: { id: string; count: number }[];
  topics: string[]; // Key topics
  sampleThread: string[]; // 5-10 representative messages
}

// ----- Open Loop Candidate -----
export interface LoopCandidate {
  messageId: string;
  chatId: string;
  senderId: string;
  senderName: string;
  body: string;
  timestamp: string;
  signals: string[]; // Why this might be a loop (contains date, promise, question, etc.)
  context: string[]; // 2-3 messages before/after
}

// ----- Preprocessed Data -----
export interface PreprocessedData {
  // Compact person profiles
  personProfiles: PersonProfile[];
  
  // Chat summaries instead of raw chats
  chatSummaries: ChatSummary[];
  
  // Pre-filtered loop candidates (messages that might be loops)
  loopCandidates: LoopCandidate[];
  
  // Seed data (unchanged)
  seed: Seed;
  
  // Stats
  stats: {
    totalMessages: number;
    totalChats: number;
    totalPeople: number;
    dateRange: { start: string; end: string };
  };
}

// ----- Helper Functions -----

function extractTopics(messages: Message[]): string[] {
  const topicKeywords: Record<string, string[]> = {
    travel: ["trip", "flight", "hotel", "booking", "vacation", "holiday", "tickets"],
    work: ["client", "project", "deadline", "meeting", "invoice", "payment", "office"],
    home: ["cook", "driver", "maid", "grocery", "gas", "repair", "plumber"],
    family: ["kids", "school", "tuition", "birthday", "anniversary"],
    health: ["doctor", "hospital", "medicine", "gym", "run", "exercise"],
    finance: ["money", "transfer", "bank", "salary", "investment"],
    food: ["lunch", "dinner", "order", "restaurant", "khana"],
  };

  const topicCounts: Record<string, number> = {};
  const bodyText = messages.map((m) => m.body.toLowerCase()).join(" ");

  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    for (const kw of keywords) {
      if (bodyText.includes(kw)) {
        topicCounts[topic] = (topicCounts[topic] ?? 0) + 1;
      }
    }
  }

  return Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([topic]) => topic);
}

function extractAddressPatterns(messages: Message[], personId: string): string[] {
  const patterns: Set<string> = new Set();
  
  for (const m of messages) {
    const body = m.body.toLowerCase();
    
    // Check for common address patterns
    if (body.includes("sir") || body.includes("madam")) patterns.add("formal");
    if (body.includes("bhai") || body.includes("bhaiya")) patterns.add("bhai");
    if (body.includes("didi") || body.includes("di")) patterns.add("didi");
    if (body.includes("ji")) patterns.add("respectful_ji");
    if (/❤️|💕|😘/.test(m.body)) patterns.add("intimate_emoji");
    if (body.includes("boss") || body.includes("chief")) patterns.add("work_superior");
    if (body.includes("beta") || body.includes("baccha")) patterns.add("parental");
    if (body.includes("uncle") || body.includes("aunty")) patterns.add("elder_relative");
  }
  
  return [...patterns];
}

function isLoopSignal(body: string): string[] {
  const signals: string[] = [];
  const lower = body.toLowerCase();
  
  // Commitment signals
  if (/\b(will|i'll|i will|main|karunga|karenge|promise|pakka)\b/.test(lower)) {
    signals.push("commitment");
  }
  
  // Question/decision signals
  if (/\?|should|decide|kya kare|what do you think/.test(lower)) {
    signals.push("question");
  }
  
  // Deadline signals
  if (/\b(by|before|till|until|deadline|due|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|kal|parso)\b/.test(lower)) {
    signals.push("deadline");
  }
  
  // Follow-up signals
  if (/\b(waiting|pending|remind|follow.?up|update|status|kab|when)\b/.test(lower)) {
    signals.push("followup");
  }
  
  // Done signals
  if (/\b(done|ho gaya|kar diya|sent|booked|completed|finished)\b/.test(lower)) {
    signals.push("done");
  }
  
  return signals;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toISOString().split("T")[0]!;
}

function formatDateTime(ts: number): string {
  return new Date(ts * 1000).toISOString();
}

// ----- Main Preprocessor -----

export function preprocessData(
  chats: Chat[],
  messages: Message[],
  seed: Seed
): PreprocessedData {
  // Index messages by chat
  const messagesByChat = new Map<string, Message[]>();
  for (const m of messages) {
    const arr = messagesByChat.get(m.chat_id) ?? [];
    arr.push(m);
    messagesByChat.set(m.chat_id, arr);
  }
  
  // Sort messages by timestamp within each chat
  for (const arr of messagesByChat.values()) {
    arr.sort((a, b) => a.ts - b.ts);
  }
  
  // Index messages by person
  const messagesByPerson = new Map<string, Message[]>();
  for (const m of messages) {
    if (m.sender_id === "ME") continue;
    const arr = messagesByPerson.get(m.sender_id) ?? [];
    arr.push(m);
    messagesByPerson.set(m.sender_id, arr);
  }
  
  // Build person profiles
  const personProfiles: PersonProfile[] = [];
  const allPersonIds = new Set<string>();
  
  for (const chat of chats) {
    for (const p of chat.participants) {
      if (p !== "ME") allPersonIds.add(p);
    }
  }
  
  for (const personId of allPersonIds) {
    const personMessages = messagesByPerson.get(personId) ?? [];
    const names = [...new Set(personMessages.map((m) => m.sender_name))];
    
    // Find chats this person is in
    const chatIds = chats
      .filter((c) => c.participants.includes(personId))
      .map((c) => c.chat_id);
    
    // Get messages where ME replied to this person (in same chats)
    let meReplied = 0;
    for (const chatId of chatIds) {
      const chatMsgs = messagesByChat.get(chatId) ?? [];
      meReplied += chatMsgs.filter((m) => m.sender_id === "ME").length;
    }
    
    // Get all messages in chats with this person for topic/pattern analysis
    const relevantMessages: Message[] = [];
    for (const chatId of chatIds) {
      relevantMessages.push(...(messagesByChat.get(chatId) ?? []));
    }
    
    // Sample messages (most recent, non-trivial)
    const sampleMessages = personMessages
      .filter((m) => m.body.length > 10)
      .slice(-5)
      .map((m) => `${m.sender_name}: ${m.body.slice(0, 100)}`);
    
    personProfiles.push({
      id: personId,
      names,
      chatIds,
      messageCount: personMessages.length,
      sentToMe: personMessages.length,
      meReplied,
      topics: extractTopics(relevantMessages),
      addressPatterns: extractAddressPatterns(relevantMessages, personId),
      sampleMessages,
      isGroup: chatIds.some((cid) => chats.find((c) => c.chat_id === cid)?.is_group),
      is1to1: chatIds.some((cid) => !chats.find((c) => c.chat_id === cid)?.is_group),
    });
  }
  
  // Build chat summaries
  const chatSummaries: ChatSummary[] = [];
  
  for (const chat of chats) {
    const chatMessages = messagesByChat.get(chat.chat_id) ?? [];
    if (chatMessages.length === 0) continue;
    
    // Count messages per sender
    const senderCounts = new Map<string, number>();
    for (const m of chatMessages) {
      senderCounts.set(m.sender_id, (senderCounts.get(m.sender_id) ?? 0) + 1);
    }
    
    const topSenders = [...senderCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ id, count }));
    
    // Sample thread (last 10 messages, formatted compactly)
    const sampleThread = chatMessages.slice(-10).map(
      (m) => `[${m.id}] ${m.sender_name}: ${m.body.slice(0, 80)}${m.body.length > 80 ? "..." : ""}`
    );
    
    chatSummaries.push({
      chatId: chat.chat_id,
      name: chat.name,
      isGroup: chat.is_group,
      participants: chat.participants,
      messageCount: chatMessages.length,
      dateRange: {
        start: formatDate(chatMessages[0]!.ts),
        end: formatDate(chatMessages[chatMessages.length - 1]!.ts),
      },
      topSenders,
      topics: extractTopics(chatMessages),
      sampleThread,
    });
  }
  
  // Find loop candidates (messages that might be tasks/commitments)
  const loopCandidates: LoopCandidate[] = [];
  
  for (const chat of chats) {
    const chatMessages = messagesByChat.get(chat.chat_id) ?? [];
    
    for (let i = 0; i < chatMessages.length; i++) {
      const m = chatMessages[i]!;
      const signals = isLoopSignal(m.body);
      
      if (signals.length > 0) {
        // Get context (2 before, 2 after)
        const context: string[] = [];
        for (let j = Math.max(0, i - 2); j <= Math.min(chatMessages.length - 1, i + 2); j++) {
          if (j !== i) {
            const ctx = chatMessages[j]!;
            context.push(`[${ctx.id}] ${ctx.sender_name}: ${ctx.body.slice(0, 60)}`);
          }
        }
        
        loopCandidates.push({
          messageId: m.id,
          chatId: m.chat_id,
          senderId: m.sender_id,
          senderName: m.sender_name,
          body: m.body,
          timestamp: formatDateTime(m.ts),
          signals,
          context,
        });
      }
    }
  }
  
  // Calculate stats
  const allTimestamps = messages.map((m) => m.ts);
  const stats = {
    totalMessages: messages.length,
    totalChats: chats.length,
    totalPeople: allPersonIds.size,
    dateRange: {
      start: formatDate(Math.min(...allTimestamps)),
      end: formatDate(Math.max(...allTimestamps)),
    },
  };
  
  return {
    personProfiles,
    chatSummaries,
    loopCandidates,
    seed,
    stats,
  };
}

// ----- Format for LLM -----

export function formatForLLM(data: PreprocessedData): string {
  const lines: string[] = [];
  
  lines.push(`=== DATA OVERVIEW ===`);
  lines.push(`Period: ${data.stats.dateRange.start} to ${data.stats.dateRange.end}`);
  lines.push(`${data.stats.totalChats} chats, ${data.stats.totalMessages} messages, ${data.stats.totalPeople} people`);
  lines.push(``);
  
  lines.push(`=== SEED (user-provided hints) ===`);
  if (Object.keys(data.seed.circles).length > 0) {
    lines.push(`Known circles:`);
    for (const [id, circle] of Object.entries(data.seed.circles)) {
      lines.push(`  ${id}: ${circle}`);
    }
  }
  if (data.seed.organisations.length > 0) {
    lines.push(`Known organisations: ${data.seed.organisations.join(", ")}`);
  }
  if (data.seed.goals.length > 0) {
    lines.push(`Known goals:`);
    for (const g of data.seed.goals) {
      lines.push(`  ${g.title} (${g.area}, ${g.type})`);
    }
  }
  lines.push(``);
  
  lines.push(`=== PERSON PROFILES (${data.personProfiles.length} people) ===`);
  for (const p of data.personProfiles) {
    lines.push(`${p.id} "${p.names[0] ?? "?"}":`);
    lines.push(`  Chats: ${p.chatIds.join(", ")} | Messages: ${p.messageCount} sent, ${p.meReplied} from ME`);
    lines.push(`  Type: ${p.is1to1 ? "1:1" : ""}${p.is1to1 && p.isGroup ? " + " : ""}${p.isGroup ? "group" : ""}`);
    if (p.topics.length > 0) lines.push(`  Topics: ${p.topics.join(", ")}`);
    if (p.addressPatterns.length > 0) lines.push(`  Patterns: ${p.addressPatterns.join(", ")}`);
    if (p.sampleMessages.length > 0) {
      lines.push(`  Sample: "${p.sampleMessages[0]}"`);
    }
    lines.push(``);
  }
  
  lines.push(`=== CHAT SUMMARIES (${data.chatSummaries.length} chats) ===`);
  for (const c of data.chatSummaries) {
    lines.push(`${c.chatId} "${c.name}" (${c.isGroup ? "group" : "1:1"}):`);
    lines.push(`  Participants: ${c.participants.join(", ")}`);
    lines.push(`  Messages: ${c.messageCount} (${c.dateRange.start} to ${c.dateRange.end})`);
    if (c.topics.length > 0) lines.push(`  Topics: ${c.topics.join(", ")}`);
    lines.push(`  Recent:`);
    for (const msg of c.sampleThread.slice(-5)) {
      lines.push(`    ${msg}`);
    }
    lines.push(``);
  }
  
  lines.push(`=== LOOP CANDIDATES (${data.loopCandidates.length} potential tasks/commitments) ===`);
  for (const l of data.loopCandidates) {
    lines.push(`[${l.messageId}] ${l.chatId} | ${l.senderName} (${l.senderId}):`);
    lines.push(`  "${l.body}"`);
    lines.push(`  Signals: ${l.signals.join(", ")} | Time: ${l.timestamp}`);
    if (l.context.length > 0) {
      lines.push(`  Context: ${l.context[0]}`);
    }
    lines.push(``);
  }
  
  return lines.join("\n");
}

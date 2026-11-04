// Pass 3: Deep-dive investigation (tool-assisted)
// For low-confidence items, allows LLM to query raw messages

import { generateText, tool, Output } from "ai";
import { z } from "zod";
import { getModel, generate } from "../llm.js";
import { pass3OutputSchema, type Pass3Output, type InvestigationRequest } from "./schemas.js";
import type { Message, Chat } from "../types.js";

const SYSTEM_PROMPT = `You are investigating uncertain items from a WhatsApp analysis.

You have tools to query the raw messages:
- get_messages: Get all messages from a specific chat
- get_message_context: Get a message with surrounding context
- search_messages: Search for messages matching a pattern

For each investigation request, use the tools to gather evidence, then make a decision.

Output your refined decisions in the structured format.`;

interface DataStore {
  messagesByChat: Map<string, Message[]>;
  messagesById: Map<string, Message>;
  chatIdByMsgId: Map<string, string>;
}

function buildDataStore(
  chats: Chat[],
  messages: Message[]
): DataStore {
  const messagesByChat = new Map<string, Message[]>();
  const messagesById = new Map<string, Message>();
  const chatIdByMsgId = new Map<string, string>();
  
  for (const msg of messages) {
    // By chat
    const chatMsgs = messagesByChat.get(msg.chat_id) ?? [];
    chatMsgs.push(msg);
    messagesByChat.set(msg.chat_id, chatMsgs);
    
    // By ID
    messagesById.set(msg.id, msg);
    chatIdByMsgId.set(msg.id, msg.chat_id);
  }
  
  return { messagesByChat, messagesById, chatIdByMsgId };
}

function formatMessages(messages: Message[]): string {
  return messages
    .map(m => {
      const date = new Date(m.ts * 1000).toISOString().split("T")[0];
      const sender = m.sender_id === "ME" ? "ME" : `${m.sender_name} (${m.sender_id})`;
      return `[${m.id}] ${date} ${sender}: ${m.body}`;
    })
    .join("\n");
}

// Tool implementations
function getMessages(store: DataStore, chatId: string): string {
  const messages = store.messagesByChat.get(chatId);
  if (!messages) return `No messages found for chat ${chatId}`;
  return formatMessages(messages);
}

function getMessageContext(store: DataStore, msgId: string, window: number): string {
  const msg = store.messagesById.get(msgId);
  if (!msg) return `Message ${msgId} not found`;
  
  const chatMessages = store.messagesByChat.get(msg.chat_id) ?? [];
  const idx = chatMessages.findIndex(m => m.id === msgId);
  if (idx === -1) return `Message ${msgId} not found in chat`;
  
  const start = Math.max(0, idx - window);
  const end = Math.min(chatMessages.length, idx + window + 1);
  const context = chatMessages.slice(start, end);
  
  return formatMessages(context);
}

function searchMessages(store: DataStore, query: string, chatIds?: string[]): string {
  const regex = new RegExp(query, "i");
  const results: Message[] = [];
  
  const chatsToSearch = chatIds ?? [...store.messagesByChat.keys()];
  
  for (const chatId of chatsToSearch) {
    const messages = store.messagesByChat.get(chatId) ?? [];
    for (const msg of messages) {
      if (regex.test(msg.body)) {
        results.push(msg);
      }
    }
  }
  
  if (results.length === 0) return "No messages found matching pattern";
  return formatMessages(results.slice(0, 20)); // Limit to 20 results
}

/**
 * Run Pass 3: Deep-dive investigation
 */
export async function runPass3(
  investigations: InvestigationRequest[],
  chats: Chat[],
  messages: Message[]
): Promise<Pass3Output> {
  if (investigations.length === 0) {
    return {
      circle_refinements: [],
      loop_refinements: [],
      goal_refinements: [],
    };
  }

  const store = buildDataStore(chats, messages);
  const model = getModel();
  
  console.error(`Pass 3: Investigating ${investigations.length} uncertain items`);
  
  // Format investigation requests
  const investigationText = investigations
    .map((inv, i) => `${i + 1}. [${inv.type}] ${inv.subject}: ${inv.reason} (check: ${inv.chat_ids.join(", ")})`)
    .join("\n");

  const { text } = await generateText({
    model,
    system: SYSTEM_PROMPT,
    prompt: `Please investigate these uncertain items and provide refined decisions:

${investigationText}

Use the tools to gather evidence, then output your final decisions.`,
    tools: {
      get_messages: tool({
        description: "Get all messages from a chat",
        inputSchema: z.object({
          chat_id: z.string().describe("Chat ID to fetch messages from"),
        }),
        execute: async ({ chat_id }) => getMessages(store, chat_id),
      }),
      get_message_context: tool({
        description: "Get a message with surrounding context",
        inputSchema: z.object({
          msg_id: z.string().describe("Message ID to get context for"),
          window: z.number().default(5).describe("Number of messages before and after"),
        }),
        execute: async ({ msg_id, window }) => getMessageContext(store, msg_id, window ?? 5),
      }),
      search_messages: tool({
        description: "Search messages by regex pattern",
        inputSchema: z.object({
          query: z.string().describe("Regex pattern to search for"),
          chat_ids: z.array(z.string()).optional().describe("Limit search to these chats"),
        }),
        execute: async ({ query, chat_ids }) => searchMessages(store, query, chat_ids),
      }),
    },
    temperature: 0,
  });

  // Now ask for structured output based on investigation
  const result = await generate(
    `Based on your investigation, provide the refined decisions in structured format.

Investigation results:
${text}

Now output your circle_refinements, loop_refinements, and goal_refinements.`,
    pass3OutputSchema,
    { temperature: 0 }
  );

  return result;
}

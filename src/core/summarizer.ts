import OpenAI from "openai";
import type { SessionMessage, ContentBlock } from "./types.js";
import { getSetting } from "./store.js";

const MODEL = "gpt-4o-mini";
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;
const SETTING_KEY = "openai_api_key";

let openaiClient: OpenAI | null = null;
let lastApiKey: string | null = null;

export function getStoredApiKey(): string | null {
  return getSetting(SETTING_KEY);
}

export function getEffectiveApiKey(): string | null {
  // Stored key takes precedence over env var
  return getStoredApiKey() || process.env.OPENAI_API_KEY || null;
}

export function isApiKeyConfigured(): boolean {
  return Boolean(getEffectiveApiKey());
}

function getOpenAI(): OpenAI | null {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) return null;

  // Recreate client if key changed
  if (openaiClient && lastApiKey !== apiKey) {
    openaiClient = null;
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
    lastApiKey = apiKey;
  }
  return openaiClient;
}

function extractTextFromContent(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;

  const textParts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && block.text) {
      textParts.push(block.text);
    } else if (block.type === "tool_use" && block.name) {
      textParts.push(`[Used tool: ${block.name}]`);
    }
  }
  return textParts.join("\n");
}

function formatMessagesForSummary(messages: SessionMessage[]): string {
  const relevantMessages = messages.filter(
    (msg) => (msg.type === "user" || msg.type === "assistant") && !msg.isMeta && msg.message
  );

  const formatted: string[] = [];
  for (const msg of relevantMessages.slice(0, 20)) {
    const role = msg.type === "user" ? "User" : "Assistant";
    const text = extractTextFromContent(msg.message?.content || "");
    const truncated = text.length > 500 ? text.slice(0, 500) + "..." : text;
    formatted.push(`${role}: ${truncated}`);
  }

  return formatted.join("\n\n");
}

export async function summarizeSession(messages: SessionMessage[]): Promise<string | null> {
  const openai = getOpenAI();
  if (!openai) return null;

  const conversationText = formatMessagesForSummary(messages);
  if (!conversationText.trim()) return null;

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that summarizes coding sessions. " +
            "Provide a concise 1-2 sentence summary focusing on what was accomplished or discussed. " +
            "Be specific about the technical task (e.g., 'Fixed authentication bug in login flow' not 'Worked on code'). " +
            "Do not start with 'The user' or 'This session'. Start directly with the action.",
        },
        {
          role: "user",
          content: `Summarize this coding session:\n\n${conversationText}`,
        },
      ],
      max_tokens: 100,
      temperature: 0.3,
    });

    return response.choices[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error("Failed to generate summary:", error);
    return null;
  }
}

export interface SummaryProcessor {
  start: () => void;
  stop: () => void;
  processNow: () => Promise<number>;
}

export function createSummaryProcessor(
  getSessionsWithoutSummary: () => Array<{ id: string }>,
  loadSessionMessages: (id: string) => Promise<SessionMessage[] | null>,
  updateSessionSummary: (id: string, summary: string) => void
): SummaryProcessor {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let isProcessing = false;

  async function processBatch(): Promise<number> {
    if (isProcessing || !isApiKeyConfigured()) return 0;
    isProcessing = true;

    let processed = 0;
    try {
      const sessions = getSessionsWithoutSummary().slice(0, BATCH_SIZE);

      for (const session of sessions) {
        const messages = await loadSessionMessages(session.id);
        if (!messages || messages.length === 0) continue;

        const summary = await summarizeSession(messages);
        if (summary) {
          updateSessionSummary(session.id, summary);
          processed++;
          console.log(`Generated summary for session ${session.id.slice(0, 8)}...`);
        }

        // Small delay between API calls to avoid rate limits
        if (sessions.indexOf(session) < sessions.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }
    } catch (error) {
      console.error("Error processing summaries:", error);
    } finally {
      isProcessing = false;
    }

    return processed;
  }

  return {
    start() {
      if (intervalId) return;

      // Process immediately on start
      processBatch().then((count) => {
        if (count > 0) {
          console.log(`Processed ${count} session summaries`);
        }
      });

      // Then process every 5 minutes
      intervalId = setInterval(() => {
        processBatch().then((count) => {
          if (count > 0) {
            console.log(`Processed ${count} session summaries`);
          }
        });
      }, 5 * 60 * 1000);
    },

    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },

    processNow: processBatch,
  };
}

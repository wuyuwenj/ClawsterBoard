import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  ActivityEntry,
  ContentBlock,
  FileAction,
  MessageUsage,
  Session,
  SessionMessage,
} from "./types.js";

const CLAUDE_DIR = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

export interface TokenUsageRecord {
  sessionId: string;
  projectName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/**
 * Decode a Claude project folder name back to a readable path.
 * e.g. "-Users-wuyuwenjames-Desktop-cs-clawster" → "~/Desktop/cs/clawster"
 */
function decodeProjectPath(encoded: string): string {
  const home = homedir();
  const homePrefix = home.replace(/\//g, "-").replace(/^-/, "");

  if (encoded.startsWith(`-${homePrefix}-`) || encoded.startsWith(homePrefix)) {
    const rest = encoded.startsWith("-")
      ? encoded.slice(homePrefix.length + 2)
      : encoded.slice(homePrefix.length + 1);
    return `~/${rest.replace(/-/g, "/")}`;
  }

  return "/" + encoded.replace(/^-/, "").replace(/-/g, "/");
}

/**
 * Extract the short project name from a decoded path.
 * e.g. "~/Desktop/cs/clawster" → "clawster"
 */
function projectName(decodedPath: string): string {
  const parts = decodedPath.split("/");
  return parts[parts.length - 1] || decodedPath;
}

async function collectJsonlFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJsonlFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(fullPath);
    }
  }

  return files;
}

function coerceUsage(value: unknown): MessageUsage | null {
  if (!value || typeof value !== "object") return null;
  return value as MessageUsage;
}

function usageFromMessage(message: unknown): MessageUsage | null {
  if (!message || typeof message !== "object") return null;
  return coerceUsage((message as { usage?: unknown }).usage);
}

function assistantMessagesFromLine(parsed: any): Array<{ message: any; sessionId: string }> {
  const entries: Array<{ message: any; sessionId: string }> = [];

  if (parsed.type === "assistant" && parsed.message?.role === "assistant") {
    entries.push({ message: parsed.message, sessionId: parsed.sessionId });
  }

  if (parsed.type !== "progress") {
    return entries;
  }

  const normalizedMessages = Array.isArray(parsed.data?.normalizedMessages)
    ? parsed.data.normalizedMessages
    : [];

  for (const candidate of normalizedMessages) {
    if (candidate?.type === "assistant" && candidate.message?.role === "assistant") {
      entries.push({
        message: candidate.message,
        sessionId: candidate.sessionId ?? parsed.sessionId,
      });
    }
  }

  if (entries.length === 0 && parsed.data?.message?.type === "assistant") {
    entries.push({
      message: parsed.data.message.message,
      sessionId: parsed.data.message.sessionId ?? parsed.sessionId,
    });
  }

  return entries;
}

/**
 * Parse a JSONL session file into an array of messages.
 */
async function parseSessionFile(filePath: string): Promise<SessionMessage[]> {
  const content = await readFile(filePath, "utf-8");
  const messages: SessionMessage[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      // Skip file-history-snapshot lines — they're metadata, not messages
      if (parsed.type === "file-history-snapshot") continue;
      // Skip progress lines — they're subagent progress, noisy
      if (parsed.type === "progress") continue;
      messages.push(parsed as SessionMessage);
    } catch {
      // Skip malformed lines
    }
  }

  return messages;
}

function toInputRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function summarizeToolInput(name: string, input: Record<string, unknown>): string | undefined {
  if (typeof input.file_path === "string") {
    return truncateText(input.file_path, 100);
  }
  if (name === "Bash" && typeof input.command === "string") {
    return truncateText(input.command, 100);
  }
  if ((name === "Glob" || name === "Grep") && typeof input.pattern === "string") {
    return truncateText(input.pattern, 100);
  }
  if ((name === "Glob" || name === "Grep") && typeof input.query === "string") {
    return truncateText(input.query, 100);
  }

  const firstEntry = Object.entries(input)[0];
  if (!firstEntry) return undefined;
  return truncateText(`${firstEntry[0]}: ${String(firstEntry[1])}`, 100);
}

function describeToolUse(name: string, input: Record<string, unknown>): ActivityEntry | null {
  if (name === "Read" && typeof input.file_path === "string") {
    return {
      timestamp: "",
      action: "Read",
      target: truncateText(input.file_path, 140) || input.file_path,
      tool: name,
    };
  }

  if (name === "Edit" && typeof input.file_path === "string") {
    return {
      timestamp: "",
      action: "Edited",
      target: truncateText(input.file_path, 140) || input.file_path,
      tool: name,
    };
  }

  if (name === "Write" && typeof input.file_path === "string") {
    return {
      timestamp: "",
      action: "Created",
      target: truncateText(input.file_path, 140) || input.file_path,
      tool: name,
    };
  }

  if (name === "Bash" && typeof input.command === "string") {
    return {
      timestamp: "",
      action: "Ran",
      target: truncateText(input.command, 140) || input.command,
      tool: name,
    };
  }

  if (name === "Glob" || name === "Grep") {
    const target =
      typeof input.pattern === "string"
        ? input.pattern
        : typeof input.query === "string"
        ? input.query
        : undefined;
    if (target) {
      return {
        timestamp: "",
        action: "Searched",
        target: truncateText(target, 140) || target,
        tool: name,
      };
    }
  }

  const summary = summarizeToolInput(name, input);
  if (!summary) return null;

  return {
    timestamp: "",
    action: name,
    target: summary,
    tool: name,
  };
}

function extractLastAssistantText(messages: SessionMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type !== "assistant" || msg.isMeta || !msg.message) continue;
    const content = msg.message.content;
    if (typeof content === "string") {
      return truncateText(content.trim(), 200);
    }
    if (!Array.isArray(content)) continue;

    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j];
      if (block.type === "text" && block.text) {
        return truncateText(block.text.trim(), 200);
      }
    }
  }

  return undefined;
}

function extractLiveMetadata(messages: SessionMessage[]): Pick<
  Session,
  "filesTouched" | "recentActions" | "lastAssistantText" | "lastToolName" | "lastToolInput" | "durationSeconds"
> {
  const fileActions = new Map<string, Set<FileAction["actions"][number]>>();
  const recentActions: ActivityEntry[] = [];
  let lastToolName: string | undefined;
  let lastToolInput: string | undefined;

  for (const msg of messages) {
    if (!msg.message || !Array.isArray(msg.message.content)) continue;

    for (const block of msg.message.content as ContentBlock[]) {
      if (block.type !== "tool_use" || !block.name) continue;

      const input = toInputRecord(block.input);
      const activity = describeToolUse(block.name, input);
      if (activity) {
        recentActions.push({
          ...activity,
          timestamp: msg.timestamp,
        });
      }

      if (typeof input.file_path === "string") {
        const current = fileActions.get(input.file_path) ?? new Set<FileAction["actions"][number]>();
        if (block.name === "Read") current.add("read");
        if (block.name === "Edit") current.add("edited");
        if (block.name === "Write") current.add("created");
        fileActions.set(input.file_path, current);
      }

      lastToolName = block.name;
      lastToolInput = summarizeToolInput(block.name, input);
    }
  }

  const filesTouched = Array.from(fileActions.entries()).map(([path, actions]) => ({
    path,
    actions: Array.from(actions),
  }));

  const durationSeconds =
    messages.length > 1
      ? Math.max(
          0,
          Math.round(
            (new Date(messages[messages.length - 1].timestamp).getTime() -
              new Date(messages[0].timestamp).getTime()) /
              1000
          )
        )
      : 0;

  return {
    filesTouched,
    recentActions: recentActions.slice(-10),
    lastAssistantText: extractLastAssistantText(messages),
    lastToolName,
    lastToolInput,
    durationSeconds,
  };
}

/**
 * Extract the first user prompt text from a list of messages.
 */
function extractFirstPrompt(messages: SessionMessage[]): string | undefined {
  for (const msg of messages) {
    if (msg.type === "user" && msg.message?.role === "user" && !msg.isMeta) {
      const content = msg.message.content;
      if (typeof content === "string") return content.slice(0, 200);
      if (Array.isArray(content)) {
        const textBlock = content.find((b) => b.type === "text");
        if (textBlock?.text) return textBlock.text.slice(0, 200);
      }
    }
  }
  return undefined;
}

/**
 * Scan all Claude Code sessions on disk.
 * Returns a list of Session metadata objects.
 */
export async function scanSessions(): Promise<Session[]> {
  const sessions: Session[] = [];

  let projectDirs: string[];
  try {
    projectDirs = await readdir(PROJECTS_DIR);
  } catch {
    return sessions;
  }

  for (const projectDir of projectDirs) {
    const projectFullPath = join(PROJECTS_DIR, projectDir);
    const dirStat = await stat(projectFullPath).catch(() => null);
    if (!dirStat?.isDirectory()) continue;

    const decodedPath = decodeProjectPath(projectDir);
    const name = projectName(decodedPath);

    const entries = await readdir(projectFullPath).catch(() => [] as string[]);

    for (const entry of entries) {
      // Session files are UUID.jsonl (not agent-*.jsonl)
      if (!entry.endsWith(".jsonl")) continue;
      if (entry.startsWith("agent-")) continue;

      const sessionId = entry.replace(".jsonl", "");
      const filePath = join(projectFullPath, entry);

      try {
        const fileStat = await stat(filePath);
        const messages = await parseSessionFile(filePath);

        if (messages.length === 0) continue;

        const firstMsg = messages[0];
        const lastMsg = messages[messages.length - 1];

        // Count only actual user/assistant messages (not meta)
        const messageCount = messages.filter(
          (m) => (m.type === "user" || m.type === "assistant") && !m.isMeta
        ).length;

        sessions.push({
          id: sessionId,
          projectPath: decodedPath,
          projectName: name,
          cwd: firstMsg.cwd || decodedPath,
          startedAt: firstMsg.timestamp || fileStat.birthtime.toISOString(),
          lastActiveAt: lastMsg.timestamp || fileStat.mtime.toISOString(),
          messageCount,
          version: firstMsg.version,
          gitBranch: firstMsg.gitBranch || undefined,
          firstPrompt: extractFirstPrompt(messages),
          ...extractLiveMetadata(messages),
        });
      } catch {
        // Skip unreadable files
      }
    }
  }

  // Sort by most recently active first
  sessions.sort(
    (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
  );

  return sessions;
}

/**
 * Load full session detail including all messages.
 */
export async function loadSession(sessionId: string): Promise<SessionMessage[] | null> {
  let projectDirs: string[];
  try {
    projectDirs = await readdir(PROJECTS_DIR);
  } catch {
    return null;
  }

  for (const projectDir of projectDirs) {
    const filePath = join(PROJECTS_DIR, projectDir, `${sessionId}.jsonl`);
    try {
      await stat(filePath);
      return parseSessionFile(filePath);
    } catch {
      continue;
    }
  }

  return null;
}

export async function scanTokenUsage(): Promise<TokenUsageRecord[]> {
  const records: TokenUsageRecord[] = [];

  let projectDirs: string[];
  try {
    projectDirs = await readdir(PROJECTS_DIR);
  } catch {
    return records;
  }

  for (const encodedProjectDir of projectDirs) {
    const projectFullPath = join(PROJECTS_DIR, encodedProjectDir);
    const dirStat = await stat(projectFullPath).catch(() => null);
    if (!dirStat?.isDirectory()) continue;

    const decodedPath = decodeProjectPath(encodedProjectDir);
    const name = projectName(decodedPath);
    const jsonlFiles = await collectJsonlFiles(projectFullPath);

    for (const filePath of jsonlFiles) {
      const content = await readFile(filePath, "utf-8").catch(() => "");
      if (!content) continue;

      for (const line of content.split("\n")) {
        if (!line.trim()) continue;

        try {
          const parsed = JSON.parse(line);

          for (const candidate of assistantMessagesFromLine(parsed)) {
            const usage = usageFromMessage(candidate.message);
            if (!usage) continue;

            records.push({
              sessionId: candidate.sessionId || basename(filePath, ".jsonl"),
              projectName: name,
              model: candidate.message.model || "unknown",
              inputTokens: usage.input_tokens ?? 0,
              outputTokens: usage.output_tokens ?? 0,
              cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
              cacheReadTokens: usage.cache_read_input_tokens ?? 0,
            });
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  }

  return records;
}

export { CLAUDE_DIR, PROJECTS_DIR };

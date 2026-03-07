import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { Session, SessionMessage } from "./types.js";

const CLAUDE_DIR = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

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

export { CLAUDE_DIR, PROJECTS_DIR };

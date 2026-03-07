export interface Session {
  id: string;
  projectPath: string;
  projectName: string;
  cwd: string;
  startedAt: string;
  lastActiveAt: string;
  messageCount: number;
  version?: string;
  gitBranch?: string;
  firstPrompt?: string;
  summary?: string;
}

export interface SessionMessage {
  uuid: string;
  parentUuid: string | null;
  type: "user" | "assistant";
  timestamp: string;
  isMeta?: boolean;
  message?: {
    role: "user" | "assistant";
    content: string | ContentBlock[];
  };
}

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string | ContentBlock[];
}

export interface SessionDetail extends Session {
  messages: SessionMessage[];
}

export interface AnalyticsProject {
  projectName: string;
  sessionCount: number;
  messageCount: number;
}

export interface AnalyticsDay {
  date: string;
  messageCount: number;
}

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

export interface AnalyticsData {
  sessionsThisWeek: number;
  sessionsLastWeek: number;
  totalSessions: number;
  totalTokens: number;
  estimatedCost: number;
  tokenTotals: TokenTotals;
  activeProjects: AnalyticsProject[];
  messagesPerDay: AnalyticsDay[];
}

const BASE = "/api";

export async function fetchSessions(query?: string): Promise<Session[]> {
  const url = query
    ? `${BASE}/sessions?q=${encodeURIComponent(query)}`
    : `${BASE}/sessions`;
  const res = await fetch(url);
  return res.json();
}

export async function fetchSession(id: string): Promise<SessionDetail> {
  const res = await fetch(`${BASE}/sessions/${id}`);
  return res.json();
}

export async function reindex(): Promise<{ indexed: number }> {
  const res = await fetch(`${BASE}/reindex`, { method: "POST" });
  return res.json();
}

export async function resumeSession(id: string): Promise<{ ok?: boolean; terminal?: string; error?: string }> {
  const res = await fetch(`${BASE}/sessions/${id}/resume`, { method: "POST" });
  return res.json();
}

export async function fetchAnalytics(): Promise<AnalyticsData> {
  const res = await fetch(`${BASE}/analytics`);
  return res.json();
}

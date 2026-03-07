export interface Session {
  id: string;
  projectPath: string;
  projectName: string;
  repoKey?: string;
  repoSource?: string;
  cwd: string;
  startedAt: string;
  lastActiveAt: string;
  messageCount: number;
  version?: string;
  gitBranch?: string;
  firstPrompt?: string;
  summary?: string;
  recentActions?: ActivityEntry[];
  lastAssistantText?: string;
  lastToolName?: string;
  lastToolInput?: string;
}

export interface ActivityEntry {
  timestamp: string;
  action: string;
  target: string;
  tool: string;
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

export async function fetchLiveSessions(): Promise<Session[]> {
  const res = await fetch(`${BASE}/live-sessions`);
  return res.json();
}

export function subscribeToLiveSessions(
  onSessions: (sessions: Session[]) => void,
  onError?: () => void
): () => void {
  const source = new EventSource(`${BASE}/live-sessions/stream`);

  const handleSessions = (event: MessageEvent<string>) => {
    const payload = JSON.parse(event.data) as { sessions?: Session[] };
    onSessions(payload.sessions ?? []);
  };

  source.addEventListener("sessions", handleSessions as EventListener);
  source.onerror = () => {
    onError?.();
  };

  return () => {
    source.removeEventListener("sessions", handleSessions as EventListener);
    source.onerror = null;
    source.close();
  };
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

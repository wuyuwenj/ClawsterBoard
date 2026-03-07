export interface SessionMessage {
  uuid: string;
  parentUuid: string | null;
  type: "user" | "assistant" | "progress";
  sessionId: string;
  cwd: string;
  timestamp: string;
  version?: string;
  gitBranch?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: {
    role: "user" | "assistant";
    content: string | ContentBlock[];
    model?: string;
  };
}

export interface ContentBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result";
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
}

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

export interface SessionDetail extends Session {
  messages: SessionMessage[];
}

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
    usage?: MessageUsage;
  };
}

export interface MessageUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

export interface ContentBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result";
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
}

export interface FileAction {
  path: string;
  actions: ("read" | "edited" | "created")[];
}

export interface ActivityEntry {
  timestamp: string;
  action: string;
  target: string;
  tool: string;
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
  filesTouched?: FileAction[];
  recentActions?: ActivityEntry[];
  lastAssistantText?: string;
  lastToolName?: string;
  lastToolInput?: string;
  durationSeconds?: number;
}

export interface SessionDetail extends Session {
  messages: SessionMessage[];
}

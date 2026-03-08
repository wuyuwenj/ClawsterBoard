import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  fetchSession,
  resumeSession,
  type SessionDetail,
  type SessionMessage,
  type ContentBlock,
} from "./api";

interface Props {
  sessionId: string;
}

/* ── helpers ─────────────────────────────────────────── */

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

function shortPath(filePath: string): string {
  const home = filePath.replace(/^\/Users\/[^/]+\//, "~/");
  const parts = home.split("/");
  if (parts.length > 3) return ".../" + parts.slice(-2).join("/");
  return home;
}

/* ── Markdown renderer ───────────────────────────────── */

function MarkdownContent({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...rest }) {
          const match = /language-(\w+)/.exec(className || "");
          const codeString = String(children).replace(/\n$/, "");
          if (match) {
            return (
              <SyntaxHighlighter
                style={vscDarkPlus}
                language={match[1]}
                PreTag="div"
                customStyle={{
                  margin: 0,
                  borderRadius: "6px",
                  fontSize: "13px",
                }}
              >
                {codeString}
              </SyntaxHighlighter>
            );
          }
          return (
            <code className="inline-code" {...rest}>
              {children}
            </code>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

/* ── Thinking block ──────────────────────────────────── */

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="thinking-block">
      <button className="thinking-toggle" onClick={() => setOpen(!open)}>
        <span className="thinking-icon">{open ? "▾" : "▸"}</span>
        Thinking...
      </button>
      {open && (
        <div className="thinking-content">
          <MarkdownContent text={text} />
        </div>
      )}
    </div>
  );
}

/* ── Tool use blocks ─────────────────────────────────── */

function getToolResult(
  messages: SessionMessage[],
  currentIdx: number,
  toolUseBlock: ContentBlock
): string | null {
  // Look for the tool_result in subsequent messages
  for (let i = currentIdx + 1; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg.message || !Array.isArray(msg.message.content)) continue;
    for (const block of msg.message.content) {
      if (block.type === "tool_result") {
        // tool_result blocks can have content as string or array
        if (typeof block.content === "string") return block.content;
        if (Array.isArray(block.content)) {
          return block.content
            .filter((b) => b.type === "text" && b.text)
            .map((b) => b.text!)
            .join("\n");
        }
      }
    }
    // Only check the immediate next message for results
    break;
  }
  return null;
}

function BashBlock({
  input,
  result,
}: {
  input: Record<string, unknown>;
  result: string | null;
}) {
  const [open, setOpen] = useState(false);
  const command = (input.command as string) || "";
  const description = (input.description as string) || "";

  return (
    <div className="tool-block tool-bash">
      <div className="tool-header" onClick={() => result && setOpen(!open)}>
        <span className="tool-icon">$</span>
        <code className="tool-command">{command}</code>
        {description && (
          <span className="tool-description">{description}</span>
        )}
        {result && (
          <span className="tool-expand">{open ? "▾" : "▸"}</span>
        )}
      </div>
      {open && result && (
        <pre className="tool-output">{result}</pre>
      )}
    </div>
  );
}

function ReadBlock({ input }: { input: Record<string, unknown> }) {
  const filePath = (input.file_path as string) || "";
  return (
    <div className="tool-block tool-read">
      <div className="tool-header">
        <span className="tool-icon">↗</span>
        <span className="tool-label">Read</span>
        <code className="tool-filepath">{shortPath(filePath)}</code>
      </div>
    </div>
  );
}

function EditBlock({ input }: { input: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const filePath = (input.file_path as string) || "";
  const oldStr = (input.old_string as string) || "";
  const newStr = (input.new_string as string) || "";
  const hasDiff = oldStr || newStr;

  return (
    <div className="tool-block tool-edit">
      <div
        className="tool-header"
        onClick={() => hasDiff && setOpen(!open)}
      >
        <span className="tool-icon">✎</span>
        <span className="tool-label">Edited</span>
        <code className="tool-filepath">{shortPath(filePath)}</code>
        {hasDiff && (
          <span className="tool-expand">{open ? "▾" : "▸"}</span>
        )}
      </div>
      {open && hasDiff && (
        <div className="tool-diff">
          {oldStr && (
            <pre className="diff-old">
              {oldStr.split("\n").map((line, i) => (
                <div key={i} className="diff-line diff-remove">
                  <span className="diff-sign">-</span>
                  {line}
                </div>
              ))}
            </pre>
          )}
          {newStr && (
            <pre className="diff-new">
              {newStr.split("\n").map((line, i) => (
                <div key={i} className="diff-line diff-add">
                  <span className="diff-sign">+</span>
                  {line}
                </div>
              ))}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function WriteBlock({ input }: { input: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const filePath = (input.file_path as string) || "";
  const content = (input.content as string) || "";

  return (
    <div className="tool-block tool-write">
      <div
        className="tool-header"
        onClick={() => content && setOpen(!open)}
      >
        <span className="tool-icon">+</span>
        <span className="tool-label">Created</span>
        <code className="tool-filepath">{shortPath(filePath)}</code>
        {content && (
          <span className="tool-expand">{open ? "▾" : "▸"}</span>
        )}
      </div>
      {open && content && (
        <pre className="tool-output">{content}</pre>
      )}
    </div>
  );
}

function GlobGrepBlock({
  name,
  input,
}: {
  name: string;
  input: Record<string, unknown>;
}) {
  const pattern =
    (input.pattern as string) || (input.query as string) || "";
  const path = (input.path as string) || "";
  return (
    <div className="tool-block tool-search">
      <div className="tool-header">
        <span className="tool-icon">⌕</span>
        <span className="tool-label">{name}</span>
        <code className="tool-command">{pattern}</code>
        {path && (
          <span className="tool-description">in {shortPath(path)}</span>
        )}
      </div>
    </div>
  );
}

function GenericToolBlock({
  name,
  input,
}: {
  name: string;
  input: Record<string, unknown>;
}) {
  const [open, setOpen] = useState(false);
  const summary = Object.entries(input)
    .slice(0, 2)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`)
    .join(", ");

  return (
    <div className="tool-block tool-generic">
      <div className="tool-header" onClick={() => setOpen(!open)}>
        <span className="tool-icon">⚙</span>
        <span className="tool-label">{name}</span>
        {summary && (
          <span className="tool-description">{summary}</span>
        )}
        <span className="tool-expand">{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <pre className="tool-output">
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ToolUseBlock({
  block,
  messages,
  messageIdx,
}: {
  block: ContentBlock;
  messages: SessionMessage[];
  messageIdx: number;
}) {
  const name = block.name || "Unknown";
  const input = (block.input as Record<string, unknown>) || {};
  const result = getToolResult(messages, messageIdx, block);

  switch (name) {
    case "Bash":
      return <BashBlock input={input} result={result} />;
    case "Read":
      return <ReadBlock input={input} />;
    case "Edit":
      return <EditBlock input={input} />;
    case "Write":
      return <WriteBlock input={input} />;
    case "Glob":
    case "Grep":
      return <GlobGrepBlock name={name} input={input} />;
    default:
      return <GenericToolBlock name={name} input={input} />;
  }
}

/* ── Message renderer ────────────────────────────────── */

function MessageContent({
  msg,
  messages,
  messageIdx,
}: {
  msg: SessionMessage;
  messages: SessionMessage[];
  messageIdx: number;
}) {
  if (!msg.message) return null;
  const content = msg.message.content;

  if (typeof content === "string") {
    return (
      <div className="message-text">
        <MarkdownContent text={content} />
      </div>
    );
  }

  if (!Array.isArray(content)) return null;

  const elements: React.ReactNode[] = [];

  for (let i = 0; i < content.length; i++) {
    const block = content[i];

    if (block.type === "text" && block.text) {
      elements.push(
        <div key={`text-${i}`} className="message-text">
          <MarkdownContent text={block.text} />
        </div>
      );
    } else if (block.type === "thinking" && block.thinking) {
      elements.push(
        <ThinkingBlock key={`think-${i}`} text={block.thinking} />
      );
    } else if (block.type === "tool_use") {
      elements.push(
        <ToolUseBlock
          key={`tool-${i}`}
          block={block}
          messages={messages}
          messageIdx={messageIdx}
        />
      );
    }
    // tool_result blocks are consumed by getToolResult — skip rendering them directly
  }

  return <>{elements}</>;
}

/* ── Main component ──────────────────────────────────── */

export default function SessionView({ sessionId }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [resumeStatus, setResumeStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [resumeMessage, setResumeMessage] = useState("");

  useEffect(() => {
    setLoading(true);
    fetchSession(sessionId)
      .then(setDetail)
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    setResumeStatus("idle");
    setResumeMessage("");
  }, [sessionId]);

  const handleResume = useCallback(async () => {
    setResumeStatus("loading");
    try {
      const result = await resumeSession(sessionId);
      if (result.ok) {
        setResumeStatus("success");
        setResumeMessage(`Opened in ${result.terminal}`);
        setTimeout(() => setResumeStatus("idle"), 3000);
      } else {
        setResumeStatus("error");
        setResumeMessage(result.error || "Failed to open terminal");
        setTimeout(() => setResumeStatus("idle"), 5000);
      }
    } catch {
      setResumeStatus("error");
      setResumeMessage("Failed to connect to server");
      setTimeout(() => setResumeStatus("idle"), 5000);
    }
  }, [sessionId]);

  if (loading) return <div className="loading">Loading session...</div>;
  if (!detail) return <div className="loading">Session not found</div>;

  const allMessages = detail.messages || [];
  const visibleMessages = allMessages.filter(
    (m) =>
      (m.type === "user" || m.type === "assistant") && !m.isMeta
  );

  // Group consecutive assistant messages together for timeline view
  type MessageGroup = {
    role: "user" | "assistant";
    messages: { msg: SessionMessage; idx: number }[];
  };

  const groups: MessageGroup[] = [];
  for (const msg of visibleMessages) {
    const idx = allMessages.indexOf(msg);
    const role = msg.type as "user" | "assistant";
    const lastGroup = groups[groups.length - 1];

    if (lastGroup && lastGroup.role === role) {
      lastGroup.messages.push({ msg, idx });
    } else {
      groups.push({ role, messages: [{ msg, idx }] });
    }
  }

  return (
    <div className="session-view">
      <div className="session-header">
        <div>
          <h2>{detail.projectName}</h2>
          <span className="session-path">{detail.projectPath}</span>
        </div>
        <div className="session-info">
          {detail.gitBranch && (
            <span className="badge">{detail.gitBranch}</span>
          )}
          <span className="badge">{detail.messageCount} messages</span>
          <span className="badge">{formatDate(detail.startedAt)}</span>
        </div>
      </div>

      <div className="session-id">
        <code>{detail.id}</code>
        <button
          className="btn-resume"
          onClick={handleResume}
          disabled={resumeStatus === "loading"}
          title="Open a new terminal tab and resume this Claude Code session"
        >
          {resumeStatus === "loading"
            ? "Opening..."
            : resumeStatus === "success"
            ? resumeMessage
            : resumeStatus === "error"
            ? resumeMessage
            : "Resume Session"}
        </button>
      </div>

      {detail.summary && (
        <div className="session-summary">
          <span className="summary-badge">AI Summary</span>
          <p>{detail.summary}</p>
        </div>
      )}

      <div className="timeline">
        {groups.map((group, gi) => (
          <div
            key={gi}
            className={`timeline-group timeline-${group.role}`}
          >
            <div className="timeline-role">
              {group.role === "user" ? "You" : "Claude"}
            </div>
            <div className="timeline-content">
              {group.messages.map(({ msg, idx }) => (
                <div key={msg.uuid} className="timeline-message">
                  <MessageContent
                    msg={msg}
                    messages={allMessages}
                    messageIdx={idx}
                  />
                </div>
              ))}
            </div>
            <div className="message-time">
              {formatDate(
                group.messages[group.messages.length - 1].msg.timestamp
              )}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <div className="loading">No visible messages in this session</div>
        )}
      </div>
    </div>
  );
}

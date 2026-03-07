import { useState, useEffect } from "react";
import { fetchSession, type SessionDetail, type SessionMessage } from "./api";

interface Props {
  sessionId: string;
}

function extractText(msg: SessionMessage): string | null {
  if (!msg.message) return null;
  const content = msg.message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("\n");
    return texts || null;
  }
  return null;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

export default function SessionView({ sessionId }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchSession(sessionId)
      .then(setDetail)
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) return <div className="loading">Loading session...</div>;
  if (!detail) return <div className="loading">Session not found</div>;

  const visibleMessages = (detail.messages || []).filter(
    (m) =>
      (m.type === "user" || m.type === "assistant") &&
      !m.isMeta &&
      extractText(m)
  );

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
          onClick={() => {
            navigator.clipboard.writeText(
              `cd ${detail.cwd} && claude -r ${detail.id}`
            );
          }}
          title="Copy resume command (includes cd to project directory)"
        >
          Copy Resume Command
        </button>
      </div>

      <div className="messages">
        {visibleMessages.map((msg) => {
          const text = extractText(msg);
          if (!text) return null;
          return (
            <div key={msg.uuid} className={`message message-${msg.type}`}>
              <div className="message-role">
                {msg.type === "user" ? "You" : "Claude"}
              </div>
              <div className="message-text">{text}</div>
              <div className="message-time">{formatDate(msg.timestamp)}</div>
            </div>
          );
        })}
        {visibleMessages.length === 0 && (
          <div className="loading">No visible messages in this session</div>
        )}
      </div>
    </div>
  );
}

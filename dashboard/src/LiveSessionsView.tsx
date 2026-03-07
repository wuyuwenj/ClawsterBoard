import { useEffect, useMemo, useState } from "react";
import { fetchSessions, resumeSession, type Session } from "./api";

const LIVE_WINDOW_MS = 30 * 60 * 1000;
const MAX_LIVE_SESSIONS = 6;

interface Props {
  onInspectSession: (id: string) => void;
}

function isLiveSession(lastActiveAt: string): boolean {
  const timestamp = new Date(lastActiveAt).getTime();
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp <= LIVE_WINDOW_MS;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function shortPath(filePath: string): string {
  const home = filePath.replace(/^\/Users\/[^/]+\//, "~/");
  const parts = home.split("/");
  if (parts.length > 4) return ".../" + parts.slice(-3).join("/");
  return home;
}

function clampText(text: string | undefined, fallback: string): string {
  if (!text) return fallback;
  const compact = text.replace(/\s+/g, " ").trim();
  return compact || fallback;
}

function getGridClassName(count: number): string {
  if (count <= 1) return "live-grid live-grid-1";
  if (count === 2) return "live-grid live-grid-2";
  if (count <= 4) return "live-grid live-grid-4";
  return "live-grid live-grid-6";
}

export default function LiveSessionsView({ onInspectSession }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [resumeState, setResumeState] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function loadSessions() {
      try {
        const data = await fetchSessions();
        if (!cancelled) {
          setSessions(data);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadSessions();
    const timer = window.setInterval(loadSessions, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const liveSessions = useMemo(
    () =>
      sessions
        .filter((session) => isLiveSession(session.lastActiveAt))
        .sort(
          (a, b) =>
            new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
        )
        .slice(0, MAX_LIVE_SESSIONS),
    [sessions]
  );

  const hiddenCount = useMemo(() => {
    const liveCount = sessions.filter((session) => isLiveSession(session.lastActiveAt)).length;
    return Math.max(0, liveCount - MAX_LIVE_SESSIONS);
  }, [sessions]);

  async function handleResume(id: string) {
    setResumeState((prev) => ({ ...prev, [id]: "opening..." }));
    try {
      const result = await resumeSession(id);
      if (result.ok) {
        setResumeState((prev) => ({
          ...prev,
          [id]: `opened in ${result.terminal}`,
        }));
        window.setTimeout(() => {
          setResumeState((prev) => ({ ...prev, [id]: "resume" }));
        }, 2500);
      } else {
        setResumeState((prev) => ({
          ...prev,
          [id]: result.error || "resume failed",
        }));
      }
    } catch {
      setResumeState((prev) => ({ ...prev, [id]: "resume failed" }));
    }
  }

  if (loading && sessions.length === 0) {
    return <div className="loading">Loading live sessions...</div>;
  }

  return (
    <section className="live-shell">
      <div className="live-shell-header">
        <div>
          <h2>Live Sessions</h2>
          <p>Showing Claude Code sessions updated in the last 30 minutes.</p>
        </div>
        <div className="live-shell-meta">
          <span>{liveSessions.length} visible</span>
          {hiddenCount > 0 && <span>{hiddenCount} more hidden</span>}
        </div>
      </div>

      {liveSessions.length === 0 ? (
        <div className="live-empty">
          <p>No live sessions in the last 30 minutes.</p>
        </div>
      ) : (
        <div className={getGridClassName(liveSessions.length)}>
          {liveSessions.map((session) => (
            <article key={session.id} className="live-pane">
              <div className="live-pane-header">
                <div>
                  <div className="live-pane-title">{session.projectName}</div>
                  <div className="live-pane-subtitle">
                    {session.gitBranch ? session.gitBranch : shortPath(session.cwd || session.projectPath)}
                  </div>
                </div>
                <div className="live-pane-time">{timeAgo(session.lastActiveAt)}</div>
              </div>

              <div className="live-pane-body">
                <div className="live-line">
                  <span className="live-label">session</span>
                  <span>{session.id.slice(0, 8)}</span>
                </div>
                <div className="live-line">
                  <span className="live-label">messages</span>
                  <span>{session.messageCount}</span>
                </div>
                <div className="live-line">
                  <span className="live-label">updated</span>
                  <span>{new Date(session.lastActiveAt).toLocaleTimeString()}</span>
                </div>

                <div className="live-block">
                  <div className="live-block-label">summary</div>
                  <p>
                    {clampText(
                      session.summary || session.firstPrompt,
                      "No summary recorded yet."
                    )}
                  </p>
                </div>
              </div>

              <div className="live-pane-footer">
                <button
                  type="button"
                  className="live-action"
                  onClick={() => handleResume(session.id)}
                >
                  {resumeState[session.id] || "resume"}
                </button>
                <button
                  type="button"
                  className="live-action live-action-secondary"
                  onClick={() => onInspectSession(session.id)}
                >
                  open history
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

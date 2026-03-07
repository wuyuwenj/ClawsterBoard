import { useEffect, useMemo, useState } from "react";
import {
  fetchLiveSessions,
  resumeSession,
  subscribeToLiveSessions,
  type Session,
} from "./api";

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

function describeLatestActivity(session: Session): string {
  const latest = session.recentActions?.[session.recentActions.length - 1];
  if (latest) {
    return `${latest.action} ${latest.target}`;
  }
  if (session.lastToolName && session.lastToolInput) {
    return `${session.lastToolName} ${session.lastToolInput}`;
  }
  if (session.lastAssistantText) {
    return session.lastAssistantText;
  }
  return clampText(session.summary || session.firstPrompt, "No summary recorded yet.");
}

function getCurrentAction(session: Session): string {
  const latest = session.recentActions?.[session.recentActions.length - 1];
  if (latest) {
    return `${latest.action} ${latest.target}`;
  }
  if (session.lastToolName && session.lastToolInput) {
    return `${session.lastToolName} ${session.lastToolInput}`;
  }
  return "Waiting for next event";
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
    let fallbackTimer: number | undefined;

    async function loadSessions() {
      try {
        const data = await fetchLiveSessions();
        if (!cancelled) {
          setSessions(data);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    function startFallbackPolling() {
      if (fallbackTimer) return;
      fallbackTimer = window.setInterval(() => {
        void loadSessions();
      }, 5000);
    }

    loadSessions();
    const unsubscribe = subscribeToLiveSessions((data) => {
      if (!cancelled) {
        setSessions(data);
        setLoading(false);
      }
    }, startFallbackPolling);

    return () => {
      cancelled = true;
      if (fallbackTimer) {
        window.clearInterval(fallbackTimer);
      }
      unsubscribe();
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
    return Math.max(0, sessions.length - MAX_LIVE_SESSIONS);
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
                <div className="live-line live-line-current">
                  <span className="live-label">current</span>
                  <span className="live-current-action">{getCurrentAction(session)}</span>
                </div>

                <div className="live-block">
                  <div className="live-block-label">live</div>
                  <p>
                    {describeLatestActivity(session)}
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

import { useState, useEffect, useRef, useMemo } from "react";
import { fetchSessions, reindex, resumeSession, type Session } from "./api";

type SessionFilterMode = "all" | "live";
type GroupMode = "project" | "time";

interface Props {
  viewMode: SessionFilterMode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  expanded?: boolean;
}

interface SessionGroup {
  label: string;
  sessions: Session[];
  lastActiveAt: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function groupByProject(sessions: Session[]): SessionGroup[] {
  const map = new Map<string, Session[]>();
  for (const s of sessions) {
    const list = map.get(s.projectName) ?? [];
    list.push(s);
    map.set(s.projectName, list);
  }
  return Array.from(map.entries())
    .map(([label, sessions]) => ({
      label,
      sessions,
      lastActiveAt: sessions[0].lastActiveAt,
    }))
    .sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());
}

function formatTimeSlot(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(hours / 24);

  if (hours < 6) return "Last 6 hours";
  if (hours < 12) return "6-12 hours ago";
  if (hours < 18) return "12-18 hours ago";
  if (hours < 24) return "18-24 hours ago";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "Last week";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function groupByTime(sessions: Session[]): SessionGroup[] {
  const map = new Map<string, Session[]>();
  const order: string[] = [];
  for (const s of sessions) {
    const slot = formatTimeSlot(new Date(s.lastActiveAt));
    if (!map.has(slot)) {
      map.set(slot, []);
      order.push(slot);
    }
    map.get(slot)!.push(s);
  }
  return order.map((label) => ({
    label,
    sessions: map.get(label)!,
    lastActiveAt: map.get(label)![0].lastActiveAt,
  }));
}

function ResumeButton({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function handleResume(e: React.MouseEvent) {
    e.stopPropagation();
    setStatus("loading");
    try {
      const result = await resumeSession(sessionId);
      setStatus(result.ok ? "success" : "error");
    } catch {
      setStatus("error");
    }
    setTimeout(() => setStatus("idle"), 3000);
  }

  return (
    <button
      className="btn-resume-small"
      onClick={handleResume}
      disabled={status === "loading"}
      title="Resume this session in a new terminal tab"
    >
      {status === "loading" ? "..." : status === "success" ? "Opened" : status === "error" ? "Failed" : "Resume"}
    </button>
  );
}

function isLiveSession(lastActiveAt: string): boolean {
  const lastActive = new Date(lastActiveAt).getTime();
  if (Number.isNaN(lastActive)) return false;
  return Date.now() - lastActive <= 30 * 60 * 1000;
}

export default function SessionList({ viewMode, selectedId, onSelect, expanded }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [groupMode, setGroupMode] = useState<GroupMode>("project");
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  const groups = useMemo(
    () =>
      groupMode === "project"
        ? groupByProject(
            viewMode === "live"
              ? sessions.filter((session) => isLiveSession(session.lastActiveAt))
              : sessions
          )
        : groupByTime(
            viewMode === "live"
              ? sessions.filter((session) => isLiveSession(session.lastActiveAt))
              : sessions
          ),
    [sessions, groupMode, viewMode]
  );
  const visibleSessions = useMemo(
    () =>
      viewMode === "live"
        ? sessions.filter((session) => isLiveSession(session.lastActiveAt))
        : sessions,
    [sessions, viewMode]
  );

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const hasSelectedSession = visibleSessions.some((session) => session.id === selectedId);
    if (!hasSelectedSession) {
      onSelect(null);
    }
  }, [selectedId, visibleSessions, onSelect]);

  async function loadSessions(query?: string) {
    setLoading(true);
    try {
      const data = await fetchSessions(query);
      setSessions(data);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(value: string) {
    setSearch(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      loadSessions(value || undefined);
    }, 300);
  }

  async function handleReindex() {
    setLoading(true);
    await reindex();
    await loadSessions(search || undefined);
  }

  function toggleGroup(projectName: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(projectName)) {
        next.delete(projectName);
      } else {
        next.add(projectName);
      }
      return next;
    });
  }

  return (
    <aside className={`sidebar${expanded ? " sidebar-expanded" : ""}`}>
      <div className="sidebar-header">
        <input
          type="text"
          className="search"
          placeholder="Search sessions..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
        />
        <div className="view-toggle">
          <button
            className={`view-toggle-btn ${groupMode === "project" ? "active" : ""}`}
            onClick={() => setGroupMode("project")}
            title="Group by project"
          >
            Project
          </button>
          <button
            className={`view-toggle-btn ${groupMode === "time" ? "active" : ""}`}
            onClick={() => setGroupMode("time")}
            title="Group by time"
          >
            Time
          </button>
        </div>
        <button className="btn-reindex" onClick={handleReindex} title="Re-scan sessions">
          Reindex
        </button>
      </div>
      <div className="session-list">
        {loading && visibleSessions.length === 0 ? (
          <div className="loading">Loading sessions...</div>
        ) : visibleSessions.length === 0 ? (
          <div className="loading">
            {viewMode === "live"
              ? "No live sessions in the last 30 minutes"
              : "No sessions found"}
          </div>
        ) : (
          groups.map((group) => {
            const isExpanded = expandedGroups.has(group.label);
            return (
              <div key={group.label} className="session-group">
                <div
                  className="session-group-header"
                  onClick={() => toggleGroup(group.label)}
                >
                  <span className={`group-chevron ${isExpanded ? "expanded" : ""}`}>
                    &#9654;
                  </span>
                  <span className="project-name">{group.label}</span>
                  <span className="group-count">{group.sessions.length}</span>
                  {groupMode === "project" && (
                    <span className="time-ago">{timeAgo(group.lastActiveAt)}</span>
                  )}
                </div>
                {isExpanded && (
                  <div className="session-group-items">
                    {group.sessions.map((s) => (
                      <div
                        key={s.id}
                        className={`session-card ${selectedId === s.id ? "selected" : ""}`}
                        onClick={() => onSelect(s.id)}
                      >
                        <div className="session-card-header">
                          {groupMode === "time" && (
                            <span className="card-project-name">{s.projectName}</span>
                          )}
                          <span className="time-ago">{timeAgo(s.lastActiveAt)}</span>
                        </div>
                        {s.gitBranch && (
                          <div className="git-branch">{s.gitBranch}</div>
                        )}
                        <div className="first-prompt">
                          {s.firstPrompt || "No prompt recorded"}
                        </div>
                        <div className="session-card-footer">
                          <div className="session-meta">
                            <span>{s.messageCount} messages</span>
                            {s.version && <span>v{s.version}</span>}
                          </div>
                          <ResumeButton sessionId={s.id} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

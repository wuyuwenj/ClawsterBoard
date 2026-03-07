import { useEffect, useMemo, useRef, useState } from "react";
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
  key: string;
  label: string;
  sessions: Session[];
  lastActiveAt: string;
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function labelMatchScore(label: string, query: string): number {
  const normalizedLabel = normalizeSearchValue(label);
  const normalizedQuery = normalizeSearchValue(query);

  if (!normalizedQuery) return 0;
  if (normalizedLabel === normalizedQuery) return 500;
  if (normalizedLabel.startsWith(normalizedQuery)) return 400;

  const segmentMatch = normalizedLabel
    .split(/[\/\-_ .]+/)
    .some((segment) => segment.startsWith(normalizedQuery));
  if (segmentMatch) return 300;

  const containsIndex = normalizedLabel.indexOf(normalizedQuery);
  if (containsIndex >= 0) return 200 - containsIndex;

  return 0;
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

function uniqueProjectNames(sessions: Session[]): string[] {
  return Array.from(new Set(sessions.map((session) => session.projectName).filter(Boolean)));
}

function displayGroupLabel(sessions: Session[]): string {
  const primary = sessions[0];
  const repoSource = primary.repoSource;
  if (!repoSource) {
    return primary.projectName;
  }

  const normalizedRepoSource = repoSource.toLowerCase();
  const extras = uniqueProjectNames(sessions).filter(
    (projectName) => !normalizedRepoSource.includes(projectName.toLowerCase())
  );

  if (extras.length === 1) {
    return `${repoSource} (${extras[0]})`;
  }

  if (extras.length > 1) {
    return `${repoSource} (${extras.length} local folders)`;
  }

  return repoSource;
}

function groupByProject(sessions: Session[], query?: string): SessionGroup[] {
  const map = new Map<string, Session[]>();

  for (const session of sessions) {
    const groupKey = session.repoKey || session.repoSource || session.projectName;
    const list = map.get(groupKey) ?? [];
    list.push(session);
    map.set(groupKey, list);
  }

  return Array.from(map.entries())
    .map(([key, groupedSessions]) => ({
      key,
      label: displayGroupLabel(groupedSessions),
      sessions: groupedSessions,
      lastActiveAt: groupedSessions[0].lastActiveAt,
    }))
    .sort((a, b) => {
      const scoreDiff = labelMatchScore(b.label, query || "") - labelMatchScore(a.label, query || "");
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime();
    });
}

function shortProjectPath(projectPath: string): string {
  const parts = projectPath.split("/");
  if (parts.length <= 3) return projectPath;
  return `.../${parts.slice(-2).join("/")}`;
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

  for (const session of sessions) {
    const slot = formatTimeSlot(new Date(session.lastActiveAt));
    if (!map.has(slot)) {
      map.set(slot, []);
      order.push(slot);
    }
    map.get(slot)!.push(session);
  }

  return order.map((label) => ({
    key: label,
    label,
    sessions: map.get(label)!,
    lastActiveAt: map.get(label)![0].lastActiveAt,
  }));
}

function isLiveSession(lastActiveAt: string): boolean {
  const lastActive = new Date(lastActiveAt).getTime();
  if (Number.isNaN(lastActive)) return false;
  return Date.now() - lastActive <= 30 * 60 * 1000;
}

function ResumeButton({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function handleResume(event: React.MouseEvent) {
    event.stopPropagation();
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

export default function SessionList({ viewMode, selectedId, onSelect, expanded }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [groupMode, setGroupMode] = useState<GroupMode>("project");
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  const visibleSessions = useMemo(
    () =>
      viewMode === "live"
        ? sessions.filter((session) => isLiveSession(session.lastActiveAt))
        : sessions,
    [sessions, viewMode]
  );

  const groups = useMemo(
    () => (groupMode === "project" ? groupByProject(visibleSessions, search) : groupByTime(visibleSessions)),
    [groupMode, visibleSessions, search]
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

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
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
            title="Group by repository source"
          >
            Repo
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
            const isExpanded = expandedGroups.has(group.key);
            return (
              <div key={group.key} className="session-group">
                <div
                  className="session-group-header"
                  onClick={() => toggleGroup(group.key)}
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
                    {group.sessions.map((session) => (
                      <div
                        key={session.id}
                        className={`session-card ${selectedId === session.id ? "selected" : ""}`}
                        onClick={() => onSelect(session.id)}
                      >
                        <div className="session-card-header">
                          {groupMode === "time" && (
                            <span className="card-project-name">{session.repoSource || session.projectName}</span>
                          )}
                          <span className="time-ago">{timeAgo(session.lastActiveAt)}</span>
                        </div>
                        {session.gitBranch && (
                          <div className="git-branch">{session.gitBranch}</div>
                        )}
                        <div className="session-source">
                          {shortProjectPath(session.projectPath)}
                        </div>
                        <div className="first-prompt">
                          {session.firstPrompt || "No prompt recorded"}
                        </div>
                        <div className="session-card-footer">
                          <div className="session-meta">
                            <span>{session.messageCount} messages</span>
                            {session.version && <span>v{session.version}</span>}
                          </div>
                          <ResumeButton sessionId={session.id} />
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

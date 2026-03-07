import { useState, useEffect, useRef } from "react";
import { fetchSessions, reindex, type Session } from "./api";

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
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

export default function SessionList({ selectedId, onSelect }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    loadSessions();
  }, []);

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

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <input
          type="text"
          className="search"
          placeholder="Search sessions..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
        />
        <button className="btn-reindex" onClick={handleReindex} title="Re-scan sessions">
          Reindex
        </button>
      </div>
      <div className="session-list">
        {loading && sessions.length === 0 ? (
          <div className="loading">Loading sessions...</div>
        ) : sessions.length === 0 ? (
          <div className="loading">No sessions found</div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              className={`session-card ${selectedId === s.id ? "selected" : ""}`}
              onClick={() => onSelect(s.id)}
            >
              <div className="session-card-header">
                <span className="project-name">{s.projectName}</span>
                <span className="time-ago">{timeAgo(s.lastActiveAt)}</span>
              </div>
              {s.gitBranch && (
                <div className="git-branch">{s.gitBranch}</div>
              )}
              <div className="first-prompt">
                {s.firstPrompt || "No prompt recorded"}
              </div>
              <div className="session-meta">
                <span>{s.messageCount} messages</span>
                {s.version && <span>v{s.version}</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

import { useEffect, useState } from "react";
import LiveSessionsView from "./LiveSessionsView";
import InteractiveClawster from "./InteractiveClawster";
import SessionList from "./SessionList";
import SessionView from "./SessionView";
import SettingsView from "./SettingsView";
import StatsView from "./StatsView";

type View = "sessions" | "stats" | "settings";
type ViewMode = "all" | "live";

function viewFromPath(pathname: string): View {
  if (pathname === "/stats") return "stats";
  if (pathname === "/settings") return "settings";
  return "sessions";
}

export default function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>(() => viewFromPath(window.location.pathname));
  const [viewMode, setViewMode] = useState<ViewMode>("all");

  useEffect(() => {
    function handlePopState() {
      setView(viewFromPath(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(nextView: View) {
    const nextPath = nextView === "stats" ? "/stats" : nextView === "settings" ? "/settings" : "/";
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    setView(nextView);
  }

  function openSessionMode(mode: ViewMode) {
    setViewMode(mode);
    navigate("sessions");
  }

  function handleInspectLiveSession(id: string) {
    setSelectedId(id);
    openSessionMode("all");
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <h1
            className="header-title"
            onClick={() => {
              setSelectedId(null);
              navigate("sessions");
            }}
          >
            Clawster HQ
          </h1>
          <span className="subtitle">Claude Code Session Dashboard</span>
        </div>
        <nav className="header-nav" aria-label="Primary">
          <button
            className={`nav-tab ${view === "sessions" && viewMode === "all" ? "active" : ""}`}
            onClick={() => openSessionMode("all")}
          >
            All Sessions
          </button>
          <button
            className={`nav-tab ${view === "sessions" && viewMode === "live" ? "active" : ""}`}
            onClick={() => openSessionMode("live")}
          >
            Live
          </button>
          <button
            className={`nav-tab ${view === "stats" ? "active" : ""}`}
            onClick={() => navigate("stats")}
          >
            Analytics
          </button>
          <button
            className={`nav-tab ${view === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            Settings
          </button>
        </nav>
      </header>
      {view === "sessions" ? (
        viewMode === "live" ? (
          <main className="main main-live">
            <LiveSessionsView onInspectSession={handleInspectLiveSession} />
          </main>
        ) : (
          <div className="layout">
            <SessionList
              viewMode={viewMode}
              selectedId={selectedId}
              onSelect={setSelectedId}
              expanded={!selectedId}
            />
            {selectedId && (
              <main className="main">
                <SessionView sessionId={selectedId} />
              </main>
            )}
          </div>
        )
      ) : view === "settings" ? (
        <main className="main main-full">
          <SettingsView />
        </main>
      ) : (
        <main className="main main-full">
          <StatsView />
        </main>
      )}
      <InteractiveClawster />
    </div>
  );
}

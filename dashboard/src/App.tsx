import { useEffect, useState } from "react";
import SessionList from "./SessionList";
import SessionView from "./SessionView";
import StatsView from "./StatsView";

type View = "sessions" | "stats";

function viewFromPath(pathname: string): View {
  return pathname === "/stats" ? "stats" : "sessions";
}

export default function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>(() => viewFromPath(window.location.pathname));

  useEffect(() => {
    function handlePopState() {
      setView(viewFromPath(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(nextView: View) {
    const nextPath = nextView === "stats" ? "/stats" : "/";
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    setView(nextView);
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
            Clawster
          </h1>
          <span className="subtitle">Claude Code Session Dashboard</span>
        </div>
        <nav className="header-nav" aria-label="Primary">
          <button
            className={`nav-tab ${view === "sessions" ? "active" : ""}`}
            onClick={() => navigate("sessions")}
          >
            Sessions
          </button>
          <button
            className={`nav-tab ${view === "stats" ? "active" : ""}`}
            onClick={() => navigate("stats")}
          >
            Analytics
          </button>
        </nav>
      </header>
      {view === "sessions" ? (
        <div className="layout">
          <SessionList
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
            expanded={!selectedId}
          />
          {selectedId && (
            <main className="main">
              <SessionView sessionId={selectedId} />
            </main>
          )}
        </div>
      ) : (
        <main className="main main-full">
          <StatsView />
        </main>
      )}
    </div>
  );
}

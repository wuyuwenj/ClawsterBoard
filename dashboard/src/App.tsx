import { useState } from "react";
import SessionList from "./SessionList";
import SessionView from "./SessionView";

export default function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="app">
      <header className="header">
        <h1>Clawster</h1>
        <span className="subtitle">Claude Code Session Dashboard</span>
      </header>
      <div className="layout">
        <SessionList
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
        />
        <main className="main">
          {selectedId ? (
            <SessionView sessionId={selectedId} />
          ) : (
            <div className="empty-state">
              <p>Select a session to view details</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

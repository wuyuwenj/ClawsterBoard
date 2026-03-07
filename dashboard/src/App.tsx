import { useState } from "react";
import SessionList from "./SessionList";
import SessionView from "./SessionView";

export default function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="app">
      <header className="header">
        <h1 className="header-title" onClick={() => setSelectedId(null)}>Clawster</h1>
        <span className="subtitle">Claude Code Session Dashboard</span>
      </header>
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
    </div>
  );
}

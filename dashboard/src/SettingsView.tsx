import { useEffect, useState } from "react";
import {
  fetchSummaryStatus,
  fetchApiKeyStatus,
  saveApiKey,
  deleteApiKey,
  triggerSummaryProcessing,
  type SummaryStatus,
  type ApiKeyStatus,
} from "./api";

export default function SettingsView() {
  const [status, setStatus] = useState<SummaryStatus | null>(null);
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [keyMessage, setKeyMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [summaryStatus, apiKey] = await Promise.all([
        fetchSummaryStatus(),
        fetchApiKeyStatus(),
      ]);
      setStatus(summaryStatus);
      setKeyStatus(apiKey);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveKey() {
    if (!apiKeyInput.trim()) return;

    setSaving(true);
    setKeyMessage(null);
    try {
      const result = await saveApiKey(apiKeyInput.trim());
      if (result.error) {
        setKeyMessage({ type: "error", text: result.error });
      } else {
        setKeyMessage({ type: "success", text: "API key saved successfully!" });
        setApiKeyInput("");
        loadData();
      }
    } catch {
      setKeyMessage({ type: "error", text: "Failed to save API key" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteKey() {
    setSaving(true);
    setKeyMessage(null);
    try {
      await deleteApiKey();
      setKeyMessage({ type: "success", text: "API key removed" });
      loadData();
    } catch {
      setKeyMessage({ type: "error", text: "Failed to remove API key" });
    } finally {
      setSaving(false);
    }
  }

  async function handleProcess() {
    setProcessing(true);
    setLastResult(null);
    try {
      const result = await triggerSummaryProcessing();
      if (result.error) {
        setLastResult(`Error: ${result.error}`);
      } else {
        setLastResult(`Processed ${result.processed} sessions`);
        loadData();
      }
    } catch {
      setLastResult("Failed to process summaries");
    } finally {
      setProcessing(false);
    }
  }

  if (loading) {
    return (
      <div className="settings-view">
        <h2>Settings</h2>
        <p className="loading">Loading...</p>
      </div>
    );
  }

  return (
    <div className="settings-view">
      <h2>Settings</h2>

      <section className="settings-section">
        <h3>AI Session Summaries</h3>
        <p className="settings-description">
          Automatically generate AI summaries for your coding sessions using OpenAI's GPT-4o-mini model.
        </p>

        <div className="settings-status">
          <div className="status-row">
            <span className="status-label">API Key Status:</span>
            <span className={`status-value ${status?.configured ? "configured" : "not-configured"}`}>
              {status?.configured ? "Configured" : "Not Configured"}
            </span>
          </div>
          {keyStatus?.hasKey && (
            <div className="status-row">
              <span className="status-label">Saved Key:</span>
              <span className="status-value">{keyStatus.maskedKey}</span>
            </div>
          )}
          {status?.hasEnvKey && (
            <div className="status-row">
              <span className="status-label">Environment:</span>
              <span className="status-value configured">OPENAI_API_KEY set</span>
            </div>
          )}
          <div className="status-row">
            <span className="status-label">Pending Summaries:</span>
            <span className="status-value">{status?.pendingCount ?? 0} sessions</span>
          </div>
        </div>

        <div className="api-key-section">
          <h4>OpenAI API Key</h4>
          <p className="settings-note">
            Enter your OpenAI API key to enable AI summaries. Get one at{" "}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
              platform.openai.com
            </a>
          </p>
          <div className="api-key-input-row">
            <input
              type="password"
              className="api-key-input"
              placeholder="sk-..."
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveKey()}
            />
            <button
              className="btn-primary"
              onClick={handleSaveKey}
              disabled={saving || !apiKeyInput.trim()}
            >
              {saving ? "Saving..." : "Save"}
            </button>
            {keyStatus?.hasKey && (
              <button
                className="btn-secondary"
                onClick={handleDeleteKey}
                disabled={saving}
              >
                Remove
              </button>
            )}
          </div>
          {keyMessage && (
            <p className={`key-message ${keyMessage.type}`}>{keyMessage.text}</p>
          )}
        </div>

        {status?.configured && (
          <div className="settings-actions">
            <button
              className="btn-primary"
              onClick={handleProcess}
              disabled={processing || (status?.pendingCount ?? 0) === 0}
            >
              {processing ? "Processing..." : "Process Summaries Now"}
            </button>
            {lastResult && <p className="action-result">{lastResult}</p>}
            <p className="settings-note">
              Summaries are also generated automatically in the background every 5 minutes.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

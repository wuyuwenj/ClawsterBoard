import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  scanSessions,
  scanTokenUsage,
  loadSession,
  upsertSessions,
  getSessions,
  getSession,
  searchSessions,
  getSessionCount,
  getSessionsThisWeek,
  getSessionsLastWeek,
  getActiveProjects,
  getMessagesPerDay,
  getSessionsNeedingSummary,
  updateSessionSummary,
  getSetting,
  setSetting,
  deleteSetting,
  startWatcher,
  closeDb,
  createSummaryProcessor,
  isApiKeyConfigured,
  getStoredApiKey,
  summarizeSession,
} from "../core/index.js";
import type { Session } from "../core/types.js";

const execFileAsync = promisify(execFile);
const LIVE_WINDOW_MS = 30 * 60 * 1000;

const __dirname = fileURLToPath(new URL(".", import.meta.url));

interface ModelRates {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

function ratesForModel(model: string): ModelRates {
  const normalized = model.toLowerCase();

  if (normalized.includes("opus")) {
    return { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 };
  }

  if (normalized.includes("sonnet")) {
    return { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };
  }

  if (normalized.includes("haiku")) {
    return { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 };
  }

  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

function estimateUsageCost(entry: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}): number {
  const rates = ratesForModel(entry.model);
  return (
    (entry.inputTokens * rates.input) / 1_000_000 +
    (entry.outputTokens * rates.output) / 1_000_000 +
    (entry.cacheCreationTokens * rates.cacheWrite) / 1_000_000 +
    (entry.cacheReadTokens * rates.cacheRead) / 1_000_000
  );
}

function getLiveSessions(sessions: Session[]): Session[] {
  const cutoff = Date.now() - LIVE_WINDOW_MS;
  return sessions.filter((session) => {
    const lastActive = new Date(session.lastActiveAt).getTime();
    return !Number.isNaN(lastActive) && lastActive >= cutoff;
  });
}

function writeSse(reply: FastifyReply, event: string, payload: unknown): void {
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function createServer(port = 7777) {
  const app = Fastify({ logger: false });
  const liveClients = new Set<FastifyReply>();

  // --- Summary processor for background AI summarization ---
  const summaryProcessor = createSummaryProcessor(
    getSessionsNeedingSummary,
    loadSession,
    updateSessionSummary
  );

  // --- Index: scan and populate on first boot ---
  async function reindex() {
    const sessions = await scanSessions();
    upsertSessions(sessions);
    return sessions.length;
  }

  async function broadcastLiveSessions() {
    if (liveClients.size === 0) return;
    const sessions = getLiveSessions(await scanSessions());
    const payload = { sessions, timestamp: new Date().toISOString() };
    for (const client of liveClients) {
      writeSse(client, "sessions", payload);
    }
  }

  // --- API Routes ---

  app.get("/api/sessions", async (request) => {
    const { q, limit, offset } = request.query as {
      q?: string;
      limit?: string;
      offset?: string;
    };

    if (q) {
      return searchSessions(q);
    }

    return getSessions(
      limit ? parseInt(limit, 10) : 100,
      offset ? parseInt(offset, 10) : 0
    );
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (request, reply) => {
    const { id } = request.params;
    const session = getSession(id);
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    const messages = await loadSession(id);
    return { ...session, messages };
  });

  app.post("/api/reindex", async () => {
    const count = await reindex();
    return { indexed: count };
  });

  app.get("/api/stats", async () => {
    return { totalSessions: getSessionCount() };
  });

  app.get("/api/analytics", async () => {
    const [
      sessionsThisWeek,
      sessionsLastWeek,
      totalSessions,
      activeProjects,
      messagesPerDay,
      tokenUsage,
    ] = await Promise.all([
      Promise.resolve(getSessionsThisWeek()),
      Promise.resolve(getSessionsLastWeek()),
      Promise.resolve(getSessionCount()),
      Promise.resolve(getActiveProjects(10)),
      Promise.resolve(getMessagesPerDay(30)),
      scanTokenUsage(),
    ]);

    const tokenTotals = tokenUsage.reduce(
      (totals, entry) => {
        totals.inputTokens += entry.inputTokens;
        totals.outputTokens += entry.outputTokens;
        totals.cacheCreationTokens += entry.cacheCreationTokens;
        totals.cacheReadTokens += entry.cacheReadTokens;
        totals.totalTokens +=
          entry.inputTokens +
          entry.outputTokens +
          entry.cacheCreationTokens +
          entry.cacheReadTokens;
        totals.estimatedCost += estimateUsageCost(entry);
        return totals;
      },
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
      }
    );

    return {
      sessionsThisWeek,
      sessionsLastWeek,
      totalSessions,
      activeProjects,
      messagesPerDay,
      tokenTotals: {
        inputTokens: tokenTotals.inputTokens,
        outputTokens: tokenTotals.outputTokens,
        cacheCreationTokens: tokenTotals.cacheCreationTokens,
        cacheReadTokens: tokenTotals.cacheReadTokens,
        totalTokens: tokenTotals.totalTokens,
      },
      totalTokens: tokenTotals.totalTokens,
      estimatedCost: Number(tokenTotals.estimatedCost.toFixed(2)),
    };
  });

  app.get("/api/live-sessions", async () => {
    const sessions = await scanSessions();
    return getLiveSessions(sessions);
  });

  app.get("/api/live-sessions/stream", async (request: FastifyRequest, reply: FastifyReply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.flushHeaders?.();
    reply.raw.write("retry: 3000\n\n");

    liveClients.add(reply);
    const sessions = getLiveSessions(await scanSessions());
    writeSse(reply, "sessions", {
      sessions,
      timestamp: new Date().toISOString(),
    });

    const keepAlive = setInterval(() => {
      reply.raw.write(": keep-alive\n\n");
    }, 15000);

    request.raw.on("close", () => {
      clearInterval(keepAlive);
      liveClients.delete(reply);
      reply.raw.end();
    });

    return reply;
  });

  app.post<{ Params: { id: string } }>("/api/sessions/:id/resume", async (request, reply) => {
    const { id } = request.params;
    const session = getSession(id);
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    const { cwd } = session;

    try {
      // Detect if iTerm2 is running
      const { stdout } = await execFileAsync("osascript", [
        "-e",
        'tell application "System Events" to (name of processes) contains "iTerm2"',
      ]);
      const iTermRunning = stdout.trim() === "true";

      if (iTermRunning) {
        const bridgePath = join(__dirname, "..", "..", "python", "clawster_iterm.py");
        await execFileAsync("python3", [bridgePath, "resume", id, cwd]);
        return { ok: true, terminal: "iTerm2" };
      } else {
        const script = `tell application "Terminal"
  activate
  do script "cd ${cwd.replace(/"/g, '\\"')} && claude -r ${id}"
end tell`;
        await execFileAsync("osascript", ["-e", script]);
        return { ok: true, terminal: "Terminal" };
      }
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || "Failed to open terminal" });
    }
  });

  // --- AI Summary endpoints ---

  app.get("/api/summary-status", async () => {
    const pendingSessions = getSessionsNeedingSummary();
    const storedKey = getStoredApiKey();
    return {
      configured: isApiKeyConfigured(),
      hasStoredKey: Boolean(storedKey),
      hasEnvKey: Boolean(process.env.OPENAI_API_KEY),
      pendingCount: pendingSessions.length,
    };
  });

  app.get("/api/settings/api-key", async () => {
    const storedKey = getStoredApiKey();
    // Only return masked version for security
    if (storedKey) {
      const masked = storedKey.slice(0, 7) + "..." + storedKey.slice(-4);
      return { hasKey: true, maskedKey: masked };
    }
    return { hasKey: false, maskedKey: null };
  });

  app.post("/api/settings/api-key", async (request) => {
    const { apiKey } = request.body as { apiKey?: string };

    if (!apiKey || typeof apiKey !== "string") {
      return { error: "API key is required" };
    }

    // Basic validation
    if (!apiKey.startsWith("sk-")) {
      return { error: "Invalid API key format" };
    }

    setSetting("openai_api_key", apiKey);

    // Start the summary processor if it wasn't running
    if (!summaryProcessor) {
      // Processor will be started on next check
    }

    return { success: true };
  });

  app.delete("/api/settings/api-key", async () => {
    deleteSetting("openai_api_key");
    return { success: true };
  });

  app.post("/api/summaries/process", async () => {
    if (!isApiKeyConfigured()) {
      return { error: "OPENAI_API_KEY not configured", processed: 0 };
    }
    const processed = await summaryProcessor.processNow();
    return { processed };
  });

  app.post<{ Params: { id: string } }>("/api/sessions/:id/summarize", async (request, reply) => {
    const { id } = request.params;

    if (!isApiKeyConfigured()) {
      return reply.status(400).send({ error: "OPENAI_API_KEY not configured" });
    }

    const session = getSession(id);
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    const messages = await loadSession(id);
    if (!messages || messages.length === 0) {
      return reply.status(400).send({ error: "Session has no messages" });
    }

    const summary = await summarizeSession(messages);
    if (!summary) {
      return reply.status(500).send({ error: "Failed to generate summary" });
    }

    updateSessionSummary(id, summary);
    return { summary };
  });

  // --- Serve React dashboard (static files) ---
  const dashboardPath = join(__dirname, "..", "..", "dashboard", "dist");

  await app.register(import("@fastify/static"), {
    root: dashboardPath,
    prefix: "/",
    decorateReply: true,
  });

  // SPA fallback: serve index.html for non-API, non-file routes
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.status(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html");
  });

  // --- Startup ---
  // Initial index
  const count = await reindex();
  console.log(`Indexed ${count} sessions`);

  // Start background summary processor
  if (isApiKeyConfigured()) {
    summaryProcessor.start();
    console.log("AI summary processor started");
  } else {
    console.log("AI summaries disabled (set OPENAI_API_KEY to enable)");
  }

  // Watch for changes and re-scan affected sessions
  startWatcher(async () => {
    const sessions = await scanSessions();
    upsertSessions(sessions);
    await broadcastLiveSessions();
    // Summary generation handled by background processor (every 5 mins)
    // Only processes sessions idle for 30+ mins
  });

  await app.listen({ port, host: "127.0.0.1" });
  console.log(`Clawster dashboard running at http://127.0.0.1:${port}`);

  // Cleanup on exit
  const cleanup = () => {
    summaryProcessor.stop();
    closeDb();
    app.close();
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  return app;
}

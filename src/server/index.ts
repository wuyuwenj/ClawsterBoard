import Fastify from "fastify";
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
  startWatcher,
  closeDb,
} from "../core/index.js";

const execFileAsync = promisify(execFile);

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

export async function createServer(port = 7777) {
  const app = Fastify({ logger: false });

  // --- Index: scan and populate on first boot ---
  async function reindex() {
    const sessions = await scanSessions();
    upsertSessions(sessions);
    return sessions.length;
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

  // Watch for changes and re-scan affected sessions
  startWatcher(async () => {
    const sessions = await scanSessions();
    upsertSessions(sessions);
  });

  await app.listen({ port, host: "127.0.0.1" });
  console.log(`Clawster dashboard running at http://127.0.0.1:${port}`);

  // Cleanup on exit
  const cleanup = () => {
    closeDb();
    app.close();
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  return app;
}

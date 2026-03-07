import Fastify from "fastify";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scanSessions,
  loadSession,
  upsertSessions,
  getSessions,
  getSession,
  searchSessions,
  getSessionCount,
  startWatcher,
  closeDb,
} from "../core/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

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

  // --- Serve React dashboard (static files) ---
  const dashboardPath = join(__dirname, "..", "..", "dashboard", "dist");

  await app.register(import("@fastify/static"), {
    root: dashboardPath,
    prefix: "/",
    decorateReply: false,
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

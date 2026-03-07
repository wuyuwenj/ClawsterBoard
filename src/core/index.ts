export { scanSessions, loadSession, CLAUDE_DIR, PROJECTS_DIR } from "./scanner.js";
export { upsertSessions, upsertSession, getSessions, getSession, searchSessions, getSessionCount, closeDb } from "./store.js";
export { startWatcher, stopWatcher } from "./watcher.js";
export type { Session, SessionDetail, SessionMessage, ContentBlock } from "./types.js";

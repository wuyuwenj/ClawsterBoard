export { scanSessions, loadSession, scanTokenUsage, CLAUDE_DIR, PROJECTS_DIR } from "./scanner.js";
export {
  upsertSessions,
  upsertSession,
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
  closeDb,
} from "./store.js";
export { startWatcher, stopWatcher } from "./watcher.js";
export {
  summarizeSession,
  createSummaryProcessor,
  isApiKeyConfigured,
  getStoredApiKey,
  getEffectiveApiKey,
} from "./summarizer.js";
export type { Session, SessionDetail, SessionMessage, ContentBlock } from "./types.js";

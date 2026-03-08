import Database from "better-sqlite3";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import type { Session } from "./types.js";

const CONFIG_DIR = join(homedir(), ".config", "clawster");
const DB_PATH = join(CONFIG_DIR, "sessions.db");

let db: Database.Database | null = null;

export interface ProjectActivity {
  projectName: string;
  sessionCount: number;
  messageCount: number;
}

export interface DailyMessageCount {
  date: string;
  messageCount: number;
}

function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(CONFIG_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      project_name TEXT NOT NULL,
      repo_key TEXT,
      repo_source TEXT,
      cwd TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      version TEXT,
      git_branch TEXT,
      first_prompt TEXT,
      summary TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_last_active
      ON sessions(last_active_at DESC);

    CREATE INDEX IF NOT EXISTS idx_sessions_project
      ON sessions(project_name);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  ensureColumn(db, "sessions", "repo_key", "TEXT");
  ensureColumn(db, "sessions", "repo_source", "TEXT");
  ensureColumn(db, "sessions", "summary_stale", "INTEGER DEFAULT 1");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_repo_key
      ON sessions(repo_key);
  `);

  return db;
}

function ensureColumn(
  database: Database.Database,
  tableName: string,
  columnName: string,
  definition: string
): void {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

export function upsertSession(session: Session): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO sessions (id, project_path, project_name, repo_key, repo_source, cwd, started_at, last_active_at, message_count, version, git_branch, first_prompt, summary, summary_stale, updated_at)
    VALUES (@id, @projectPath, @projectName, @repoKey, @repoSource, @cwd, @startedAt, @lastActiveAt, @messageCount, @version, @gitBranch, @firstPrompt, @summary, 1, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      project_path = @projectPath,
      project_name = @projectName,
      repo_key = @repoKey,
      repo_source = @repoSource,
      cwd = @cwd,
      last_active_at = @lastActiveAt,
      message_count = @messageCount,
      version = @version,
      git_branch = @gitBranch,
      first_prompt = @firstPrompt,
      summary = COALESCE(@summary, sessions.summary),
      summary_stale = CASE WHEN sessions.last_active_at != @lastActiveAt THEN 1 ELSE sessions.summary_stale END,
      updated_at = datetime('now')
  `).run({
    id: session.id,
    projectPath: session.projectPath,
    projectName: session.projectName,
    repoKey: session.repoKey ?? null,
    repoSource: session.repoSource ?? null,
    cwd: session.cwd,
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
    messageCount: session.messageCount,
    version: session.version ?? null,
    gitBranch: session.gitBranch ?? null,
    firstPrompt: session.firstPrompt ?? null,
    summary: session.summary ?? null,
  });
}

export function upsertSessions(sessions: Session[]): void {
  const db = getDb();
  const tx = db.transaction(() => {
    for (const session of sessions) {
      upsertSession(session);
    }
  });
  tx();
}

export function getSessions(limit = 100, offset = 0): Session[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, project_path, project_name, repo_key, repo_source, cwd, started_at, last_active_at,
           message_count, version, git_branch, first_prompt, summary
    FROM sessions
    ORDER BY last_active_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as Array<Record<string, unknown>>;

  return rows.map(rowToSession);
}

export function getSession(id: string): Session | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, project_path, project_name, repo_key, repo_source, cwd, started_at, last_active_at,
           message_count, version, git_branch, first_prompt, summary
    FROM sessions
    WHERE id = ?
  `).get(id) as Record<string, unknown> | undefined;

  return row ? rowToSession(row) : null;
}

export function searchSessions(query: string): Session[] {
  const db = getDb();
  const normalized = query.trim().toLowerCase();
  const like = `%${query}%`;
  const normalizedLike = `%${normalized}%`;
  const prefix = `${normalized}%`;
  const rows = db.prepare(`
    SELECT id, project_path, project_name, repo_key, repo_source, cwd, started_at, last_active_at,
           message_count, version, git_branch, first_prompt, summary
    FROM sessions
    WHERE project_name LIKE ? OR repo_source LIKE ? OR first_prompt LIKE ? OR git_branch LIKE ?
    ORDER BY
      CASE
        WHEN lower(COALESCE(repo_source, project_name)) = ? THEN 0
        WHEN lower(COALESCE(repo_source, project_name)) LIKE ? THEN 1
        WHEN lower(project_name) = ? THEN 2
        WHEN lower(project_name) LIKE ? THEN 3
        WHEN lower(COALESCE(repo_source, project_name)) LIKE ? THEN 4
        WHEN lower(first_prompt) LIKE ? THEN 5
        WHEN lower(git_branch) LIKE ? THEN 6
        ELSE 7
      END,
      CASE
        WHEN instr(lower(COALESCE(repo_source, project_name)), ?) = 0 THEN 9999
        ELSE instr(lower(COALESCE(repo_source, project_name)), ?)
      END,
      last_active_at DESC
    LIMIT 50
  `).all(
    like,
    like,
    like,
    like,
    normalized,
    prefix,
    normalized,
    prefix,
    normalizedLike,
    normalizedLike,
    normalizedLike,
    normalized,
    normalized
  ) as Array<Record<string, unknown>>;

  return rows.map(rowToSession);
}

export function getSessionCount(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as count FROM sessions").get() as { count: number };
  return row.count;
}

export function getSessionsThisWeek(): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) as count
    FROM sessions
    WHERE datetime(started_at) >= datetime('now', '-7 days')
  `).get() as { count: number };
  return row.count;
}

export function getSessionsLastWeek(): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) as count
    FROM sessions
    WHERE datetime(started_at) >= datetime('now', '-14 days')
      AND datetime(started_at) < datetime('now', '-7 days')
  `).get() as { count: number };
  return row.count;
}

export function getActiveProjects(limit = 10): ProjectActivity[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      COALESCE(MAX(NULLIF(repo_source, '')), project_name) as project_name,
      COUNT(*) as session_count,
      COALESCE(SUM(message_count), 0) as message_count
    FROM sessions
    GROUP BY COALESCE(NULLIF(repo_key, ''), project_path)
    ORDER BY session_count DESC, message_count DESC, project_name ASC
    LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    projectName: row.project_name as string,
    sessionCount: row.session_count as number,
    messageCount: row.message_count as number,
  }));
}

export function getMessagesPerDay(days = 30): DailyMessageCount[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      date(started_at) as date,
      COALESCE(SUM(message_count), 0) as message_count
    FROM sessions
    WHERE date(started_at) >= date('now', ?)
    GROUP BY date(started_at)
    ORDER BY date(started_at) ASC
  `).all(`-${days - 1} days`) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    date: row.date as string,
    messageCount: row.message_count as number,
  }));
}

export function getSessionsNeedingSummary(limit = 50): Array<{ id: string }> {
  const db = getDb();
  // Only get sessions that:
  // 1. Have been idle for 30+ minutes
  // 2. AND summary_stale = 1 (needs new summary)
  const rows = db.prepare(`
    SELECT id FROM sessions
    WHERE datetime(last_active_at) < datetime('now', '-30 minutes')
      AND (summary_stale = 1 OR summary_stale IS NULL)
    ORDER BY last_active_at DESC
    LIMIT ?
  `).all(limit) as Array<{ id: string }>;

  return rows;
}

export function updateSessionSummary(id: string, summary: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE sessions
    SET summary = ?, summary_stale = 0, updated_at = datetime('now')
    WHERE id = ?
  `).run(summary, id);
}

export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = datetime('now')
  `).run(key, value);
}

export function deleteSetting(key: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function rowToSession(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    projectPath: row.project_path as string,
    projectName: row.project_name as string,
    repoKey: (row.repo_key as string | null) ?? undefined,
    repoSource: (row.repo_source as string | null) ?? undefined,
    cwd: row.cwd as string,
    startedAt: row.started_at as string,
    lastActiveAt: row.last_active_at as string,
    messageCount: row.message_count as number,
    version: row.version as string | undefined,
    gitBranch: row.git_branch as string | undefined,
    firstPrompt: row.first_prompt as string | undefined,
    summary: row.summary as string | undefined,
  };
}

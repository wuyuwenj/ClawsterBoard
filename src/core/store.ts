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
  `);

  return db;
}

export function upsertSession(session: Session): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO sessions (id, project_path, project_name, cwd, started_at, last_active_at, message_count, version, git_branch, first_prompt, summary, updated_at)
    VALUES (@id, @projectPath, @projectName, @cwd, @startedAt, @lastActiveAt, @messageCount, @version, @gitBranch, @firstPrompt, @summary, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      last_active_at = @lastActiveAt,
      message_count = @messageCount,
      version = @version,
      git_branch = @gitBranch,
      first_prompt = @firstPrompt,
      summary = COALESCE(@summary, sessions.summary),
      updated_at = datetime('now')
  `).run({
    id: session.id,
    projectPath: session.projectPath,
    projectName: session.projectName,
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
    SELECT id, project_path, project_name, cwd, started_at, last_active_at,
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
    SELECT id, project_path, project_name, cwd, started_at, last_active_at,
           message_count, version, git_branch, first_prompt, summary
    FROM sessions
    WHERE id = ?
  `).get(id) as Record<string, unknown> | undefined;

  return row ? rowToSession(row) : null;
}

export function searchSessions(query: string): Session[] {
  const db = getDb();
  const like = `%${query}%`;
  const rows = db.prepare(`
    SELECT id, project_path, project_name, cwd, started_at, last_active_at,
           message_count, version, git_branch, first_prompt, summary
    FROM sessions
    WHERE project_name LIKE ? OR first_prompt LIKE ? OR git_branch LIKE ?
    ORDER BY last_active_at DESC
    LIMIT 50
  `).all(like, like, like) as Array<Record<string, unknown>>;

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
      project_name,
      COUNT(*) as session_count,
      COALESCE(SUM(message_count), 0) as message_count
    FROM sessions
    GROUP BY project_name
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

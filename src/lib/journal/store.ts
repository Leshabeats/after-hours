import type { DatabaseSync } from "node:sqlite";
import { isKind, isLogStatus, type LogEntry, type LogStatus } from "./types.ts";

export type JournalImportResult = {
  imported: boolean;
  entries: LogEntry[];
};

export type JournalRepo = {
  list: (userId: string) => LogEntry[];
  take: (userId: string, entry: LogEntry) => LogEntry[];
  setStatus: (userId: string, id: string, status: LogStatus) => LogEntry[] | null;
  drop: (userId: string, id: string) => LogEntry[] | null;
  importIfEmpty: (userId: string, entries: LogEntry[]) => JournalImportResult;
};

function uniqueEntries(entries: readonly LogEntry[]): LogEntry[] {
  const seen = new Set<string>();
  const next: LogEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    next.push(clone(entry));
  }
  return next;
}

function clone(entry: LogEntry): LogEntry {
  return { ...entry };
}

export function createMemoryJournal(): JournalRepo {
  const byUser = new Map<string, LogEntry[]>();

  function list(userId: string) {
    return (byUser.get(userId) ?? []).map(clone);
  }

  return {
    list,
    take(userId, entry) {
      const current = byUser.get(userId) ?? [];
      if (current.some((item) => item.id === entry.id)) return list(userId);
      byUser.set(userId, [clone(entry), ...current]);
      return list(userId);
    },
    setStatus(userId, id, status) {
      const current = byUser.get(userId);
      if (!current?.some((item) => item.id === id)) return null;
      byUser.set(
        userId,
        current.map((item) => (item.id === id ? { ...item, status } : item)),
      );
      return list(userId);
    },
    drop(userId, id) {
      const current = byUser.get(userId);
      if (!current?.some((item) => item.id === id)) return null;
      byUser.set(
        userId,
        current.filter((item) => item.id !== id),
      );
      return list(userId);
    },
    importIfEmpty(userId, entries) {
      const current = byUser.get(userId) ?? [];
      if (current.length > 0) return { imported: false, entries: list(userId) };
      byUser.set(userId, uniqueEntries(entries));
      return { imported: true, entries: list(userId) };
    },
  };
}



type JournalRow = {
  mission_id: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  kind: string;
  url: string;
  is_pr: number;
  status: string;
  taken_at: number;
};

function rowToEntry(row: JournalRow): LogEntry | null {
  if (!isKind(row.kind) || !isLogStatus(row.status)) return null;
  return {
    id: row.mission_id,
    owner: row.owner,
    repo: row.repo,
    number: row.number,
    title: row.title,
    kind: row.kind,
    url: row.url,
    isPr: Boolean(row.is_pr),
    status: row.status,
    takenAt: row.taken_at,
  };
}

export function createSqliteJournal(db: DatabaseSync): JournalRepo {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      login TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS journal (
      user_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      url TEXT NOT NULL,
      is_pr INTEGER NOT NULL,
      status TEXT NOT NULL,
      taken_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, mission_id)
    );
  `);

  const listStmt = db.prepare(
    `SELECT mission_id, owner, repo, number, title, kind, url, is_pr, status, taken_at
     FROM journal WHERE user_id = ? ORDER BY taken_at DESC`,
  );
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO journal
      (user_id, mission_id, owner, repo, number, title, kind, url, is_pr, status, taken_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const statusStmt = db.prepare(
    `UPDATE journal SET status = ? WHERE user_id = ? AND mission_id = ?`,
  );
  const dropStmt = db.prepare(
    `DELETE FROM journal WHERE user_id = ? AND mission_id = ?`,
  );
  const countStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM journal WHERE user_id = ?`,
  );

  function list(userId: string) {
    return (listStmt.all(userId) as JournalRow[])
      .map(rowToEntry)
      .filter((entry): entry is LogEntry => Boolean(entry));
  }

  function insert(userId: string, entry: LogEntry) {
    insertStmt.run(
      userId,
      entry.id,
      entry.owner,
      entry.repo,
      entry.number,
      entry.title,
      entry.kind,
      entry.url,
      entry.isPr ? 1 : 0,
      entry.status,
      entry.takenAt,
    );
  }

  return {
    list,
    take(userId, entry) {
      insert(userId, entry);
      return list(userId);
    },
    setStatus(userId, id, status) {
      const result = statusStmt.run(status, userId, id);
      if (result.changes === 0) return null;
      return list(userId);
    },
    drop(userId, id) {
      const result = dropStmt.run(userId, id);
      if (result.changes === 0) return null;
      return list(userId);
    },
    importIfEmpty(userId, entries) {
      const n = Number((countStmt.get(userId) as { n: number } | undefined)?.n ?? 0);
      if (n > 0) return { imported: false, entries: list(userId) };
      const unique = uniqueEntries(entries);
      if (unique.length === 0) return { imported: true, entries: [] };
      db.exec("BEGIN");
      try {
        for (const entry of unique) insert(userId, entry);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return { imported: true, entries: list(userId) };
    },
  };
}

export function upsertUser(
  db: DatabaseSync,
  user: { id: string; login: string; name: string; avatarUrl: string },
) {
  db.prepare(
    `INSERT INTO users (id, login, name, avatar_url, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       login = excluded.login,
       name = excluded.name,
       avatar_url = excluded.avatar_url`,
  ).run(user.id, user.login, user.name, user.avatarUrl, Date.now());
}

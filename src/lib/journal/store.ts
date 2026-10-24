import type { Pool } from "pg";
import { transaction, type Database } from "../db/postgres.ts";
import { isKind, isLogStatus, type LogEntry, type LogStatus } from "./types.ts";

export type JournalImportResult = {
  imported: boolean;
  entries: LogEntry[];
};

export type JournalRepo = {
  list: (userId: string) => Promise<LogEntry[]>;
  take: (userId: string, entry: LogEntry) => Promise<LogEntry[]>;
  setStatus: (userId: string, id: string, status: LogStatus) => Promise<LogEntry[] | null>;
  drop: (userId: string, id: string) => Promise<LogEntry[] | null>;
  importIfEmpty: (userId: string, entries: LogEntry[]) => Promise<JournalImportResult>;
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
    async list(userId) {
      return list(userId);
    },
    async take(userId, entry) {
      const current = byUser.get(userId) ?? [];
      if (current.some((item) => item.id === entry.id)) return list(userId);
      byUser.set(userId, [clone(entry), ...current]);
      return list(userId);
    },
    async setStatus(userId, id, status) {
      const current = byUser.get(userId);
      if (!current?.some((item) => item.id === id)) return null;
      byUser.set(
        userId,
        current.map((item) => (item.id === id ? { ...item, status } : item)),
      );
      return list(userId);
    },
    async drop(userId, id) {
      const current = byUser.get(userId);
      if (!current?.some((item) => item.id === id)) return null;
      byUser.set(
        userId,
        current.filter((item) => item.id !== id),
      );
      return list(userId);
    },
    async importIfEmpty(userId, entries) {
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
  is_pr: boolean;
  status: string;
  taken_at: number;
};

export function createPostgresJournal(pool: Pool): JournalRepo {
  async function list(db: Database, userId: string) {
    const result = await db.query<JournalRow>(
      `SELECT * FROM journal WHERE user_id = $1 ORDER BY taken_at DESC, mission_id ASC`,
      [userId],
    );
    return result.rows.flatMap((row): LogEntry[] => {
      if (!isKind(row.kind) || !isLogStatus(row.status)) return [];
      return [
        {
          id: row.mission_id,
          owner: row.owner,
          repo: row.repo,
          number: row.number,
          title: row.title,
          kind: row.kind,
          url: row.url,
          isPr: row.is_pr,
          status: row.status,
          takenAt: row.taken_at,
        },
      ];
    });
  }
  async function insert(db: Database, userId: string, entry: LogEntry) {
    await db.query(
      `INSERT INTO journal
      (user_id, mission_id, owner, repo, number, title, kind, url, is_pr, status, taken_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
      [
        userId,
        entry.id,
        entry.owner,
        entry.repo,
        entry.number,
        entry.title,
        entry.kind,
        entry.url,
        entry.isPr,
        entry.status,
        entry.takenAt,
      ],
    );
  }
  return {
    list: (userId) => list(pool, userId),
    take: (userId, entry) =>
      transaction(pool, `journal:${userId}`, async (db) => {
        await insert(db, userId, entry);
        return list(db, userId);
      }),
    setStatus: (userId, id, status) =>
      transaction(pool, `journal:${userId}`, async (db) => {
        const result = await db.query(
          "UPDATE journal SET status = $1 WHERE user_id = $2 AND mission_id = $3",
          [status, userId, id],
        );
        return result.rowCount ? list(db, userId) : null;
      }),
    drop: (userId, id) =>
      transaction(pool, `journal:${userId}`, async (db) => {
        const result = await db.query(
          "DELETE FROM journal WHERE user_id = $1 AND mission_id = $2",
          [userId, id],
        );
        return result.rowCount ? list(db, userId) : null;
      }),
    importIfEmpty: (userId, entries) =>
      transaction(pool, `journal:${userId}`, async (db) => {
        const current = await list(db, userId);
        if (current.length) return { imported: false, entries: current };
        for (const entry of uniqueEntries(entries)) await insert(db, userId, entry);
        return { imported: true, entries: await list(db, userId) };
      }),
  };
}

export async function upsertUser(
  db: Database,
  user: { id: string; login: string; name: string; avatarUrl: string },
) {
  await db.query(
    `INSERT INTO users (id, login, name, avatar_url, created_at)
    VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET
    login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url`,
    [user.id, user.login, user.name, user.avatarUrl, Date.now()],
  );
}

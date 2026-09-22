import type { DatabaseSync } from "node:sqlite";
import type { UsageEvent } from "./types.ts";

export type UsageRepo = {
  list: (userId: string) => UsageEvent[];
  record: (userId: string, event: UsageEvent) => UsageEvent[];
};

function clone(event: UsageEvent): UsageEvent {
  return { ...event };
}

export function createMemoryUsage(): UsageRepo {
  const byUser = new Map<string, UsageEvent[]>();

  function list(userId: string) {
    return (byUser.get(userId) ?? [])
      .slice()
      .sort((a, b) => b.at - a.at)
      .map(clone);
  }

  return {
    list,
    record(userId, event) {
      const current = byUser.get(userId) ?? [];
      byUser.set(userId, [clone(event), ...current]);
      return list(userId);
    },
  };
}

type UsageRow = {
  at: number;
  harness: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  mission_id: string | null;
};

function rowToEvent(row: UsageRow): UsageEvent {
  const event: UsageEvent = {
    at: row.at,
    harness: row.harness,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
  };
  if (row.mission_id) event.missionId = row.mission_id;
  return event;
}

export function createSqliteUsage(db: DatabaseSync): UsageRepo {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      at INTEGER NOT NULL,
      harness TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      mission_id TEXT
    );
    CREATE INDEX IF NOT EXISTS usage_events_user_at
      ON usage_events (user_id, at);
  `);

  const listStmt = db.prepare(
    `SELECT at, harness, model, input_tokens, output_tokens, mission_id
     FROM usage_events WHERE user_id = ? ORDER BY at DESC, id DESC`,
  );
  const insertStmt = db.prepare(
    `INSERT INTO usage_events
      (user_id, at, harness, model, input_tokens, output_tokens, mission_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  function list(userId: string) {
    return (listStmt.all(userId) as UsageRow[]).map(rowToEvent);
  }

  return {
    list,
    record(userId, event) {
      insertStmt.run(
        userId,
        event.at,
        event.harness,
        event.model,
        event.inputTokens,
        event.outputTokens,
        event.missionId ?? null,
      );
      return list(userId);
    },
  };
}

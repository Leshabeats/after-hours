import type { Pool } from "pg";
import { transaction, type Database } from "../db/postgres.ts";
import type { UsageEvent } from "./types.ts";

export type UsageRepo = {
  list: (userId: string) => Promise<UsageEvent[]>;
  record: (userId: string, event: UsageEvent) => Promise<UsageEvent[]>;
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
    async list(userId) {
      return list(userId);
    },
    async record(userId, event) {
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

export function createPostgresUsage(pool: Pool): UsageRepo {
  async function list(db: Database, userId: string): Promise<UsageEvent[]> {
    const result = await db.query<UsageRow>(
      "SELECT * FROM usage_events WHERE user_id = $1 ORDER BY at DESC, id DESC",
      [userId],
    );
    return result.rows.map((row) => ({
      at: row.at,
      harness: row.harness,
      model: row.model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      ...(row.mission_id ? { missionId: row.mission_id } : {}),
    }));
  }
  return {
    list: (userId) => list(pool, userId),
    record: (userId, event) =>
      transaction(pool, `usage:${userId}`, async (db) => {
        await db.query(
          `INSERT INTO usage_events
        (user_id, at, harness, model, input_tokens, output_tokens, mission_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            userId,
            event.at,
            event.harness,
            event.model,
            event.inputTokens,
            event.outputTokens,
            event.missionId ?? null,
          ],
        );
        return list(db, userId);
      }),
  };
}

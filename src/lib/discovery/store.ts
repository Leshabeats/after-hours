import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { transaction, type Database } from "../db/postgres.ts";
import { protectCounts } from "./measurements.ts";
import type {
  DailyMetric,
  DiscoverySnapshot,
  DiscoveryStore,
  Lease,
  Observation,
  StoredRepository,
} from "./types.ts";

const DAY = 86_400_000;
const RETAIN_DAYS = 90;
const RETAIN_RUNS = 30;
const LOCK = "discovery:sync";

export class DiscoveryLeaseLostError extends Error {
  constructor() {
    super("Discovery lease expired or was replaced.");
    this.name = "DiscoveryLeaseLostError";
  }
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

function timestamp(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || Number.isNaN(new Date(value).getTime())) {
    throw new RangeError("Invalid discovery timestamp.");
  }
}

function leaseEnd(now: number, leaseMs: number) {
  timestamp(now);
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0)
    throw new RangeError("Invalid discovery lease duration.");
  timestamp(now + leaseMs);
  return now + leaseMs;
}

function day(value: number) {
  timestamp(value);
  return new Date(value).toISOString().slice(0, 10);
}

function countsTime(observation: Observation) {
  const at = observation.countsObservedAt ?? observation.observedAt;
  timestamp(at);
  if (at > observation.observedAt)
    throw new RangeError("Counts measurement is newer than observation.");
  return at;
}

function cutoff(now: number) {
  return Math.max(0, Math.floor(now / DAY) * DAY - (RETAIN_DAYS - 1) * DAY);
}

function publicSnapshot(
  snapshot: DiscoverySnapshot | null,
  blockedIds: Iterable<string> = [],
): DiscoverySnapshot | null {
  if (!snapshot) return null;
  const blocked = new Set(blockedIds);
  return {
    ...copy(snapshot),
    cards: snapshot.cards
      .filter((card) => card.isPublic === true && !blocked.has(card.id))
      .map(copy),
  };
}

function merge(previous: StoredRepository | undefined, observed: Observation): StoredRepository {
  // Nonpublic input can only revoke eligibility; it cannot introduce metadata or metrics.
  if (observed.isPublic !== true) {
    const known = previous?.isPublic === true ? previous : undefined;
    observed = {
      ...observed,
      isPublic: false,
      disabled: true,
      owner: known?.owner ?? "unavailable",
      repo: known?.repo ?? "unavailable",
      description: known?.description ?? "",
      topics: [],
      tags: [],
      language: null,
      stars: known?.stars ?? 0,
      forks: known?.forks ?? 0,
      pushedAt: null,
      createdAt: previous?.createdAt ?? observed.observedAt,
      source: "excluded",
      releaseAt: null,
      mergedPrs: null,
      activityCheckedAt: null,
      countsObservedAt: previous ? countsTime(previous) : countsTime(observed),
      countsSource: undefined,
      countsScanId: undefined,
      countsMeasured: false,
    };
  }
  if (previous && previous.observedAt > observed.observedAt) return previous;
  const keepActivity =
    previous?.isPublic === true &&
    observed.isPublic === true &&
    observed.activityCheckedAt === null;
  return {
    ...copy(observed),
    firstSeenAt: previous?.firstSeenAt ?? observed.observedAt,
    releaseAt: keepActivity ? previous.releaseAt : observed.releaseAt,
    mergedPrs: keepActivity ? previous.mergedPrs : observed.mergedPrs,
    activityCheckedAt: keepActivity ? previous.activityCheckedAt : observed.activityCheckedAt,
  };
}

type State = {
  current_run_id: string | null;
  published_run_id: string | null;
  fence: number;
  lease_until: number | null;
  retry_at: number | null;
};

function requireLease(state: State, lease: Lease, now: number) {
  timestamp(now);
  if (
    state.current_run_id !== lease.runId ||
    String(state.fence) !== lease.token ||
    state.lease_until == null ||
    state.lease_until <= now
  )
    throw new DiscoveryLeaseLostError();
}

// State transitions: idle -> running -> completed (publish), or running -> interrupted
// (release/expiry). Acquire resumes interrupted work with a new fence. Every mutation
// checks ownership while holding the same transaction lock; network work belongs outside.
export function createPostgresDiscovery(pool: Pool): DiscoveryStore {
  const locked = <T>(work: (db: Database) => Promise<T>) => transaction(pool, LOCK, work);
  async function state(db: Database) {
    const row = (await db.query<State>("SELECT * FROM discovery_sync_state WHERE id = 1")).rows[0];
    if (!row) throw new Error("Discovery schema is missing. Run db:migrate.");
    return row;
  }
  async function retain(db: Database, now: number) {
    await db.query("DELETE FROM discovery_daily_metrics WHERE day < $1::date", [day(cutoff(now))]);
    await db.query(
      `DELETE FROM discovery_runs WHERE status = 'completed'
      AND id <> COALESCE((SELECT published_run_id FROM discovery_sync_state WHERE id = 1), '')
      AND id NOT IN (SELECT id FROM discovery_runs WHERE status = 'completed'
        ORDER BY completed_at DESC, id COLLATE "C" LIMIT $1)`,
      [RETAIN_RUNS],
    );
  }
  return {
    acquire: (now, leaseMs) =>
      locked(async (db) => {
        const until = leaseEnd(now, leaseMs);
        const current = await state(db);
        if (
          (current.retry_at != null && current.retry_at > now) ||
          (current.lease_until != null && current.lease_until > now)
        )
          return null;
        const runId = current.current_run_id ?? randomUUID();
        await db.query(
          `INSERT INTO discovery_runs (id,status,started_at,updated_at)
        VALUES ($1,'running',$2,$2) ON CONFLICT (id) DO UPDATE SET status = 'running', updated_at = $2, error = NULL`,
          [runId, now],
        );
        const run = (
          await db.query<{ checkpoint: unknown }>(
            "SELECT checkpoint FROM discovery_runs WHERE id = $1",
            [runId],
          )
        ).rows[0]!;
        const next = (
          await db.query<{ fence: number }>(
            `UPDATE discovery_sync_state SET
        current_run_id = $1, fence = fence + 1, lease_until = $2, retry_at = NULL WHERE id = 1 RETURNING fence`,
            [runId, until],
          )
        ).rows[0]!;
        return { runId, token: String(next.fence), checkpoint: copy(run.checkpoint) };
      }),
    save: (lease, now, leaseMs, observations, checkpoint) =>
      locked(async (db) => {
        const until = leaseEnd(now, leaseMs);
        const current = await state(db);
        requireLease(current, lease, now);
        const savedCheckpoint = JSON.stringify(checkpoint ?? null);
        for (let observation of observations) {
          timestamp(observation.observedAt);
          countsTime(observation);
          const old = (
            await db.query<{ observation: StoredRepository; first_seen_at: number }>(
              "SELECT observation,first_seen_at FROM discovery_repositories WHERE id = $1",
              [observation.id],
            )
          ).rows[0];
          const previous = old ? { ...old.observation, firstSeenAt: old.first_seen_at } : undefined;
          observation = protectCounts(previous, observation);
          const measuredAt = countsTime(observation);
          const next = merge(previous, observation);
          await db.query(
            `INSERT INTO discovery_repositories (id,first_seen_at,observed_at,observation)
          VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET
          observed_at = excluded.observed_at, observation = excluded.observation
          WHERE excluded.observed_at >= discovery_repositories.observed_at`,
            [observation.id, next.firstSeenAt, next.observedAt, JSON.stringify(next)],
          );
          if (
            observation.isPublic === true &&
            observation.countsMeasured === true &&
            observation.countsSource === "repository" &&
            measuredAt === observation.observedAt &&
            measuredAt >= cutoff(now)
          ) {
            await db.query(
              `INSERT INTO discovery_daily_metrics (repo_id,day,observed_at,stars,forks)
            VALUES ($1,$2::date,$3,$4,$5) ON CONFLICT (repo_id,day) DO UPDATE SET
            observed_at = excluded.observed_at, stars = excluded.stars, forks = excluded.forks
            WHERE excluded.observed_at >= discovery_daily_metrics.observed_at`,
              [
                observation.id,
                day(observation.observedAt),
                observation.observedAt,
                observation.stars,
                observation.forks,
              ],
            );
          }
        }
        await db.query("UPDATE discovery_runs SET checkpoint = $2, updated_at = $3 WHERE id = $1", [
          lease.runId,
          savedCheckpoint,
          now,
        ]);
        await db.query(
          "UPDATE discovery_sync_state SET lease_until = GREATEST(lease_until,$1) WHERE id = 1",
          [until],
        );
        await retain(db, now);
      }),
    release: (lease, now, error, retryAt) =>
      locked(async (db) => {
        const current = await state(db);
        requireLease(current, lease, now);
        if (retryAt != null) timestamp(retryAt);
        await db.query(
          "UPDATE discovery_runs SET status = 'interrupted', error = $2, updated_at = $3 WHERE id = $1",
          [lease.runId, error.slice(0, 2000), now],
        );
        await db.query(
          "UPDATE discovery_sync_state SET lease_until = NULL, retry_at = $1 WHERE id = 1",
          [retryAt ?? null],
        );
      }),
    publish: (lease, now, snapshot) =>
      locked(async (db) => {
        const current = await state(db);
        requireLease(current, lease, now);
        const blocked = (
          await db.query<{ id: string }>(
            "SELECT id FROM discovery_repositories WHERE observation->>'isPublic' IS DISTINCT FROM 'true'",
          )
        ).rows.map((r) => r.id);
        await db.query(
          `UPDATE discovery_runs SET status = 'completed', snapshot = $2,
        completed_at = $3, updated_at = $3, error = NULL WHERE id = $1 AND status = 'running'`,
          [lease.runId, JSON.stringify(publicSnapshot(snapshot, blocked)), now],
        );
        await db.query(
          `UPDATE discovery_sync_state SET published_run_id = $1,
        current_run_id = NULL, lease_until = NULL, retry_at = NULL WHERE id = 1`,
          [lease.runId],
        );
        await retain(db, now);
      }),
    async repositories() {
      return (
        await pool.query<{ observation: StoredRepository; first_seen_at: number }>(
          'SELECT observation,first_seen_at FROM discovery_repositories ORDER BY id COLLATE "C"',
        )
      ).rows.map((row) => ({ ...row.observation, firstSeenAt: row.first_seen_at }));
    },
    async metrics(since) {
      timestamp(since);
      return (
        await pool.query<DailyMetric>(
          `SELECT repo_id AS "repoId", observed_at AS "observedAt", stars,forks
        FROM discovery_daily_metrics WHERE observed_at >= $1 ORDER BY observed_at,repo_id COLLATE "C"`,
          [since],
        )
      ).rows;
    },
    async snapshot() {
      const row = (
        await pool.query<{ snapshot: DiscoverySnapshot; blocked_ids: string[] }>(`
        SELECT r.snapshot, ARRAY(SELECT id FROM discovery_repositories
          WHERE observation->>'isPublic' IS DISTINCT FROM 'true') AS blocked_ids
        FROM discovery_runs r JOIN discovery_sync_state s ON s.published_run_id = r.id
        WHERE s.id = 1 AND r.status = 'completed'`)
      ).rows[0];
      return publicSnapshot(row?.snapshot ?? null, row?.blocked_ids);
    },
  };
}

export function createMemoryDiscovery(): DiscoveryStore {
  const repositories = new Map<string, StoredRepository>();
  const metrics = new Map<string, DailyMetric>();
  const state: State = {
    current_run_id: null,
    published_run_id: null,
    fence: 0,
    lease_until: null,
    retry_at: null,
  };
  const runs = new Map<
    string,
    { checkpoint: unknown; snapshot: DiscoverySnapshot | null; completedAt: number | null }
  >();
  function retain(now: number) {
    for (const [key, metric] of metrics) if (metric.observedAt < cutoff(now)) metrics.delete(key);
    const completed = [...runs]
      .filter(([, run]) => run.completedAt != null)
      .sort(([a, x], [b, y]) => y.completedAt! - x.completedAt! || a.localeCompare(b));
    for (const [id] of completed.slice(RETAIN_RUNS))
      if (id !== state.published_run_id) runs.delete(id);
  }
  return {
    async acquire(now, leaseMs) {
      const until = leaseEnd(now, leaseMs);
      if (
        (state.retry_at != null && state.retry_at > now) ||
        (state.lease_until != null && state.lease_until > now)
      )
        return null;
      const runId = state.current_run_id ?? randomUUID();
      const run = runs.get(runId) ?? { checkpoint: null, snapshot: null, completedAt: null };
      runs.set(runId, run);
      state.current_run_id = runId;
      state.fence += 1;
      state.lease_until = until;
      state.retry_at = null;
      return { runId, token: String(state.fence), checkpoint: copy(run.checkpoint) };
    },
    async save(lease, now, leaseMs, observations, checkpoint) {
      const until = leaseEnd(now, leaseMs);
      requireLease(state, lease, now);
      const savedCheckpoint = copy(checkpoint ?? null);
      // Plan the full batch before writing, matching PostgreSQL transaction rollback.
      const nextRepos = new Map(repositories);
      const nextMetrics = new Map(metrics);
      for (let observation of observations) {
        timestamp(observation.observedAt);
        countsTime(observation);
        observation = protectCounts(nextRepos.get(observation.id), observation);
        const measuredAt = countsTime(observation);
        nextRepos.set(observation.id, merge(nextRepos.get(observation.id), observation));
        if (
          observation.isPublic !== true ||
          observation.countsMeasured !== true ||
          observation.countsSource !== "repository" ||
          measuredAt !== observation.observedAt ||
          measuredAt < cutoff(now)
        )
          continue;
        const key = `${observation.id}:${day(observation.observedAt)}`;
        const previous = nextMetrics.get(key);
        if (!previous || previous.observedAt <= observation.observedAt)
          nextMetrics.set(key, {
            repoId: observation.id,
            observedAt: observation.observedAt,
            stars: observation.stars,
            forks: observation.forks,
          });
      }
      repositories.clear();
      for (const [key, value] of nextRepos) repositories.set(key, value);
      metrics.clear();
      for (const [key, value] of nextMetrics) metrics.set(key, value);
      runs.get(lease.runId)!.checkpoint = savedCheckpoint;
      state.lease_until = Math.max(state.lease_until!, until);
      retain(now);
    },
    async release(lease, now, error, retryAt) {
      requireLease(state, lease, now);
      if (retryAt != null) timestamp(retryAt);
      void error;
      state.lease_until = null;
      state.retry_at = retryAt ?? null;
    },
    async publish(lease, now, snapshot) {
      requireLease(state, lease, now);
      const saved = publicSnapshot(
        snapshot,
        [...repositories.values()].filter((r) => r.isPublic !== true).map((r) => r.id),
      );
      runs.get(lease.runId)!.snapshot = saved;
      runs.get(lease.runId)!.completedAt = now;
      state.published_run_id = lease.runId;
      state.current_run_id = null;
      state.lease_until = null;
      state.retry_at = null;
      retain(now);
    },
    async repositories() {
      return [...repositories.values()]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(copy);
    },
    async metrics(since) {
      timestamp(since);
      return [...metrics.values()]
        .filter((metric) => metric.observedAt >= since)
        .sort(
          (a, b) =>
            a.observedAt - b.observedAt || (a.repoId < b.repoId ? -1 : a.repoId > b.repoId ? 1 : 0),
        )
        .map(copy);
    },
    async snapshot() {
      return publicSnapshot(
        state.published_run_id ? (runs.get(state.published_run_id)?.snapshot ?? null) : null,
        [...repositories.values()].filter((r) => r.isPublic !== true).map((r) => r.id),
      );
    },
  };
}

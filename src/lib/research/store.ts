import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { transaction, type Database } from "../db/postgres.ts";
import {
  buildAuthorBoard,
  buildMissionBoard,
  type AuthorBoard,
  type MissionBoard,
  type ReportAuthor,
} from "./catalog.ts";
import type {
  ConnectorGrant,
  LimitSnapshot,
  ResearchDelivery,
  ResearchReport,
  ResearchRun,
  ResearchTurn,
  TurnUsage,
} from "./types.ts";
import { emptyUsage } from "./types.ts";
import { upsertUser } from "../journal/store.ts";
import type { WatchRun } from "./github-watch.ts";
import { refreshWatch } from "./github-sync.ts";
import { createMemoryWatch, createPostgresWatch } from "./watch-book.ts";

export type IngestResult =
  | { ok: true; replay: boolean; run: ResearchRun }
  | { ok: false; error: "forbidden" | "conflict" | "invalid" };

export type PublishResult = "updated" | "missing" | "blocked";

export type ResearchAuthor = ReportAuthor & { id: string };

export type ResearchRepo = {
  createGrant: (userId: string, at: number) => Promise<{ grant: ConnectorGrant; token: string }>;
  listGrants: (userId: string) => Promise<ConnectorGrant[]>;
  revokeGrant: (userId: string, grantId: string, at: number) => Promise<ConnectorGrant[] | null>;
  authenticate: (token: string) => Promise<{ userId: string; grantId: string } | null>;
  markUsed: (grantId: string, at: number) => Promise<void>;
  ingest: (userId: string, delivery: ResearchDelivery) => Promise<IngestResult>;
  readRun: (userId: string, threadId: string) => Promise<ResearchRun | null>;
  readLimit: (userId: string) => Promise<LimitSnapshot | null>;
  upsertAuthor: (user: ResearchAuthor) => Promise<void>;
  missionBoard: (
    owner: string,
    repo: string,
    number: number,
    viewerId: string | null,
  ) => Promise<MissionBoard>;
  authorBoard: (login: string, viewerId: string | null) => Promise<AuthorBoard>;
  setPublished: (
    userId: string,
    runId: string,
    published: boolean,
    at: number,
  ) => Promise<PublishResult>;
  refreshGithub: (
    runIds: readonly string[],
    now?: number,
    fetchImpl?: typeof fetch,
  ) => Promise<void>;
};

type StoredRun = ResearchRun & { deliveryHash: string };

type GrantRecord = ConnectorGrant & { userId: string; tokenHash: string };

type Decision =
  | { kind: "invalid" }
  | { kind: "forbidden" }
  | { kind: "conflict" }
  | { kind: "replay"; run: StoredRun }
  | { kind: "apply"; run: StoredRun };

function newId(prefix: string) {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function tokenMatches(token: string, hashHex: string) {
  const got = createHash("sha256").update(token).digest();
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== got.length) return false;
  return timingSafeEqual(got, expected);
}

function cloneUsage(usage: TurnUsage): TurnUsage {
  return { ...usage };
}

function cloneTurn(turn: ResearchTurn): ResearchTurn {
  return { ...turn, usage: cloneUsage(turn.usage) };
}

function cloneReport(report: ResearchReport): ResearchReport {
  return {
    ...report,
    evidence: [...report.evidence],
    unknowns: [...report.unknowns],
    nextSteps: [...report.nextSteps],
    links: report.links.map((link) => ({ ...link })),
  };
}

function cloneRun(run: StoredRun): StoredRun {
  return {
    ...run,
    report: run.report ? cloneReport(run.report) : null,
    turns: run.turns.map(cloneTurn),
  };
}

function toPublic(run: StoredRun): ResearchRun {
  const { deliveryHash, ...rest } = cloneRun(run);
  void deliveryHash;
  return rest;
}

function cloneLimit(limit: LimitSnapshot): LimitSnapshot {
  return {
    readAt: limit.readAt,
    primary: limit.primary ? { ...limit.primary } : null,
    secondary: limit.secondary ? { ...limit.secondary } : null,
    spendControlReached: limit.spendControlReached,
    individualRemainingPercent: limit.individualRemainingPercent,
  };
}

function publicGrant(grant: GrantRecord): ConnectorGrant {
  return {
    id: grant.id,
    createdAt: grant.createdAt,
    revokedAt: grant.revokedAt,
    lastUsedAt: grant.lastUsedAt,
  };
}

function deliveryHash(delivery: ResearchDelivery) {
  const turns = delivery.turns
    .map((turn) => ({
      turnId: turn.turnId,
      status: turn.status,
      usageKnown: turn.usageKnown,
      inputTokens: turn.usage.inputTokens,
      cachedInputTokens: turn.usage.cachedInputTokens,
      outputTokens: turn.usage.outputTokens,
      reasoningOutputTokens: turn.usage.reasoningOutputTokens,
      totalTokens: turn.usage.totalTokens,
    }))
    .sort((a, b) => (a.turnId < b.turnId ? -1 : a.turnId > b.turnId ? 1 : 0));
  return JSON.stringify({
    threadId: delivery.threadId,
    missionId: delivery.missionId,
    isPr: delivery.isPr,
    status: delivery.status,
    model: delivery.model ?? null,
    report: delivery.report ?? null,
    turns,
  });
}

function normalizeTurn(turn: ResearchTurn): ResearchTurn {
  return {
    turnId: turn.turnId,
    status: turn.status,
    usageKnown: turn.usageKnown,
    usage: turn.usageKnown ? cloneUsage(turn.usage) : emptyUsage(),
    updatedAt: turn.updatedAt,
  };
}

function mergeTurns(current: readonly ResearchTurn[], incoming: readonly ResearchTurn[]) {
  const byId = new Map(current.map((turn) => [turn.turnId, cloneTurn(turn)]));
  for (const turn of incoming) byId.set(turn.turnId, normalizeTurn(turn));
  return [...byId.values()].sort((a, b) =>
    a.turnId < b.turnId ? -1 : a.turnId > b.turnId ? 1 : 0,
  );
}

function planIngest(
  existing: StoredRun | null,
  userId: string,
  delivery: ResearchDelivery,
  runId: string,
): Decision {
  if (delivery.status === "completed" && !delivery.report) return { kind: "invalid" };
  const turnIds = new Set<string>();
  for (const turn of delivery.turns) {
    if (turnIds.has(turn.turnId)) return { kind: "invalid" };
    turnIds.add(turn.turnId);
  }
  if (existing && existing.userId !== userId) return { kind: "forbidden" };
  if (existing && (existing.missionId !== delivery.missionId || existing.isPr !== delivery.isPr)) {
    return { kind: "conflict" };
  }

  const hash = deliveryHash(delivery);
  if (existing && existing.deliveryHash === hash) {
    return { kind: "replay", run: cloneRun(existing) };
  }
  if (existing?.status === "completed") return { kind: "conflict" };

  // A report on a run that is still waiting, interrupted, or in progress is not stored.
  // Publication sticks: a later delivery does not clear publishedAt.
  const report =
    delivery.status === "completed" && delivery.report
      ? cloneReport(delivery.report)
      : existing?.report
        ? cloneReport(existing.report)
        : null;
  const publishedAt =
    existing?.publishedAt != null
      ? existing.publishedAt
      : delivery.status === "completed" && report
        ? delivery.at
        : null;

  return {
    kind: "apply",
    run: {
      id: existing?.id ?? runId,
      userId,
      missionId: delivery.missionId,
      owner: delivery.owner,
      repo: delivery.repo,
      number: delivery.number,
      isPr: delivery.isPr,
      threadId: delivery.threadId,
      status: delivery.status,
      model: delivery.model === undefined ? (existing?.model ?? null) : delivery.model,
      report,
      publishedAt,
      createdAt: existing?.createdAt ?? delivery.at,
      updatedAt: delivery.at,
      turns: mergeTurns(existing?.turns ?? [], delivery.turns),
      deliveryHash: hash,
    },
  };
}

function compareGrants(a: GrantRecord, b: GrantRecord) {
  return b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1);
}

function publishRun(run: StoredRun, published: boolean, at: number): PublishResult {
  if (published) {
    if (run.status !== "completed" || run.report == null) return "blocked";
    run.publishedAt = at;
  } else {
    run.publishedAt = null;
  }
  run.updatedAt = at;
  return "updated";
}

export function createMemoryResearch(): ResearchRepo {
  const grants: GrantRecord[] = [];
  const runs: StoredRun[] = [];
  const limits = new Map<string, LimitSnapshot>();
  const authors = new Map<string, ResearchAuthor>();
  const book = createMemoryWatch(() => newId("gh"));

  function watchOf(run: StoredRun): { run: WatchRun; researcherLogin: string } {
    return {
      run: {
        id: run.id,
        owner: run.owner,
        repo: run.repo,
        number: run.number,
        isPr: run.isPr,
        publishedAt: run.publishedAt,
        status: run.status,
        report: run.report,
      },
      researcherLogin: authors.get(run.userId)?.login ?? "",
    };
  }

  function listGrants(userId: string) {
    return grants
      .filter((grant) => grant.userId === userId)
      .sort(compareGrants)
      .map(publicGrant);
  }

  function rememberLimit(userId: string, delivery: ResearchDelivery) {
    if (delivery.limit && delivery.limit.readAt >= (limits.get(userId)?.readAt ?? -Infinity)) {
      limits.set(userId, cloneLimit(delivery.limit));
    }
  }

  return {
    async createGrant(userId, at) {
      const token = `ahc_${randomBytes(32).toString("base64url")}`;
      const grant: GrantRecord = {
        id: newId("gr"),
        userId,
        tokenHash: hashToken(token),
        createdAt: at,
        revokedAt: null,
        lastUsedAt: null,
      };
      grants.push(grant);
      return { grant: publicGrant(grant), token };
    },
    async listGrants(userId) {
      return listGrants(userId);
    },
    async revokeGrant(userId, grantId, at) {
      const grant = grants.find((item) => item.id === grantId);
      if (!grant || grant.userId !== userId) return null;
      if (grant.revokedAt == null) grant.revokedAt = at;
      return listGrants(userId);
    },
    async authenticate(token) {
      const hash = hashToken(token);
      const grant = grants.find((item) => item.tokenHash === hash);
      if (!grant || grant.revokedAt != null || !tokenMatches(token, grant.tokenHash)) {
        return null;
      }
      return { userId: grant.userId, grantId: grant.id };
    },
    async markUsed(grantId, at) {
      const grant = grants.find((item) => item.id === grantId);
      if (!grant || grant.revokedAt != null) return;
      grant.lastUsedAt = at;
    },
    async ingest(userId, delivery) {
      const existing = runs.find((run) => run.threadId === delivery.threadId) ?? null;
      const decision = planIngest(existing, userId, delivery, newId("run"));
      if (decision.kind === "invalid" || decision.kind === "forbidden") {
        return { ok: false, error: decision.kind };
      }
      rememberLimit(userId, delivery);
      if (decision.kind === "conflict") return { ok: false, error: "conflict" };
      if (decision.kind === "replay") {
        return { ok: true, replay: true, run: toPublic(decision.run) };
      }
      const stored = cloneRun(decision.run);
      const index = runs.findIndex((run) => run.threadId === stored.threadId);
      if (index === -1) runs.push(stored);
      else runs[index] = stored;
      return { ok: true, replay: false, run: toPublic(stored) };
    },
    async readRun(userId, threadId) {
      const run = runs.find((item) => item.threadId === threadId && item.userId === userId);
      return run ? toPublic(run) : null;
    },
    async readLimit(userId) {
      const limit = limits.get(userId);
      return limit ? cloneLimit(limit) : null;
    },
    async upsertAuthor(user) {
      authors.set(user.id, {
        id: user.id,
        login: user.login,
        name: user.name,
        avatarUrl: user.avatarUrl,
      });
    },
    async missionBoard(owner, repo, number, viewerId) {
      const visible = runs.map(toPublic);
      return buildMissionBoard(
        visible,
        authors,
        { owner, repo, number },
        viewerId,
        await book.history(
          visible.map((run) => ({
            id: run.id,
            researcherLogin: authors.get(run.userId)?.login ?? "",
          })),
        ),
      );
    },
    async authorBoard(login, viewerId) {
      const key = login.trim().toLowerCase();
      const matched = [...authors.values()].filter((author) => author.login.toLowerCase() === key);
      const visible = runs.map(toPublic);
      return buildAuthorBoard(
        visible,
        matched,
        login,
        viewerId,
        await book.history(
          visible.map((run) => ({
            id: run.id,
            researcherLogin: authors.get(run.userId)?.login ?? "",
          })),
        ),
      );
    },
    async setPublished(userId, runId, published, at) {
      const run = runs.find((item) => item.id === runId && item.userId === userId);
      if (!run) return "missing";
      return publishRun(run, published, at);
    },
    async refreshGithub(runIds, now = Date.now(), fetchImpl = fetch) {
      await refreshWatch(
        {
          book,
          async runs(ids) {
            const wanted = new Set(ids);
            return runs.filter((run) => wanted.has(run.id)).map(watchOf);
          },
        },
        runIds,
        now,
        fetchImpl,
      );
    },
  };
}

// A single SELECT reads each run and all its turns from one PostgreSQL snapshot.
const runSelect = `SELECT r.id, r.user_id AS "userId", r.mission_id AS "missionId",
  r.owner, r.repo, r.number, r.is_pr AS "isPr", r.thread_id AS "threadId", r.status,
  r.model, r.report_json AS report, r.published_at AS "publishedAt",
  r.created_at AS "createdAt", r.updated_at AS "updatedAt", r.delivery_hash AS "deliveryHash",
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'turnId', t.turn_id, 'status', t.status, 'usageKnown', t.usage_known,
    'updatedAt', t.updated_at, 'usage', jsonb_build_object(
      'inputTokens', t.input_tokens, 'cachedInputTokens', t.cached_input_tokens,
      'outputTokens', t.output_tokens, 'reasoningOutputTokens', t.reasoning_output_tokens,
      'totalTokens', t.total_tokens)) ORDER BY t.turn_id COLLATE "C")
    FROM research_turns t WHERE t.run_id = r.id), '[]'::jsonb) AS turns
  FROM research_runs r`;
const authorSelect = `SELECT id, login, name, avatar_url AS "avatarUrl" FROM users`;
const grantSelect = `SELECT id, user_id AS "userId", token_hash AS "tokenHash",
  created_at AS "createdAt", revoked_at AS "revokedAt", last_used_at AS "lastUsedAt"
  FROM connector_grants`;

export function createPostgresResearch(pool: Pool): ResearchRepo {
  const book = createPostgresWatch(pool, () => newId("gh"));
  async function loadRuns(db: Database, where: string, values: unknown[]): Promise<StoredRun[]> {
    return (await db.query<StoredRun>(`${runSelect} ${where}`, values)).rows;
  }
  async function loadRun(db: Database, threadId: string) {
    return (await loadRuns(db, "WHERE r.thread_id = $1", [threadId]))[0] ?? null;
  }
  async function listGrants(userId: string) {
    return (
      await pool.query<GrantRecord>(
        `${grantSelect} WHERE user_id = $1 ORDER BY created_at DESC, id COLLATE "C" ASC`,
        [userId],
      )
    ).rows.map(publicGrant);
  }
  async function authorsFor(runs: readonly ResearchRun[]) {
    const ids = [...new Set(runs.map((run) => run.userId))];
    const rows = (
      await pool.query<ResearchAuthor>(`${authorSelect} WHERE id = ANY($1::text[])`, [ids])
    ).rows;
    return new Map(rows.map((author) => [author.id, author]));
  }
  async function history(runs: readonly ResearchRun[], authors: Map<string, ReportAuthor>) {
    return book.history(
      runs.map((run) => ({ id: run.id, researcherLogin: authors.get(run.userId)?.login ?? "" })),
    );
  }
  async function rememberLimit(db: Database, userId: string, delivery: ResearchDelivery) {
    const limit = delivery.limit;
    if (!limit) return;
    await db.query(
      `INSERT INTO account_limit_snapshots
      (user_id, read_at, primary_used_percent, primary_window_mins, primary_resets_at,
       secondary_used_percent, secondary_window_mins, secondary_resets_at,
       spend_control_reached, individual_remaining_percent)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (user_id) DO UPDATE SET
      read_at = excluded.read_at, primary_used_percent = excluded.primary_used_percent,
      primary_window_mins = excluded.primary_window_mins, primary_resets_at = excluded.primary_resets_at,
      secondary_used_percent = excluded.secondary_used_percent, secondary_window_mins = excluded.secondary_window_mins,
      secondary_resets_at = excluded.secondary_resets_at, spend_control_reached = excluded.spend_control_reached,
      individual_remaining_percent = excluded.individual_remaining_percent
      WHERE excluded.read_at >= account_limit_snapshots.read_at`,
      [
        userId,
        limit.readAt,
        limit.primary?.usedPercent ?? null,
        limit.primary?.windowDurationMins ?? null,
        limit.primary?.resetsAt ?? null,
        limit.secondary?.usedPercent ?? null,
        limit.secondary?.windowDurationMins ?? null,
        limit.secondary?.resetsAt ?? null,
        limit.spendControlReached,
        limit.individualRemainingPercent,
      ],
    );
  }
  async function writeRun(db: Database, run: StoredRun) {
    await db.query(
      `INSERT INTO research_runs
      (id,user_id,mission_id,owner,repo,number,is_pr,thread_id,status,model,report_json,
       report_schema,published_at,delivery_hash,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (thread_id) DO UPDATE SET status = excluded.status, model = excluded.model,
      report_json = excluded.report_json, report_schema = excluded.report_schema,
      published_at = excluded.published_at, delivery_hash = excluded.delivery_hash, updated_at = excluded.updated_at`,
      [
        run.id,
        run.userId,
        run.missionId,
        run.owner,
        run.repo,
        run.number,
        run.isPr,
        run.threadId,
        run.status,
        run.model,
        run.report ? JSON.stringify(run.report) : null,
        run.report?.schemaVersion ?? null,
        run.publishedAt,
        run.deliveryHash,
        run.createdAt,
        run.updatedAt,
      ],
    );
    for (const turn of run.turns) {
      await db.query(
        `INSERT INTO research_turns
        (run_id,turn_id,status,usage_known,input_tokens,cached_input_tokens,output_tokens,
         reasoning_output_tokens,total_tokens,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (run_id,turn_id) DO UPDATE SET
        status = excluded.status, usage_known = excluded.usage_known, input_tokens = excluded.input_tokens,
        cached_input_tokens = excluded.cached_input_tokens, output_tokens = excluded.output_tokens,
        reasoning_output_tokens = excluded.reasoning_output_tokens, total_tokens = excluded.total_tokens,
        updated_at = excluded.updated_at`,
        [
          run.id,
          turn.turnId,
          turn.status,
          turn.usageKnown,
          turn.usageKnown ? turn.usage.inputTokens : null,
          turn.usageKnown ? turn.usage.cachedInputTokens : null,
          turn.usageKnown ? turn.usage.outputTokens : null,
          turn.usageKnown ? turn.usage.reasoningOutputTokens : null,
          turn.usageKnown ? turn.usage.totalTokens : null,
          turn.updatedAt,
        ],
      );
    }
  }
  return {
    async createGrant(userId, at) {
      const token = `ahc_${randomBytes(32).toString("base64url")}`;
      const grant: GrantRecord = {
        id: newId("gr"),
        userId,
        tokenHash: hashToken(token),
        createdAt: at,
        revokedAt: null,
        lastUsedAt: null,
      };
      await pool.query(
        `INSERT INTO connector_grants (id,user_id,token_hash,created_at)
        VALUES ($1,$2,$3,$4)`,
        [grant.id, userId, grant.tokenHash, at],
      );
      return { grant: publicGrant(grant), token };
    },
    listGrants,
    async revokeGrant(userId, grantId, at) {
      const result = await pool.query(
        `UPDATE connector_grants SET revoked_at = COALESCE(revoked_at,$3)
        WHERE user_id = $1 AND id = $2 RETURNING id`,
        [userId, grantId, at],
      );
      return result.rowCount ? listGrants(userId) : null;
    },
    async authenticate(token) {
      const grant = (
        await pool.query<GrantRecord>(`${grantSelect} WHERE token_hash = $1`, [hashToken(token)])
      ).rows[0];
      if (!grant || grant.revokedAt != null || !tokenMatches(token, grant.tokenHash)) return null;
      return { userId: grant.userId, grantId: grant.id };
    },
    async markUsed(grantId, at) {
      await pool.query(
        "UPDATE connector_grants SET last_used_at = $2 WHERE id = $1 AND revoked_at IS NULL",
        [grantId, at],
      );
    },
    ingest: (userId, delivery) =>
      transaction(pool, `research:${delivery.threadId}`, async (db): Promise<IngestResult> => {
        const existing = await loadRun(db, delivery.threadId);
        const decision = planIngest(existing, userId, delivery, newId("run"));
        if (decision.kind === "invalid" || decision.kind === "forbidden")
          return { ok: false, error: decision.kind };
        // Limit refreshes on a replay/conflict preserve the existing connector contract.
        await rememberLimit(db, userId, delivery);
        if (decision.kind === "conflict") return { ok: false, error: "conflict" };
        if (decision.kind === "replay")
          return { ok: true, replay: true, run: toPublic(decision.run) };
        await writeRun(db, decision.run);
        return { ok: true, replay: false, run: toPublic(decision.run) };
      }),
    async readRun(userId, threadId) {
      const run = await loadRun(pool, threadId);
      return run?.userId === userId ? toPublic(run) : null;
    },
    async readLimit(userId) {
      const row = (
        await pool.query<{
          read_at: number;
          primary_used_percent: number | null;
          primary_window_mins: number | null;
          primary_resets_at: number | null;
          secondary_used_percent: number | null;
          secondary_window_mins: number | null;
          secondary_resets_at: number | null;
          spend_control_reached: boolean | null;
          individual_remaining_percent: number | null;
        }>("SELECT * FROM account_limit_snapshots WHERE user_id = $1", [userId])
      ).rows[0];
      if (!row) return null;
      const window = (used: number | null, mins: number | null, resets: number | null) =>
        used == null && mins == null && resets == null
          ? null
          : { usedPercent: used, windowDurationMins: mins, resetsAt: resets };
      return {
        readAt: row.read_at,
        primary: window(row.primary_used_percent, row.primary_window_mins, row.primary_resets_at),
        secondary: window(
          row.secondary_used_percent,
          row.secondary_window_mins,
          row.secondary_resets_at,
        ),
        spendControlReached: row.spend_control_reached,
        individualRemainingPercent: row.individual_remaining_percent,
      };
    },
    async upsertAuthor(user) {
      await upsertUser(pool, user);
    },
    async missionBoard(owner, repo, number, viewerId) {
      const runs = (
        await loadRuns(
          pool,
          "WHERE lower(r.owner) = lower($1) AND lower(r.repo) = lower($2) AND r.number = $3",
          [owner, repo, number],
        )
      ).map(toPublic);
      const authors = await authorsFor(runs);
      return buildMissionBoard(
        runs,
        authors,
        { owner, repo, number },
        viewerId,
        await history(runs, authors),
      );
    },
    async authorBoard(login, viewerId) {
      const matched = (
        await pool.query<ResearchAuthor>(
          `${authorSelect} WHERE lower(login) = lower($1)
        ORDER BY created_at DESC, id COLLATE "C" ASC`,
          [login.trim()],
        )
      ).rows;
      const runs = (
        await loadRuns(pool, "WHERE r.user_id = ANY($1::text[])", [
          matched.map((author) => author.id),
        ])
      ).map(toPublic);
      const authors = await authorsFor(runs);
      return buildAuthorBoard(runs, matched, login, viewerId, await history(runs, authors));
    },
    async setPublished(userId, runId, published, at) {
      const found = (
        await pool.query<{ thread_id: string }>(
          "SELECT thread_id FROM research_runs WHERE id = $1 AND user_id = $2",
          [runId, userId],
        )
      ).rows[0];
      if (!found) return "missing";
      return transaction(pool, `research:${found.thread_id}`, async (db) => {
        const run = await loadRun(db, found.thread_id);
        if (!run || run.userId !== userId) return "missing";
        const decision = publishRun(run, published, at);
        if (decision === "updated")
          await db.query(
            "UPDATE research_runs SET published_at = $2, updated_at = $3 WHERE id = $1",
            [runId, run.publishedAt, run.updatedAt],
          );
        return decision;
      });
    },
    async refreshGithub(runIds, now = Date.now(), fetchImpl = fetch) {
      await refreshWatch(
        {
          book,
          async runs(ids) {
            const runs = await loadRuns(pool, "WHERE r.id = ANY($1::text[])", [ids]);
            const authors = await authorsFor(runs);
            return runs.map((run) => ({
              run,
              researcherLogin: authors.get(run.userId)?.login ?? "",
            }));
          },
        },
        runIds,
        now,
        fetchImpl,
      );
    },
  };
}

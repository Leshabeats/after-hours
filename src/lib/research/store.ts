import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
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
  LimitWindow,
  ResearchDelivery,
  ResearchReport,
  ResearchRun,
  ResearchTurn,
  RunStatus,
  TurnStatus,
  TurnUsage,
} from "./types.ts";
import { emptyUsage } from "./types.ts";
import { upsertUser } from "../journal/store.ts";
import type { WatchRun } from "./github-watch.ts";
import { refreshWatch } from "./github-sync.ts";
import { createMemoryWatch, createSqliteWatch } from "./watch-book.ts";

export type IngestResult =
  | { ok: true; replay: boolean; run: ResearchRun }
  | { ok: false; error: "forbidden" | "conflict" | "invalid" };

export type PublishResult = "updated" | "missing" | "blocked";

export type ResearchAuthor = ReportAuthor & { id: string };

export type ResearchRepo = {
  createGrant: (
    userId: string,
    at: number,
  ) => { grant: ConnectorGrant; token: string };
  listGrants: (userId: string) => ConnectorGrant[];
  revokeGrant: (
    userId: string,
    grantId: string,
    at: number,
  ) => ConnectorGrant[] | null;
  authenticate: (token: string) => { userId: string; grantId: string } | null;
  markUsed: (grantId: string, at: number) => void;
  ingest: (userId: string, delivery: ResearchDelivery) => IngestResult;
  readRun: (userId: string, threadId: string) => ResearchRun | null;
  readLimit: (userId: string) => LimitSnapshot | null;
  upsertAuthor: (user: ResearchAuthor) => void;
  missionBoard: (
    owner: string,
    repo: string,
    number: number,
    viewerId: string | null,
  ) => MissionBoard;
  authorBoard: (login: string, viewerId: string | null) => AuthorBoard;
  setPublished: (
    userId: string,
    runId: string,
    published: boolean,
    at: number,
  ) => PublishResult;
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

function mergeTurns(
  current: readonly ResearchTurn[],
  incoming: readonly ResearchTurn[],
) {
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
  if (
    existing &&
    (existing.missionId !== delivery.missionId || existing.isPr !== delivery.isPr)
  ) {
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
    if (delivery.limit) limits.set(userId, cloneLimit(delivery.limit));
  }

  return {
    createGrant(userId, at) {
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
    listGrants,
    revokeGrant(userId, grantId, at) {
      const grant = grants.find((item) => item.id === grantId);
      if (!grant || grant.userId !== userId) return null;
      if (grant.revokedAt == null) grant.revokedAt = at;
      return listGrants(userId);
    },
    authenticate(token) {
      const hash = hashToken(token);
      const grant = grants.find((item) => item.tokenHash === hash);
      if (!grant || grant.revokedAt != null || !tokenMatches(token, grant.tokenHash)) {
        return null;
      }
      return { userId: grant.userId, grantId: grant.id };
    },
    markUsed(grantId, at) {
      const grant = grants.find((item) => item.id === grantId);
      if (!grant || grant.revokedAt != null) return;
      grant.lastUsedAt = at;
    },
    ingest(userId, delivery) {
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
    readRun(userId, threadId) {
      const run = runs.find((item) => item.threadId === threadId && item.userId === userId);
      return run ? toPublic(run) : null;
    },
    readLimit(userId) {
      const limit = limits.get(userId);
      return limit ? cloneLimit(limit) : null;
    },
    upsertAuthor(user) {
      authors.set(user.id, {
        id: user.id,
        login: user.login,
        name: user.name,
        avatarUrl: user.avatarUrl,
      });
    },
    missionBoard(owner, repo, number, viewerId) {
      const visible = runs.map(toPublic);
      return buildMissionBoard(
        visible,
        authors,
        { owner, repo, number },
        viewerId,
        book.history(
          visible.map((run) => ({
            id: run.id,
            researcherLogin: authors.get(run.userId)?.login ?? "",
          })),
        ),
      );
    },
    authorBoard(login, viewerId) {
      const key = login.trim().toLowerCase();
      const matched = [...authors.values()].filter(
        (author) => author.login.toLowerCase() === key,
      );
      const visible = runs.map(toPublic);
      return buildAuthorBoard(
        visible,
        matched,
        login,
        viewerId,
        book.history(
          visible.map((run) => ({
            id: run.id,
            researcherLogin: authors.get(run.userId)?.login ?? "",
          })),
        ),
      );
    },
    setPublished(userId, runId, published, at) {
      const run = runs.find((item) => item.id === runId && item.userId === userId);
      if (!run) return "missing";
      return publishRun(run, published, at);
    },
    async refreshGithub(runIds, now = Date.now(), fetchImpl = fetch) {
      await refreshWatch(
        {
          book,
          runs(ids) {
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

type GrantRow = {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: number;
  revoked_at: number | null;
  last_used_at: number | null;
};

type RunRow = {
  id: string;
  user_id: string;
  mission_id: string;
  owner: string;
  repo: string;
  number: number;
  is_pr: number;
  thread_id: string;
  status: string;
  model: string | null;
  report_json: string | null;
  published_at: number | null;
  delivery_hash: string;
  created_at: number;
  updated_at: number;
};

type TurnRow = {
  turn_id: string;
  status: string;
  usage_known: number;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_output_tokens: number | null;
  total_tokens: number | null;
  updated_at: number;
};

type LimitRow = {
  read_at: number;
  primary_used_percent: number | null;
  primary_window_mins: number | null;
  primary_resets_at: number | null;
  secondary_used_percent: number | null;
  secondary_window_mins: number | null;
  secondary_resets_at: number | null;
  spend_control_reached: number | null;
  individual_remaining_percent: number | null;
};

function isRunStatus(value: string): value is RunStatus {
  return (
    value === "in_progress" ||
    value === "waiting" ||
    value === "interrupted" ||
    value === "failed" ||
    value === "completed"
  );
}

function isTurnStatus(value: string): value is TurnStatus {
  return (
    value === "inProgress" ||
    value === "completed" ||
    value === "interrupted" ||
    value === "failed"
  );
}

function usageFromRow(row: TurnRow): TurnUsage {
  return {
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    outputTokens: row.output_tokens,
    reasoningOutputTokens: row.reasoning_output_tokens,
    totalTokens: row.total_tokens,
  };
}

function windowFrom(
  used: number | null,
  mins: number | null,
  resets: number | null,
): LimitWindow | null {
  if (used == null && mins == null && resets == null) return null;
  return {
    usedPercent: used,
    windowDurationMins: mins,
    resetsAt: resets,
  };
}

function tri(value: boolean | null) {
  if (value == null) return null;
  return value ? 1 : 0;
}

export function createSqliteResearch(db: DatabaseSync): ResearchRepo {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      login TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS connector_grants (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER,
      last_used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS connector_grants_user
      ON connector_grants (user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS research_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      number INTEGER NOT NULL,
      is_pr INTEGER NOT NULL,
      thread_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      model TEXT,
      report_json TEXT,
      report_schema INTEGER,
      published_at INTEGER,
      delivery_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS research_runs_user
      ON research_runs (user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS research_runs_mission_published
      ON research_runs (owner, repo, number, published_at);
    CREATE INDEX IF NOT EXISTS research_runs_user_published
      ON research_runs (user_id, published_at);
    CREATE TABLE IF NOT EXISTS research_turns (
      run_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      status TEXT NOT NULL,
      usage_known INTEGER NOT NULL,
      input_tokens INTEGER,
      cached_input_tokens INTEGER,
      output_tokens INTEGER,
      reasoning_output_tokens INTEGER,
      total_tokens INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (run_id, turn_id)
    );
    CREATE TABLE IF NOT EXISTS account_limit_snapshots (
      user_id TEXT PRIMARY KEY,
      read_at INTEGER NOT NULL,
      primary_used_percent REAL,
      primary_window_mins INTEGER,
      primary_resets_at INTEGER,
      secondary_used_percent REAL,
      secondary_window_mins INTEGER,
      secondary_resets_at INTEGER,
      spend_control_reached INTEGER,
      individual_remaining_percent REAL
    );
  `);
  const book = createSqliteWatch(db, () => newId("gh"));

  const insertGrant = db.prepare(
    `INSERT INTO connector_grants
      (id, user_id, token_hash, created_at, revoked_at, last_used_at)
     VALUES (?, ?, ?, ?, NULL, NULL)`,
  );
  const listGrantStmt = db.prepare(
    `SELECT id, user_id, token_hash, created_at, revoked_at, last_used_at
     FROM connector_grants WHERE user_id = ? ORDER BY created_at DESC, id ASC`,
  );
  const grantById = db.prepare(
    `SELECT id, user_id, token_hash, created_at, revoked_at, last_used_at
     FROM connector_grants WHERE id = ?`,
  );
  const grantByHash = db.prepare(
    `SELECT id, user_id, token_hash, created_at, revoked_at, last_used_at
     FROM connector_grants WHERE token_hash = ?`,
  );
  const revokeStmt = db.prepare(
    `UPDATE connector_grants SET revoked_at = ?
     WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
  );
  const touchStmt = db.prepare(
    `UPDATE connector_grants SET last_used_at = ?
     WHERE id = ? AND revoked_at IS NULL`,
  );
  const runColumns = `id, user_id, mission_id, owner, repo, number, is_pr, thread_id, status,
            model, report_json, published_at, delivery_hash, created_at, updated_at`;
  const runByThread = db.prepare(
    `SELECT ${runColumns} FROM research_runs WHERE thread_id = ?`,
  );
  const runById = db.prepare(`SELECT ${runColumns} FROM research_runs WHERE id = ?`);
  const runsByMission = db.prepare(
    `SELECT ${runColumns} FROM research_runs
     WHERE owner = ? COLLATE NOCASE AND repo = ? COLLATE NOCASE AND number = ?`,
  );
  const runsByUser = db.prepare(
    `SELECT ${runColumns} FROM research_runs WHERE user_id = ?`,
  );
  const usersByLogin = db.prepare(
    `SELECT id, login, name, avatar_url FROM users
     WHERE login = ? COLLATE NOCASE ORDER BY created_at DESC, id ASC`,
  );
  const userById = db.prepare(
    `SELECT id, login, name, avatar_url FROM users WHERE id = ?`,
  );
  const setPublishedStmt = db.prepare(
    `UPDATE research_runs SET published_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
  );
  const turnsByRun = db.prepare(
    `SELECT turn_id, status, usage_known, input_tokens, cached_input_tokens,
            output_tokens, reasoning_output_tokens, total_tokens, updated_at
     FROM research_turns WHERE run_id = ? ORDER BY turn_id ASC`,
  );
  const insertRun = db.prepare(
    `INSERT INTO research_runs
      (id, user_id, mission_id, owner, repo, number, is_pr, thread_id, status, model,
       report_json, report_schema, published_at, delivery_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateRun = db.prepare(
    `UPDATE research_runs
     SET status = ?, model = ?, report_json = ?, report_schema = ?, published_at = ?,
         delivery_hash = ?, updated_at = ?
     WHERE id = ?`,
  );
  const deleteTurns = db.prepare(`DELETE FROM research_turns WHERE run_id = ?`);
  const insertTurn = db.prepare(
    `INSERT INTO research_turns
      (run_id, turn_id, status, usage_known, input_tokens, cached_input_tokens,
       output_tokens, reasoning_output_tokens, total_tokens, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const upsertLimit = db.prepare(
    `INSERT INTO account_limit_snapshots
      (user_id, read_at, primary_used_percent, primary_window_mins, primary_resets_at,
       secondary_used_percent, secondary_window_mins, secondary_resets_at,
       spend_control_reached, individual_remaining_percent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       read_at = excluded.read_at,
       primary_used_percent = excluded.primary_used_percent,
       primary_window_mins = excluded.primary_window_mins,
       primary_resets_at = excluded.primary_resets_at,
       secondary_used_percent = excluded.secondary_used_percent,
       secondary_window_mins = excluded.secondary_window_mins,
       secondary_resets_at = excluded.secondary_resets_at,
       spend_control_reached = excluded.spend_control_reached,
       individual_remaining_percent = excluded.individual_remaining_percent`,
  );
  const limitByUser = db.prepare(
    `SELECT read_at, primary_used_percent, primary_window_mins, primary_resets_at,
            secondary_used_percent, secondary_window_mins, secondary_resets_at,
            spend_control_reached, individual_remaining_percent
     FROM account_limit_snapshots WHERE user_id = ?`,
  );

  function rowToGrant(row: GrantRow): GrantRecord {
    return {
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      lastUsedAt: row.last_used_at,
    };
  }

  function authorFrom(row: { id: string; login: string; name: string; avatar_url: string }): ResearchAuthor {
    return { id: row.id, login: row.login, name: row.name, avatarUrl: row.avatar_url };
  }

  function storedFrom(row: RunRow): StoredRun | null {
    if (!isRunStatus(row.status)) return null;
    let report: ResearchReport | null = null;
    if (row.report_json) {
      const parsed = JSON.parse(row.report_json) as ResearchReport;
      report = cloneReport(parsed);
    }
    const turns = (turnsByRun.all(row.id) as TurnRow[]).flatMap((turn) => {
      if (!isTurnStatus(turn.status)) return [];
      const usage = turn.usage_known ? usageFromRow(turn) : emptyUsage();
      return [
        {
          turnId: turn.turn_id,
          status: turn.status,
          usageKnown: Boolean(turn.usage_known),
          usage,
          updatedAt: turn.updated_at,
        },
      ];
    });
    return {
      id: row.id,
      userId: row.user_id,
      missionId: row.mission_id,
      owner: row.owner,
      repo: row.repo,
      number: row.number,
      isPr: Boolean(row.is_pr),
      threadId: row.thread_id,
      status: row.status,
      model: row.model,
      report,
      publishedAt: row.published_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      turns,
      deliveryHash: row.delivery_hash,
    };
  }

  function loadRun(threadId: string): StoredRun | null {
    const row = runByThread.get(threadId) as RunRow | undefined;
    return row ? storedFrom(row) : null;
  }

  function loadRows(rows: readonly RunRow[]): ResearchRun[] {
    return rows.flatMap((row) => {
      const stored = storedFrom(row);
      return stored ? [toPublic(stored)] : [];
    });
  }

  function authorsFor(runs: readonly ResearchRun[]) {
    const authors = new Map<string, ReportAuthor>();
    for (const run of runs) {
      if (authors.has(run.userId)) continue;
      const row = userById.get(run.userId) as
        | { id: string; login: string; name: string; avatar_url: string }
        | undefined;
      if (row) authors.set(row.id, authorFrom(row));
    }
    return authors;
  }

  function writeRun(run: StoredRun, existed: boolean) {
    const reportJson = run.report ? JSON.stringify(run.report) : null;
    const reportSchema = run.report ? run.report.schemaVersion : null;
    if (!existed) {
      insertRun.run(
        run.id,
        run.userId,
        run.missionId,
        run.owner,
        run.repo,
        run.number,
        run.isPr ? 1 : 0,
        run.threadId,
        run.status,
        run.model,
        reportJson,
        reportSchema,
        run.publishedAt,
        run.deliveryHash,
        run.createdAt,
        run.updatedAt,
      );
    } else {
      updateRun.run(
        run.status,
        run.model,
        reportJson,
        reportSchema,
        run.publishedAt,
        run.deliveryHash,
        run.updatedAt,
        run.id,
      );
    }
    deleteTurns.run(run.id);
    for (const turn of run.turns) {
      insertTurn.run(
        run.id,
        turn.turnId,
        turn.status,
        turn.usageKnown ? 1 : 0,
        turn.usageKnown ? turn.usage.inputTokens : null,
        turn.usageKnown ? turn.usage.cachedInputTokens : null,
        turn.usageKnown ? turn.usage.outputTokens : null,
        turn.usageKnown ? turn.usage.reasoningOutputTokens : null,
        turn.usageKnown ? turn.usage.totalTokens : null,
        turn.updatedAt,
      );
    }
  }

  function rememberLimit(userId: string, delivery: ResearchDelivery) {
    const limit = delivery.limit;
    if (!limit) return;
    upsertLimit.run(
      userId,
      limit.readAt,
      limit.primary?.usedPercent ?? null,
      limit.primary?.windowDurationMins ?? null,
      limit.primary?.resetsAt ?? null,
      limit.secondary?.usedPercent ?? null,
      limit.secondary?.windowDurationMins ?? null,
      limit.secondary?.resetsAt ?? null,
      tri(limit.spendControlReached),
      limit.individualRemainingPercent,
    );
  }

  function listGrants(userId: string) {
    return (listGrantStmt.all(userId) as GrantRow[]).map((row) =>
      publicGrant(rowToGrant(row)),
    );
  }

  return {
    createGrant(userId, at) {
      const token = `ahc_${randomBytes(32).toString("base64url")}`;
      const grant: GrantRecord = {
        id: newId("gr"),
        userId,
        tokenHash: hashToken(token),
        createdAt: at,
        revokedAt: null,
        lastUsedAt: null,
      };
      insertGrant.run(grant.id, grant.userId, grant.tokenHash, grant.createdAt);
      return { grant: publicGrant(grant), token };
    },
    listGrants,
    revokeGrant(userId, grantId, at) {
      const row = grantById.get(grantId) as GrantRow | undefined;
      if (!row || row.user_id !== userId) return null;
      revokeStmt.run(at, grantId, userId);
      return listGrants(userId);
    },
    authenticate(token) {
      const row = grantByHash.get(hashToken(token)) as GrantRow | undefined;
      if (!row || row.revoked_at != null || !tokenMatches(token, row.token_hash)) {
        return null;
      }
      return { userId: row.user_id, grantId: row.id };
    },
    markUsed(grantId, at) {
      touchStmt.run(at, grantId);
    },
    ingest(userId, delivery) {
      const existing = loadRun(delivery.threadId);
      const decision = planIngest(existing, userId, delivery, newId("run"));
      if (decision.kind === "invalid" || decision.kind === "forbidden") {
        return { ok: false, error: decision.kind };
      }
      rememberLimit(userId, delivery);
      if (decision.kind === "conflict") return { ok: false, error: "conflict" };
      if (decision.kind === "replay") {
        return { ok: true, replay: true, run: toPublic(decision.run) };
      }
      const existed = existing != null;
      db.exec("BEGIN");
      try {
        writeRun(decision.run, existed);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      const stored = loadRun(decision.run.threadId);
      if (!stored) throw new Error("Research run disappeared after write.");
      return { ok: true, replay: false, run: toPublic(stored) };
    },
    readRun(userId, threadId) {
      const run = loadRun(threadId);
      if (!run || run.userId !== userId) return null;
      return toPublic(run);
    },
    readLimit(userId) {
      const row = limitByUser.get(userId) as LimitRow | undefined;
      if (!row) return null;
      return {
        readAt: row.read_at,
        primary: windowFrom(
          row.primary_used_percent,
          row.primary_window_mins,
          row.primary_resets_at,
        ),
        secondary: windowFrom(
          row.secondary_used_percent,
          row.secondary_window_mins,
          row.secondary_resets_at,
        ),
        spendControlReached:
          row.spend_control_reached == null ? null : Boolean(row.spend_control_reached),
        individualRemainingPercent: row.individual_remaining_percent,
      };
    },
    upsertAuthor(user) {
      upsertUser(db, user);
    },
    missionBoard(owner, repo, number, viewerId) {
      const loaded = loadRows(runsByMission.all(owner, repo, number) as RunRow[]);
      const authors = authorsFor(loaded);
      return buildMissionBoard(
        loaded,
        authors,
        { owner, repo, number },
        viewerId,
        book.history(
          loaded.map((run) => ({
            id: run.id,
            researcherLogin: authors.get(run.userId)?.login ?? "",
          })),
        ),
      );
    },
    authorBoard(login, viewerId) {
      const matched = (usersByLogin.all(login.trim()) as {
        id: string;
        login: string;
        name: string;
        avatar_url: string;
      }[]).map(authorFrom);
      const loaded = matched.flatMap((author) =>
        loadRows(runsByUser.all(author.id) as RunRow[]),
      );
      const authors = authorsFor(loaded);
      return buildAuthorBoard(
        loaded,
        matched,
        login,
        viewerId,
        book.history(
          loaded.map((run) => ({
            id: run.id,
            researcherLogin: authors.get(run.userId)?.login ?? "",
          })),
        ),
      );
    },
    setPublished(userId, runId, published, at) {
      const row = runById.get(runId) as RunRow | undefined;
      const run = row ? storedFrom(row) : null;
      if (!run || run.userId !== userId) return "missing";
      const decision = publishRun(run, published, at);
      if (decision !== "updated") return decision;
      setPublishedStmt.run(run.publishedAt, run.updatedAt, run.id, run.userId);
      return "updated";
    },
    async refreshGithub(runIds, now = Date.now(), fetchImpl = fetch) {
      await refreshWatch(
        {
          book,
          runs(ids) {
            return ids.flatMap((id) => {
              const row = runById.get(id) as RunRow | undefined;
              const stored = row ? storedFrom(row) : null;
              if (!stored) return [];
              const user = userById.get(stored.userId) as { login: string } | undefined;
              return [
                {
                  run: {
                    id: stored.id,
                    owner: stored.owner,
                    repo: stored.repo,
                    number: stored.number,
                    isPr: stored.isPr,
                    publishedAt: stored.publishedAt,
                    status: stored.status,
                    report: stored.report,
                  },
                  researcherLogin: user?.login ?? "",
                },
              ];
            });
          },
        },
        runIds,
        now,
        fetchImpl,
      );
    },
  };
}

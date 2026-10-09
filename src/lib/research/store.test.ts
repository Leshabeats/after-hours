import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { sumTurnSnapshots } from "./accounting.ts";
import {
  createMemoryResearch,
  createSqliteResearch,
  type ResearchRepo,
} from "./store.ts";
import { emptyUsage, type ResearchDelivery, type ResearchReport, type ResearchTurn } from "./types.ts";
import { createSqliteJournal } from "../journal/store.ts";
import type { LogEntry } from "../journal/types.ts";
import { createSqliteUsage } from "../usage/store.ts";

const AT = 1_700_000_000_000;

function report(findings = "Уже исправлено"): ResearchReport {
  return {
    schemaVersion: 1,
    findings,
    work: "Сверил issue и код.",
    evidence: ["Тест на main зелёный."],
    unknowns: ["Нет прогона на Windows."],
    nextSteps: ["Спросить автора."],
    links: [{ url: "https://github.com/vitejs/vite/issues/1", kind: "issue" }],
  };
}

function turn(
  turnId: string,
  usage: Partial<ResearchTurn["usage"]> | null,
  status: ResearchTurn["status"] = "completed",
): ResearchTurn {
  return {
    turnId,
    status,
    usageKnown: usage != null,
    usage: usage ? { ...emptyUsage(), ...usage } : emptyUsage(),
    updatedAt: AT,
  };
}

function delivery(overrides: Partial<ResearchDelivery> = {}): ResearchDelivery {
  return {
    threadId: "thread_abc12345",
    missionId: "vitejs/vite#1",
    owner: "vitejs",
    repo: "vite",
    number: 1,
    isPr: false,
    status: "in_progress",
    turns: [],
    limit: null,
    at: AT,
    ...overrides,
  };
}

function limit(usedPercent: number) {
  return {
    readAt: AT + 5,
    primary: { usedPercent, windowDurationMins: 10080, resetsAt: AT + 86_400 },
    secondary: null,
    spendControlReached: false,
    individualRemainingPercent: null,
  };
}

function assertContract(repo: ResearchRepo) {
  const created = repo.createGrant("owner", AT);
  assert.equal(created.token.startsWith("ahc_"), true);
  assert.equal(JSON.stringify(repo.listGrants("owner")).includes(created.token), false);
  assert.equal(repo.listGrants("other").length, 0);
  assert.deepEqual(repo.authenticate(created.token), {
    userId: "owner",
    grantId: created.grant.id,
  });
  assert.equal(repo.authenticate("ahc_not-the-token"), null);

  const second = repo.createGrant("owner", AT + 10);
  assert.deepEqual(
    repo.listGrants("owner").map((grant) => grant.id),
    [second.grant.id, created.grant.id],
  );
  assert.equal(repo.revokeGrant("other", created.grant.id, AT + 20), null);
  assert.equal(repo.authenticate(created.token)?.userId, "owner");
  const revoked = repo.revokeGrant("owner", created.grant.id, AT + 30);
  assert.equal(revoked?.find((grant) => grant.id === created.grant.id)?.revokedAt, AT + 30);
  const revokedAgain = repo.revokeGrant("owner", created.grant.id, AT + 40);
  assert.equal(
    revokedAgain?.find((grant) => grant.id === created.grant.id)?.revokedAt,
    AT + 30,
  );
  assert.equal(repo.authenticate(created.token), null);
  assert.equal(repo.authenticate(second.token)?.grantId, second.grant.id);

  const opened = repo.ingest(
    "owner",
    delivery({
      turns: [turn("turn_one0001", { inputTokens: 10, outputTokens: 1, totalTokens: 11 })],
    }),
  );
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  assert.equal(opened.replay, false);
  assert.equal(opened.run.publishedAt, null);
  assert.equal(opened.run.userId, "owner");

  const replaced = repo.ingest(
    "owner",
    delivery({
      at: AT + 1,
      turns: [turn("turn_one0001", { inputTokens: 12, outputTokens: 1, totalTokens: 13 })],
    }),
  );
  assert.equal(replaced.ok && replaced.replay, false);
  const afterReplace = repo.readRun("owner", "thread_abc12345");
  assert.equal(afterReplace?.turns.length, 1);
  assert.equal(afterReplace?.turns[0]?.usage.inputTokens, 12);
  assert.equal(afterReplace?.turns[0]?.usage.totalTokens, 13);

  const added = repo.ingest(
    "owner",
    delivery({
      at: AT + 2,
      turns: [
        turn("turn_two0002", {
          inputTokens: 50,
          cachedInputTokens: 40,
          outputTokens: 5,
          reasoningOutputTokens: null,
          totalTokens: 55,
        }),
      ],
    }),
  );
  assert.equal(added.ok, true);
  const both = repo.readRun("owner", "thread_abc12345");
  assert.equal(both?.turns.length, 2);
  const spend = sumTurnSnapshots(both?.turns ?? []);
  assert.equal(spend.inputTokens, 62);
  assert.equal(spend.outputTokens, 6);
  assert.equal(spend.totalTokens, 68);
  assert.equal(spend.cachedInputTokens, null);
  assert.equal(spend.reasoningOutputTokens, null);
  assert.notEqual(
    spend.totalTokens,
    (spend.inputTokens ?? 0) + (both?.turns[1]?.usage.cachedInputTokens ?? 0) + (spend.outputTokens ?? 0),
  );

  const replay = repo.ingest(
    "owner",
    delivery({
      at: AT + 99,
      turns: [
        turn("turn_two0002", {
          inputTokens: 50,
          cachedInputTokens: 40,
          outputTokens: 5,
          reasoningOutputTokens: null,
          totalTokens: 55,
        }),
      ],
    }),
  );
  assert.equal(replay.ok && replay.replay, true);
  if (replay.ok) assert.equal(replay.run.updatedAt, AT + 2);
  assert.equal(repo.readRun("owner", "thread_abc12345")?.turns.length, 2);

  const waiting = repo.ingest(
    "owner",
    delivery({ status: "waiting", at: AT + 3 }),
  );
  assert.equal(waiting.ok && waiting.run.status, "waiting");
  assert.equal(waiting.ok && waiting.run.publishedAt, null);

  const quiet = repo.ingest(
    "owner",
    delivery({
      threadId: "thread_quiet0001",
      status: "interrupted",
      at: AT + 4,
      turns: [turn("turn_quiet001", null, "interrupted")],
    }),
  );
  assert.equal(quiet.ok, true);
  const quietRun = repo.readRun("owner", "thread_quiet0001");
  assert.equal(quietRun?.turns[0]?.usageKnown, false);
  assert.equal(quietRun?.turns[0]?.usage.inputTokens, null);
  assert.equal(sumTurnSnapshots(quietRun?.turns ?? []).inputTokens, null);

  const unfinished = repo.ingest(
    "owner",
    delivery({ threadId: "thread_done00001", status: "completed", at: AT + 5 }),
  );
  assert.deepEqual(unfinished, { ok: false, error: "invalid" });
  assert.equal(repo.readRun("owner", "thread_done00001"), null);

  const done = repo.ingest(
    "owner",
    delivery({
      threadId: "thread_done00001",
      status: "completed",
      at: AT + 6,
      report: report(),
      turns: [turn("turn_done0001", { inputTokens: 3, outputTokens: 1, totalTokens: 4 })],
      limit: limit(12),
    }),
  );
  assert.equal(done.ok && done.run.status, "completed");
  assert.equal(done.ok && done.run.publishedAt, null);
  assert.equal(done.ok && done.run.report?.findings, "Уже исправлено");
  assert.deepEqual(repo.readLimit("owner")?.primary, {
    usedPercent: 12,
    windowDurationMins: 10080,
    resetsAt: AT + 86_400,
  });
  assert.equal(repo.readLimit("owner")?.secondary, null);
  assert.equal(repo.readLimit("owner")?.individualRemainingPercent, null);
  assert.equal(repo.readLimit("other"), null);

  const sameDone = repo.ingest(
    "owner",
    delivery({
      threadId: "thread_done00001",
      status: "completed",
      at: AT + 7,
      report: report(),
      turns: [turn("turn_done0001", { inputTokens: 3, outputTokens: 1, totalTokens: 4 })],
      limit: limit(18),
    }),
  );
  assert.equal(sameDone.ok && sameDone.replay, true);
  if (sameDone.ok) assert.equal(sameDone.run.updatedAt, AT + 6);
  assert.equal(repo.readRun("owner", "thread_done00001")?.turns.length, 1);
  assert.equal(repo.readLimit("owner")?.primary?.usedPercent, 18);

  const changed = repo.ingest(
    "owner",
    delivery({
      threadId: "thread_done00001",
      status: "completed",
      at: AT + 8,
      report: report("Другой вывод"),
      turns: [turn("turn_done0001", { inputTokens: 3, outputTokens: 1, totalTokens: 4 })],
      limit: limit(33),
    }),
  );
  assert.deepEqual(changed, { ok: false, error: "conflict" });
  assert.equal(repo.readRun("owner", "thread_done00001")?.report?.findings, "Уже исправлено");
  assert.equal(repo.readLimit("owner")?.primary?.usedPercent, 33);

  const regressed = repo.ingest(
    "owner",
    delivery({ threadId: "thread_done00001", status: "in_progress", at: AT + 9 }),
  );
  assert.deepEqual(regressed, { ok: false, error: "conflict" });
  assert.equal(repo.readRun("owner", "thread_done00001")?.status, "completed");

  const rebound = repo.ingest(
    "owner",
    delivery({
      missionId: "golang/go#2",
      owner: "golang",
      repo: "go",
      number: 2,
      at: AT + 10,
    }),
  );
  assert.deepEqual(rebound, { ok: false, error: "conflict" });
  assert.equal(repo.readRun("owner", "thread_abc12345")?.missionId, "vitejs/vite#1");

  const stolen = repo.ingest(
    "other",
    delivery({
      status: "failed",
      at: AT + 11,
      limit: limit(99),
    }),
  );
  assert.deepEqual(stolen, { ok: false, error: "forbidden" });
  assert.equal(repo.readRun("owner", "thread_abc12345")?.status, "waiting");
  assert.equal(repo.readRun("other", "thread_abc12345"), null);
  assert.equal(repo.readLimit("other"), null);
  assert.equal(repo.readLimit("owner")?.primary?.usedPercent, 33);

  const duplicated = repo.ingest(
    "owner",
    delivery({
      threadId: "thread_dup000001",
      turns: [
        turn("turn_same0001", { inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
        turn("turn_same0001", { inputTokens: 4, outputTokens: 1, totalTokens: 5 }),
      ],
    }),
  );
  assert.deepEqual(duplicated, { ok: false, error: "invalid" });
  assert.equal(repo.readRun("owner", "thread_dup000001"), null);
}

describe("research contract", () => {
  it("memory: grants, snapshots, and completion stay idempotent", () => {
    assertContract(createMemoryResearch());
  });

  it("sqlite: grants, snapshots, and completion stay idempotent", () => {
    const db = new DatabaseSync(":memory:");
    try {
      assertContract(createSqliteResearch(db));
    } finally {
      db.close();
    }
  });

  it("sqlite: keeps journal and usage rows, and stores only the grant hash", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const usage = createSqliteUsage(db);
      const journal = createSqliteJournal(db);
      const night: LogEntry = {
        id: "vitejs/vite#9",
        owner: "vitejs",
        repo: "vite",
        number: 9,
        title: "Night",
        kind: "blinding",
        url: "https://github.com/vitejs/vite/issues/9",
        isPr: false,
        status: "taken",
        takenAt: 5,
      };
      usage.record("owner", {
        at: 5,
        harness: "codex",
        model: "gpt-6-astra",
        inputTokens: 3,
        outputTokens: 4,
        missionId: "vitejs/vite#9",
      });
      journal.take("owner", night);
      const research = createSqliteResearch(db);
      const { token } = research.createGrant("owner", AT);
      const saved = research.ingest(
        "owner",
        delivery({
          status: "completed",
          report: report(),
          turns: [turn("turn_old00001", { inputTokens: 8, cachedInputTokens: 2, outputTokens: 1, totalTokens: 9 })],
        }),
      );
      assert.equal(saved.ok, true);
      assert.deepEqual(usage.list("owner"), [
        {
          at: 5,
          harness: "codex",
          model: "gpt-6-astra",
          inputTokens: 3,
          outputTokens: 4,
          missionId: "vitejs/vite#9",
        },
      ]);
      assert.equal(journal.list("owner")[0]?.id, "vitejs/vite#9");
      const row = db.prepare("SELECT token_hash FROM connector_grants").get() as {
        token_hash: string;
      };
      assert.notEqual(row.token_hash, token);
      assert.equal(row.token_hash.includes(token), false);
      const spend = sumTurnSnapshots(research.readRun("owner", "thread_abc12345")?.turns ?? []);
      assert.equal(spend.totalTokens, 9);
      assert.equal(spend.cachedInputTokens, 2);
      assert.notEqual(spend.totalTokens, 8 + 2 + 1);
    } finally {
      db.close();
    }
  });
});

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
  assert.equal(quietRun?.publishedAt, null);
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
  assert.equal(done.ok && done.run.publishedAt, AT + 6);
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
  if (sameDone.ok) {
    assert.equal(sameDone.run.updatedAt, AT + 6);
    assert.equal(sameDone.run.publishedAt, AT + 6);
  }
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
  assert.equal(repo.readRun("owner", "thread_done00001")?.publishedAt, AT + 6);
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

  const held = repo.ingest(
    "owner",
    delivery({
      threadId: "thread_park00001",
      status: "interrupted",
      at: AT + 12,
      report: report(),
      turns: [turn("turn_park0001", { inputTokens: 4, outputTokens: 1, totalTokens: 5 }, "interrupted")],
    }),
  );
  assert.equal(held.ok && held.run.status, "interrupted");
  assert.equal(held.ok && held.run.publishedAt, null);
  assert.equal(held.ok && held.run.report, null);
  assert.equal(held.ok && held.run.turns[0]?.usage.inputTokens, 4);

  const drafting = repo.ingest(
    "owner",
    delivery({
      threadId: "thread_pub000001",
      status: "in_progress",
      at: AT + 13,
      turns: [turn("turn_pub00001", { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, "inProgress")],
    }),
  );
  assert.equal(drafting.ok && drafting.run.publishedAt, null);
  const finished = repo.ingest(
    "owner",
    delivery({
      threadId: "thread_pub000001",
      status: "completed",
      at: AT + 14,
      report: report(),
      turns: [turn("turn_pub00001", { inputTokens: 2, outputTokens: 1, totalTokens: 3 })],
    }),
  );
  assert.equal(finished.ok && finished.run.publishedAt, AT + 14);
  assert.equal(repo.readRun("owner", "thread_pub000001")?.publishedAt, AT + 14);
  assert.equal(repo.readRun("owner", "thread_pub000001")?.turns[0]?.usage.inputTokens, 2);
}

function assertPublication(repo: ResearchRepo) {
  repo.upsertAuthor({ id: "gh-a", login: "Lesha", name: "Lesha", avatarUrl: "https://example.com/a.png" });
  repo.upsertAuthor({ id: "gh-b", login: "masha", name: "Masha", avatarUrl: "" });
  const known = { inputTokens: 7, cachedInputTokens: 1, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 9 };
  const first = repo.ingest(
    "gh-a",
    delivery({
      threadId: "thread_pub_a001",
      status: "completed",
      model: "gpt-6-astra",
      report: report("Уже исправлено"),
      turns: [turn("turn_pub_a001", known)],
      limit: limit(12),
      at: AT,
    }),
  );
  const second = repo.ingest(
    "gh-b",
    delivery({
      threadId: "thread_pub_b001",
      status: "completed",
      report: report("Нужно уточнение"),
      turns: [turn("turn_pub_b001", null)],
      at: AT + 1,
    }),
  );
  const again = repo.ingest(
    "gh-a",
    delivery({
      threadId: "thread_pub_a002",
      status: "completed",
      report: report("Второй заход"),
      turns: [turn("turn_pub_a002", { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 })],
      at: AT + 2,
    }),
  );
  const quiet = repo.ingest(
    "gh-a",
    delivery({
      threadId: "thread_hide001",
      status: "in_progress",
      turns: [turn("turn_hide001", { inputTokens: 4, outputTokens: 1, totalTokens: 5 }, "inProgress")],
      at: AT + 3,
    }),
  );
  assert.equal(first.ok && second.ok && again.ok && quiet.ok, true);
  if (!first.ok || !second.ok || !again.ok) return;

  const board = repo.missionBoard("Vitejs", "vite", 1, "gh-a");
  assert.deepEqual(
    board.reports.map((item) => item.report.findings),
    ["Второй заход", "Нужно уточнение", "Уже исправлено"],
  );
  assert.equal(board.reports[2]?.author.login, "Lesha");
  assert.equal(board.publicSpend.totalTokens, 9);
  assert.equal(board.publicSpend.unknownTurns, 1);
  assert.equal(board.viewerSpend?.totalTokens, 14);
  assert.equal(board.hidden.length, 0);
  const leaked = JSON.stringify(board);
  assert.equal(leaked.includes("thread_"), false);
  assert.equal(leaked.includes("gh-a"), false);
  assert.equal(leaked.includes("individualRemainingPercent"), false);
  assert.equal(repo.readLimit("gh-a")?.primary?.usedPercent, 12);
  assert.equal(repo.missionBoard("vitejs", "vite", 1, null).viewerSpend, null);
  assert.equal(repo.missionBoard("vitejs", "vite", 1, "gh-b").hidden.length, 0);

  assert.equal(repo.setPublished("gh-b", first.run.id, false, AT + 4), "missing");
  assert.equal(repo.missionBoard("vitejs", "vite", 1, null).reports.length, 3);
  assert.equal(repo.setPublished("gh-a", first.run.id, false, AT + 5), "updated");
  const hidden = repo.missionBoard("vitejs", "vite", 1, "gh-a");
  assert.deepEqual(
    hidden.reports.map((item) => item.report.findings),
    ["Второй заход", "Нужно уточнение"],
  );
  assert.equal(hidden.hidden[0]?.report.findings, "Уже исправлено");
  assert.equal(hidden.hidden[0]?.spend.totalTokens, 9);
  assert.equal(hidden.viewerSpend?.inputTokens, 11);
  assert.equal(repo.authorBoard("lesha", "gh-b").hidden.length, 0);
  assert.equal(repo.authorBoard("lesha", "gh-a").reports.length, 1);
  assert.equal(repo.authorBoard("lesha", "gh-a").hidden.length, 1);
  assert.equal(repo.authorBoard("nobody", null).login, "nobody");
  assert.equal(repo.authorBoard("nobody", null).reports.length, 0);

  const replay = repo.ingest(
    "gh-a",
    delivery({
      threadId: "thread_pub_a001",
      status: "completed",
      model: "gpt-6-astra",
      report: report("Уже исправлено"),
      turns: [turn("turn_pub_a001", known)],
      at: AT + 6,
    }),
  );
  assert.equal(replay.ok && replay.replay, true);
  assert.equal(repo.readRun("gh-a", "thread_pub_a001")?.publishedAt, null);
  const conflict = repo.ingest(
    "gh-a",
    delivery({
      threadId: "thread_pub_a001",
      status: "completed",
      model: "gpt-6-astra",
      report: report("Другой вывод"),
      turns: [turn("turn_pub_a001", known)],
      at: AT + 7,
    }),
  );
  assert.deepEqual(conflict, { ok: false, error: "conflict" });
  assert.equal(repo.readRun("gh-a", "thread_pub_a001")?.publishedAt, null);
  assert.equal(repo.readRun("gh-a", "thread_pub_a001")?.report?.findings, "Уже исправлено");
  assert.equal(repo.setPublished("gh-a", quiet.ok ? quiet.run.id : "missing", true, AT + 7), "blocked");
  assert.equal(repo.setPublished("gh-a", first.run.id, true, AT + 8), "updated");
  assert.equal(repo.readRun("gh-a", "thread_pub_a001")?.publishedAt, AT + 8);
  assert.equal(repo.missionBoard("vitejs", "vite", 1, "gh-a").reports[0]?.report.findings, "Уже исправлено");
  const zero = repo.missionBoard("vitejs", "vite", 1, null).reports.find((item) => item.report.findings === "Второй заход");
  assert.equal(zero?.spend.totalTokens, 0);
}

describe("research publication", () => {
  it("memory: public boards hide private fields and keep an unpublish", () => {
    assertPublication(createMemoryResearch());
  });

  it("sqlite: public boards hide private fields and keep an unpublish", () => {
    const db = new DatabaseSync(":memory:");
    try {
      assertPublication(createSqliteResearch(db));
    } finally {
      db.close();
    }
  });
});

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
      if (saved.ok) assert.equal(saved.run.publishedAt, AT);
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

async function assertWatch(repo: ResearchRepo, sample?: () => { subjects: number; links: number }) {
  repo.upsertAuthor({ id: "gh-a", login: "Lesha", name: "Lesha", avatarUrl: "" });
  repo.upsertAuthor({ id: "gh-b", login: "masha", name: "Masha", avatarUrl: "" });
  const body = (findings: string): ResearchReport => ({
    ...report(findings),
    links: [
      { url: "https://github.com/vitejs/vite/issues/1", kind: "issue" },
      { url: "https://github.com/vitejs/vite/pull/9", kind: "pull" },
      { url: "https://github.com/vitejs/vite/pull/3", kind: "pull" },
    ],
  });
  const first = repo.ingest(
    "gh-a",
    delivery({
      threadId: "thread_watch_a",
      status: "completed",
      report: body("Первый"),
      turns: [turn("turn_watch_a", { inputTokens: 1, outputTokens: 1, totalTokens: 2 })],
    }),
  );
  const second = repo.ingest(
    "gh-b",
    delivery({
      threadId: "thread_watch_b",
      status: "completed",
      report: body("Второй"),
      turns: [turn("turn_watch_b", { inputTokens: 1, outputTokens: 1, totalTokens: 2 })],
      at: AT + 1,
    }),
  );
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  let calls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    calls += 1;
    const url = String(input);
    const payload = url.includes("/reviews")
      ? []
      : url.includes("/pulls/9")
        ? {
            node_id: "P9",
            number: 9,
            title: "Общий",
            html_url: "https://github.com/vitejs/vite/pull/9",
            state: "closed",
            merged: true,
            draft: false,
            comments: 1,
            user: { login: "Lesha" },
          }
        : url.includes("/pulls/3")
          ? {
              node_id: "P3",
              number: 3,
              title: "Чужой",
              html_url: "https://github.com/vitejs/vite/pull/3",
              state: "closed",
              merged: true,
              draft: false,
              comments: 1,
              user: { login: "other" },
            }
          : url.includes("/issues/1")
            ? {
                node_id: "I1",
                number: 1,
                title: "Задача",
                html_url: "https://github.com/vitejs/vite/issues/1",
                state: "open",
                comments: 0,
                user: { login: "octocat" },
              }
            : null;
    if (!payload) return new Response("missing", { status: 404 });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const ids = [first.run.id, second.run.id];
  await repo.refreshGithub(ids, AT, fetchImpl);
  assert.equal(calls, 5);
  if (sample) assert.deepEqual(sample(), { subjects: 3, links: 6 });
  const board = repo.missionBoard("vitejs", "vite", 1, null);
  assert.deepEqual(
    board.reports.map((item) => item.github.links.map((link) => link.title)),
    [
      ["Общий", "Чужой"],
      ["Общий", "Чужой"],
    ],
  );
  const own = board.reports.find((item) => item.report.findings === "Первый")?.github.links ?? [];
  assert.equal(own.find((link) => link.number === 9)?.byResearcher, true);
  assert.equal(own.find((link) => link.number === 9)?.fixedByResearcher, false);
  assert.equal(own.find((link) => link.number === 3)?.byResearcher, false);
  assert.equal(own.find((link) => link.number === 3)?.fixedByResearcher, false);
  const leaked = JSON.stringify(board);
  assert.equal(leaked.includes("thread_"), false);
  assert.equal(leaked.includes("gh-a"), false);
  assert.equal(leaked.includes("P9"), false);
  assert.equal(leaked.includes("individualRemainingPercent"), false);

  await repo.refreshGithub(ids, AT + 1_000, fetchImpl);
  assert.equal(calls, 5);
  if (sample) assert.deepEqual(sample(), { subjects: 3, links: 6 });

  assert.equal(repo.setPublished("gh-a", first.run.id, false, AT + 2), "updated");
  const hidden = repo.missionBoard("vitejs", "vite", 1, null);
  assert.deepEqual(hidden.reports.map((item) => item.report.findings), ["Второй"]);
  assert.equal(hidden.reports[0]?.github.links.some((link) => link.title === "Общий"), true);
  assert.equal(JSON.stringify(hidden).includes("Первый"), false);
  const owner = repo.missionBoard("vitejs", "vite", 1, "gh-a");
  assert.equal(owner.hidden[0]?.github.source?.title, "Задача");
  const stranger = repo.authorBoard("lesha", null);
  assert.equal(stranger.reports.some((item) => item.report.findings === "Первый"), false);
  assert.equal(stranger.hidden.length, 0);
  const self = repo.authorBoard("lesha", "gh-a");
  assert.equal(self.hidden[0]?.github.links.some((link) => link.title === "Общий"), true);

  assert.equal(repo.setPublished("gh-a", first.run.id, true, AT + 3), "updated");
  await repo.refreshGithub([first.run.id], AT + 4_000, fetchImpl);
  assert.equal(calls, 5);
  assert.equal(
    repo.missionBoard("vitejs", "vite", 1, null).reports.some((item) => item.github.source?.title === "Задача"),
    true,
  );

  const quiet = repo.ingest(
    "gh-a",
    delivery({
      threadId: "thread_watch_q",
      status: "in_progress",
      report: body("Черновик"),
      at: AT + 5,
    }),
  );
  assert.equal(quiet.ok, true);
  if (quiet.ok) await repo.refreshGithub([quiet.run.id], AT + 6_000, fetchImpl);
  assert.equal(calls, 5);
  if (sample) assert.deepEqual(sample(), { subjects: 3, links: 6 });
}

describe("research github history", () => {
  it("memory: two reports share one pull and an unpublished card leaves the public board", async () => {
    await assertWatch(createMemoryResearch());
  });

  it("sqlite: two reports share one pull, and the journal stays intact", async () => {
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
      const repo = createSqliteResearch(db);
      await assertWatch(repo, () => ({
        subjects: (db.prepare("SELECT COUNT(*) AS n FROM github_subjects").get() as { n: number }).n,
        links: (db.prepare("SELECT COUNT(*) AS n FROM research_links").get() as { n: number }).n,
      }));
      assert.equal(journal.list("owner")[0]?.id, "vitejs/vite#9");
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
      const facts = db.prepare("SELECT COUNT(*) AS n FROM github_facts").get() as { n: number };
      assert.equal(facts.n, 2);
    } finally {
      db.close();
    }
  });
});

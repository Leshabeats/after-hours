import assert from "node:assert/strict";
import { createPostgresJournal } from "../journal/store.ts";
import type { LogEntry } from "../journal/types.ts";
import { createPostgresResearch } from "../research/store.ts";
import { createPostgresWatch } from "../research/watch-book.ts";
import { sumTurnSnapshots } from "../research/accounting.ts";
import type { ResearchDelivery, ResearchReport, ResearchTurn } from "../research/types.ts";
import type { ObservedSubject, WatchRun } from "../research/github-watch.ts";
import { migrate } from "./migrate.ts";
import { postgresTest } from "./testing.ts";
import { transaction } from "./postgres.ts";

postgresTest(
  "postgres: statement timeout is transaction-local on commit and rollback",
  async (pool) => {
    const baseline = (await pool.query("SHOW statement_timeout")).rows[0].statement_timeout;
    const checkTimeout = async () => {
      await transaction(pool, "timeout-fixture", async (client) => {
        assert.equal(
          (await client.query("SHOW statement_timeout")).rows[0].statement_timeout,
          "15s",
        );
      });
    };
    await checkTimeout();
    assert.equal((await pool.query("SHOW statement_timeout")).rows[0].statement_timeout, baseline);
    await assert.rejects(
      transaction(pool, "timeout-fixture", async (client) => {
        assert.equal(
          (await client.query("SHOW statement_timeout")).rows[0].statement_timeout,
          "15s",
        );
        throw new Error("rollback fixture");
      }),
      /rollback fixture/,
    );
    assert.equal((await pool.query("SHOW statement_timeout")).rows[0].statement_timeout, baseline);
  },
);

const report: ResearchReport = {
  schemaVersion: 1,
  findings: "Fixture",
  work: "Read",
  evidence: [],
  unknowns: [],
  nextSteps: [],
  links: [],
};
function turn(id: string): ResearchTurn {
  return {
    turnId: id,
    status: "completed",
    usageKnown: true,
    updatedAt: 100,
    usage: {
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 25,
      reasoningOutputTokens: 0,
      totalTokens: 125,
    },
  };
}
function delivery(patch: Partial<ResearchDelivery> = {}): ResearchDelivery {
  return {
    threadId: "thread_atomic",
    missionId: "vitejs/vite#1",
    owner: "vitejs",
    repo: "vite",
    number: 1,
    isPr: false,
    status: "in_progress",
    at: 100,
    turns: [],
    limit: null,
    ...patch,
  };
}
function night(id: string): LogEntry {
  return {
    id,
    owner: "vitejs",
    repo: "vite",
    number: 1,
    title: id,
    kind: "blinding",
    url: "https://github.com/vitejs/vite/issues/1",
    isPr: false,
    status: "taken",
    takenAt: 100,
  };
}

postgresTest("postgres: concurrent migrations apply once and detect edits", async (pool) => {
  await Promise.all([migrate(pool), migrate(pool), migrate(pool)]);
  assert.equal((await pool.query("SELECT count(*) AS n FROM schema_migrations")).rows[0].n, 1);
  await pool.query("UPDATE schema_migrations SET checksum = 'changed'");
  await assert.rejects(migrate(pool), /Applied migration changed/);
  assert.equal((await pool.query("SELECT count(*) AS n FROM users")).rows[0].n, 0);
});

postgresTest(
  "postgres: journal imports serialize with every mutation and roll back together",
  async (pool) => {
    const journal = createPostgresJournal(pool);
    const imports = await Promise.all(
      Array.from({ length: 12 }, (_, i) => journal.importIfEmpty("owner", [night(`import-${i}`)])),
    );
    assert.equal(imports.filter((result) => result.imported).length, 1);
    assert.equal((await journal.list("owner")).length, 1);
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => journal.take("owner", night(`take-${i}`))),
    );
    assert.equal((await journal.list("owner")).length, 13);
    assert.equal(await journal.drop("other", "take-1"), null);
    await assert.rejects(
      journal.importIfEmpty("rollback", [
        night("ok"),
        { ...night("bad"), title: null } as unknown as LogEntry,
      ]),
      /null value/,
    );
    assert.deepEqual(await journal.list("rollback"), []);
  },
);

postgresTest("postgres: take racing import has a serial result without a merge", async (pool) => {
  const journal = createPostgresJournal(pool);
  for (let i = 0; i < 8; i++) {
    const owner = `race-${i}`;
    const [imported] = await Promise.all([
      journal.importIfEmpty(owner, [night("device")]),
      journal.take(owner, night("server")),
    ]);
    const ids = (await journal.list(owner)).map((item) => item.id).sort();
    assert.deepEqual(ids, imported.imported ? ["device", "server"] : ["server"]);
    const [, lateImport] = await Promise.all([
      journal.setStatus(owner, "server", "shipping"),
      journal.importIfEmpty(owner, [night("late")]),
    ]);
    assert.equal(lateImport.imported, false);
    assert.equal(
      (await journal.list(owner)).find((item) => item.id === "server")?.status,
      "shipping",
    );
  }
});

postgresTest(
  "postgres: concurrent first research deliveries replay without duplicate turns or spend",
  async (pool) => {
    const repo = createPostgresResearch(pool);
    const body = delivery({ status: "completed", report, turns: [turn("one")] });
    const results = await Promise.all(Array.from({ length: 12 }, () => repo.ingest("owner", body)));
    assert.equal(results.filter((item) => item.ok && !item.replay).length, 1);
    assert.equal(results.filter((item) => item.ok && item.replay).length, 11);
    const run = await repo.readRun("owner", body.threadId);
    assert.equal(run?.turns.length, 1);
    assert.equal(sumTurnSnapshots(run?.turns ?? []).totalTokens, 125);
    assert.equal((await pool.query("SELECT count(*) AS n FROM research_runs")).rows[0].n, 1);
  },
);

postgresTest(
  "postgres: concurrent research writers keep all turns and enforce first thread ownership",
  async (pool) => {
    const first = createPostgresResearch(pool);
    const second = createPostgresResearch(pool);
    const results = await Promise.all([
      first.ingest("a", delivery()),
      second.ingest("b", delivery()),
    ]);
    assert.equal(results.filter((item) => item.ok).length, 1);
    assert.equal(results.filter((item) => !item.ok && item.error === "forbidden").length, 1);
    const owner = results[0].ok ? "a" : "b";
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        (i % 2 ? first : second).ingest(owner, delivery({ turns: [turn(`turn-${i}`)] })),
      ),
    );
    assert.equal((await first.readRun(owner, "thread_atomic"))?.turns.length, 12);
    assert.equal(
      sumTurnSnapshots((await second.readRun(owner, "thread_atomic"))?.turns ?? []).totalTokens,
      1500,
    );
    const completed = await first.ingest(owner, delivery({ status: "completed", report }));
    assert.ok(completed.ok);
    if (!completed.ok) return;
    await Promise.all([
      second.ingest(owner, delivery({ status: "completed", report })),
      first.setPublished(owner, completed.run.id, false, 200),
    ]);
    assert.equal((await first.readRun(owner, "thread_atomic"))?.publishedAt, null);
  },
);

postgresTest(
  "postgres: failing a turn write rolls back run, all turns, and limit snapshot",
  async (pool) => {
    const repo = createPostgresResearch(pool);
    await pool.query(
      "ALTER TABLE research_turns ADD CONSTRAINT reject_fixture CHECK (turn_id <> 'reject')",
    );
    const limit = {
      readAt: 200,
      primary: null,
      secondary: null,
      spendControlReached: false,
      individualRemainingPercent: 40,
    };
    await assert.rejects(
      repo.ingest("owner", delivery({ turns: [turn("ok"), turn("reject")], limit })),
      /reject_fixture/,
    );
    assert.equal(await repo.readRun("owner", "thread_atomic"), null);
    assert.equal(await repo.readLimit("owner"), null);
    assert.equal((await pool.query("SELECT count(*) AS n FROM research_turns")).rows[0].n, 0);
    await repo.ingest("owner", delivery({ turns: [turn("original")] }));
    await assert.rejects(
      repo.ingest(
        "owner",
        delivery({ status: "completed", report, turns: [turn("reject")], limit }),
      ),
      /reject_fixture/,
    );
    const saved = await repo.readRun("owner", "thread_atomic");
    assert.equal(saved?.status, "in_progress");
    assert.deepEqual(
      saved?.turns.map((item) => item.turnId),
      ["original"],
    );
    assert.equal(await repo.readLimit("owner"), null);
  },
);

postgresTest(
  "postgres: queued limits on different threads retain the newest observation",
  async (pool) => {
    const repo = createPostgresResearch(pool);
    await Promise.all(
      [300, 100, 200].map((readAt) =>
        repo.ingest(
          "owner",
          delivery({
            threadId: `limit-${readAt}`,
            limit: {
              readAt,
              primary: null,
              secondary: null,
              spendControlReached: null,
              individualRemainingPercent: readAt / 10,
            },
          }),
        ),
      ),
    );
    assert.equal((await repo.readLimit("owner"))?.readAt, 300);
    assert.equal((await repo.readLimit("owner"))?.individualRemainingPercent, 30);
  },
);

postgresTest(
  "postgres: watch binding, observations, facts, and rate pause are shared across instances",
  async (pool) => {
    let id = 0;
    const a = createPostgresWatch(pool, () => `watch-${++id}`);
    const b = createPostgresWatch(pool, () => `watch-${++id}`);
    const run: WatchRun = {
      id: "run",
      owner: "Vitejs",
      repo: "Vite",
      number: 1,
      isPr: false,
      publishedAt: 100,
      status: "completed",
      report,
    };
    await Promise.all([a.bind(run), b.bind({ ...run, owner: "vitejs", repo: "vite" })]);
    assert.equal((await pool.query("SELECT count(*) AS n FROM github_subjects")).rows[0].n, 1);
    assert.equal((await pool.query("SELECT count(*) AS n FROM research_links")).rows[0].n, 1);
    const subject = (await a.due([run.id], 100, 0))[0]!;
    const observed: ObservedSubject = {
      nodeId: "node",
      kind: "issue",
      owner: "vitejs",
      repo: "vite",
      number: 1,
      authorLogin: "owner",
      title: "Latest",
      htmlUrl: "https://github.com/vitejs/vite/issues/1",
      state: "closed",
      draft: false,
      review: null,
      commentCount: 1,
    };
    await Promise.all([
      a.apply(subject.id, { type: "ok", observed }, 200),
      b.apply(subject.id, { type: "ok", observed }, 200),
    ]);
    assert.equal((await pool.query("SELECT count(*) AS n FROM github_facts")).rows[0].n, 1);
    await b.apply(
      subject.id,
      { type: "ok", observed: { ...observed, title: "Stale", state: "open" } },
      100,
    );
    assert.equal((await a.read(subject.id))?.title, "Latest");
    await Promise.all([a.pause(300), b.pause(200)]);
    assert.equal(await b.pausedUntil(), 300);
    assert.deepEqual(await a.due([run.id], 250, await b.pausedUntil()), []);
  },
);

postgresTest(
  "postgres: transferred watch subjects retarget links and facts atomically",
  async (pool) => {
    let id = 0;
    const book = createPostgresWatch(pool, () => `watch-${++id}`);
    const old: WatchRun = {
      id: "old",
      owner: "old",
      repo: "repo",
      number: 1,
      isPr: false,
      publishedAt: 1,
      status: "completed",
      report,
    };
    const moved = { ...old, id: "new", owner: "new" };
    await Promise.all([book.bind(old), book.bind(moved)]);
    const due = await book.due([old.id, moved.id], 1, 0);
    const observation: ObservedSubject = {
      nodeId: "same-node",
      kind: "issue",
      owner: "new",
      repo: "repo",
      number: 1,
      authorLogin: null,
      title: "Moved",
      htmlUrl: "https://github.com/new/repo/issues/1",
      state: "closed",
      draft: false,
      review: null,
      commentCount: 1,
    };
    await Promise.all(
      due.map((subject) => book.apply(subject.id, { type: "ok", observed: observation }, 100)),
    );
    const histories = await book.history([
      { id: "old", researcherLogin: "owner" },
      { id: "new", researcherLogin: "owner" },
    ]);
    assert.equal(histories.get("old")?.source?.title, "Moved");
    assert.equal(histories.get("new")?.source?.title, "Moved");
    // A response fetched before dedup can still update the canonical subject afterwards.
    for (const subject of due)
      await book.apply(
        subject.id,
        {
          type: "ok",
          observed: { ...observation, title: "Newest" },
        },
        200,
      );
    const newest = await book.history([{ id: "old", researcherLogin: "owner" }]);
    assert.equal(newest.get("old")?.source?.title, "Newest");

    assert.equal((await pool.query("SELECT count(*) AS n FROM github_subjects")).rows[0].n, 1);
    assert.equal((await pool.query("SELECT count(*) AS n FROM github_facts")).rows[0].n, 1);
  },
);

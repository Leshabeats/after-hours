import assert from "node:assert/strict";
import { it } from "node:test";
import { postgresTest } from "../db/testing.ts";
import type { ObservedSubject, WatchRun } from "./github-watch.ts";
import { createMemoryWatch, createPostgresWatch, type WatchBook } from "./watch-book.ts";

function run(id: string, owner: string): WatchRun {
  return {
    id,
    owner,
    repo: "repo",
    number: 9,
    isPr: false,
    publishedAt: 1,
    status: "completed",
    report: {
      schemaVersion: 1,
      findings: "Fixture",
      work: "Read",
      evidence: [],
      unknowns: [],
      nextSteps: [],
      links: [],
    },
  };
}
function observed(nodeId: string, owner: string, title: string): ObservedSubject {
  return {
    nodeId,
    owner,
    repo: "repo",
    number: 9,
    kind: "issue",
    authorLogin: null,
    title,
    htmlUrl: `https://github.com/${owner}/repo/issues/9`,
    state: "closed",
    draft: false,
    review: null,
    commentCount: 1,
  };
}
async function assertStaleDedup(book: WatchBook) {
  await book.bind(run("run-a", "old"));
  const a = (await book.due(["run-a"], 1, 0))[0]!;
  await book.apply(a.id, { type: "ok", observed: observed("node-a", "new", "Transferred A") }, 200);
  // A different object is now bound at the old coordinate.
  await book.bind(run("run-b", "old"));
  const b = (await book.due(["run-b"], 201, 0))[0]!;
  await book.apply(b.id, { type: "ok", observed: observed("node-b", "old", "Independent B") }, 201);
  await book.apply(a.id, { type: "ok", observed: observed("node-a", "old", "Delayed A") }, 100);
  assert.equal((await book.read(b.id))?.title, "Independent B");
  assert.equal((await book.read(a.id))?.title, "Transferred A");
  // A newer response with inconsistent coordinates cannot collapse distinct known nodes either.
  await book.apply(
    a.id,
    { type: "ok", observed: observed("node-a", "old", "Wrong coordinate A") },
    300,
  );
  const history = await book.history([
    { id: "run-a", researcherLogin: "a" },
    { id: "run-b", researcherLogin: "b" },
  ]);
  assert.equal(history.get("run-a")?.source?.title, "Transferred A");
  assert.equal(history.get("run-b")?.source?.title, "Independent B");
  assert.deepEqual(
    history.get("run-b")?.source?.facts.map((fact) => fact.kind),
    ["closed"],
  );

  // The original row can still be unknown while its canonical node already has a newer snapshot.
  await book.bind(run("run-c", "old-c"));
  await book.bind(run("run-d", "new-c"));
  const c = (await book.due(["run-c"], 1, 0))[0]!;
  const d = (await book.due(["run-d"], 1, 0))[0]!;
  await book.apply(
    d.id,
    { type: "ok", observed: observed("node-c", "new-c", "New canonical C") },
    500,
  );
  await book.apply(c.id, { type: "ok", observed: observed("node-c", "new-c", "Delayed C") }, 400);
  assert.equal((await book.read(c.id))?.checkedAt, null);
  assert.equal((await book.read(d.id))?.title, "New canonical C");
}

it("memory: stale transfer responses cannot delete independent subjects or newer canonical data", async () => {
  let id = 0;
  await assertStaleDedup(createMemoryWatch(() => `memory-${++id}`));
});
postgresTest(
  "postgres: stale transfer responses cannot delete independent subjects or newer canonical data",
  async (pool) => {
    let id = 0;
    await assertStaleDedup(createPostgresWatch(pool, () => `postgres-${++id}`));
  },
);

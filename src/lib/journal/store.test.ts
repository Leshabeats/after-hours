import assert from "node:assert/strict";
import { isolatedDatabase } from "../db/testing.ts";
import { describe, it } from "node:test";
import { createMemoryJournal, createPostgresJournal, type JournalRepo } from "./store.ts";
import type { LogEntry } from "./types.ts";

function entry(id: string): LogEntry {
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
    takenAt: 1,
  };
}

describe("journal isolation", () => {
  it("never lists or mutates another user's night", async () => {
    const journal = createMemoryJournal();
    await journal.take("a", entry("vitejs/vite#1"));
    await journal.take("b", entry("golang/go#2"));

    assert.deepEqual(
      (await journal.list("a")).map((item) => item.id),
      ["vitejs/vite#1"],
    );
    assert.equal(await journal.setStatus("a", "golang/go#2", "shipped"), null);
    assert.equal(await journal.drop("a", "golang/go#2"), null);
    assert.equal((await journal.list("b")).length, 1);
    assert.equal((await journal.list("b"))[0]?.status, "taken");
  });

  it("updates and drops only the owner row", async () => {
    const journal = createMemoryJournal();
    await journal.take("a", entry("vitejs/vite#1"));
    const updated = await journal.setStatus("a", "vitejs/vite#1", "shipping");
    assert.equal(updated?.[0]?.status, "shipping");
    assert.equal((await journal.drop("a", "vitejs/vite#1"))?.length, 0);
    assert.equal((await journal.list("a")).length, 0);
  });
});

async function assertImportIfEmpty(journal: JournalRepo) {
  const local = [
    { ...entry("vitejs/vite#1"), status: "shipping" as const, takenAt: 50 },
    { ...entry("golang/go#2"), status: "shipped" as const, takenAt: 40 },
    entry("vitejs/vite#1"),
  ];

  const empty = await journal.importIfEmpty("b", local);
  assert.equal(empty.imported, true);
  assert.deepEqual(
    empty.entries.map((item) => item.id),
    ["vitejs/vite#1", "golang/go#2"],
  );
  assert.equal(empty.entries[0]?.status, "shipping");
  assert.equal(empty.entries[0]?.takenAt, 50);

  await journal.take("a", entry("facebook/react#3"));
  const blocked = await journal.importIfEmpty("a", [entry("vitejs/vite#1")]);
  assert.equal(blocked.imported, false);
  assert.deepEqual(
    blocked.entries.map((item) => item.id),
    ["facebook/react#3"],
  );
  assert.equal((await journal.list("b")).length, 2);
}

describe("importIfEmpty", () => {
  it("memory: copies into an empty journal and refuses a merge", async () => {
    await assertImportIfEmpty(createMemoryJournal());
  });

  it(
    "postgres: copies into an empty journal and refuses a merge",
    { skip: !process.env.TEST_DATABASE_URL },
    async () => {
      const isolated = await isolatedDatabase();
      const db = isolated.pool;
      try {
        await assertImportIfEmpty(createPostgresJournal(db));
      } finally {
        await isolated.close();
      }
    },
  );
});

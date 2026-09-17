import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryJournal } from "./store.ts";
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
  it("never lists or mutates another user's night", () => {
    const journal = createMemoryJournal();
    journal.take("a", entry("vitejs/vite#1"));
    journal.take("b", entry("golang/go#2"));

    assert.deepEqual(
      journal.list("a").map((item) => item.id),
      ["vitejs/vite#1"],
    );
    assert.equal(journal.setStatus("a", "golang/go#2", "shipped"), null);
    assert.equal(journal.drop("a", "golang/go#2"), null);
    assert.equal(journal.list("b").length, 1);
    assert.equal(journal.list("b")[0]?.status, "taken");
  });

  it("updates and drops only the owner row", () => {
    const journal = createMemoryJournal();
    journal.take("a", entry("vitejs/vite#1"));
    const updated = journal.setStatus("a", "vitejs/vite#1", "shipping");
    assert.equal(updated?.[0]?.status, "shipping");
    assert.equal(journal.drop("a", "vitejs/vite#1")?.length, 0);
    assert.equal(journal.list("a").length, 0);
  });
});

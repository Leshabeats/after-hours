import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeJournal } from "./stats.ts";
import type { LogEntry } from "./types.ts";

function entry(
  id: string,
  status: LogEntry["status"],
  kind: LogEntry["kind"] = "blinding",
): LogEntry {
  return {
    id,
    owner: "vitejs",
    repo: "vite",
    number: 1,
    title: id,
    kind,
    url: "https://github.com/vitejs/vite/issues/1",
    isPr: false,
    status,
    takenAt: 1,
  };
}

describe("summarizeJournal", () => {
  it("is empty when the night is empty", () => {
    const stats = summarizeJournal([]);
    assert.equal(stats.total, 0);
    assert.equal(stats.taken, 0);
    assert.equal(stats.shipping, 0);
    assert.equal(stats.shipped, 0);
    assert.equal(stats.topKind, null);
  });

  it("counts statuses and picks the most common kind", () => {
    const stats = summarizeJournal([
      entry("a", "taken", "blinding"),
      entry("b", "shipping", "eyes"),
      entry("c", "shipped", "blinding"),
      entry("d", "shipped", "tears"),
    ]);
    assert.equal(stats.total, 4);
    assert.equal(stats.taken, 1);
    assert.equal(stats.shipping, 1);
    assert.equal(stats.shipped, 2);
    assert.equal(stats.topKind, "blinding");
    assert.equal(stats.byKind.blinding, 2);
  });

  it("breaks kind ties in KINDS order", () => {
    const stats = summarizeJournal([
      entry("a", "taken", "late"),
      entry("b", "taken", "alone"),
    ]);
    assert.equal(stats.topKind, "alone");
  });
});

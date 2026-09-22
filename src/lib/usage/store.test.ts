import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { usageInputSchema } from "./schema.ts";
import { summarizeUsage } from "./stats.ts";
import { createMemoryUsage, createSqliteUsage, type UsageRepo } from "./store.ts";
import type { UsageEvent } from "./types.ts";

function spend(
  harness: string,
  inputTokens: number,
  outputTokens = 0,
  at = 1_000,
): UsageEvent {
  return {
    at,
    harness,
    model: "grok-4",
    inputTokens,
    outputTokens,
  };
}

function assertIsolation(repo: UsageRepo) {
  repo.record("a", spend("codex", 100, 20, 2_000));
  repo.record("b", spend("claude", 9_000, 99, 3_000));

  const a = repo.list("a");
  const b = repo.list("b");
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0]?.harness, "codex");
  assert.equal(b[0]?.harness, "claude");
  assert.equal(summarizeUsage(a).allTimeTokens, 120);
  assert.equal(summarizeUsage(b).allTimeTokens, 9_099);
  assert.equal(summarizeUsage(a).lastHarness, "codex");
  assert.equal(summarizeUsage(b).lastHarness, "claude");
}

describe("usage isolation", () => {
  it("memory: user A cannot see B's usage", () => {
    assertIsolation(createMemoryUsage());
  });

  it("sqlite: user A cannot see B's usage", () => {
    const db = new DatabaseSync(":memory:");
    try {
      assertIsolation(createSqliteUsage(db));
    } finally {
      db.close();
    }
  });
});

describe("usageInputSchema", () => {
  it("drops a client-sent user id", () => {
    const parsed = usageInputSchema.parse({
      userId: "attacker",
      harness: "codex",
      model: "grok-4",
      inputTokens: 1,
      outputTokens: 2,
    });
    assert.equal("userId" in parsed, false);
    assert.equal(parsed.harness, "codex");
  });
});

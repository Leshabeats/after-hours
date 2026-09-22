import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeUsage, USAGE_WEEK_MS } from "./stats.ts";
import type { UsageEvent } from "./types.ts";

const NOW = Date.UTC(2026, 8, 17, 12, 0, 0);

function event(
  at: number,
  harness: string,
  inputTokens: number,
  outputTokens: number,
): UsageEvent {
  return {
    at,
    harness,
    model: "grok-4",
    inputTokens,
    outputTokens,
  };
}

describe("summarizeUsage", () => {
  it("is empty when there are no events", () => {
    const stats = summarizeUsage([], NOW);
    assert.equal(stats.weekTokens, 0);
    assert.equal(stats.allTimeTokens, 0);
    assert.equal(stats.lastHarness, null);
  });

  it("sums input+output, keeps week and all-time apart, names the latest harness", () => {
    const stats = summarizeUsage(
      [
        event(NOW - USAGE_WEEK_MS - 1, "claude", 50, 5),
        event(NOW - 3_600_000, "codex", 100, 20),
        event(NOW - 1_000, "cursor", 10, 2),
      ],
      NOW,
    );
    assert.equal(stats.weekTokens, 132);
    assert.equal(stats.allTimeTokens, 187);
    assert.equal(stats.lastHarness, "cursor");
  });

  it("does not let a future timestamp own the harness name", () => {
    const stats = summarizeUsage(
      [
        event(NOW - 1_000, "codex", 10, 0),
        event(NOW + 60_000, "future", 500, 500),
      ],
      NOW,
    );
    assert.equal(stats.lastHarness, "codex");
    assert.equal(stats.weekTokens, 10);
    assert.equal(stats.allTimeTokens, 1010);
  });

  it("includes events exactly at the week boundary and at now", () => {
    const stats = summarizeUsage(
      [event(NOW - USAGE_WEEK_MS, "old", 7, 0), event(NOW, "now", 3, 1)],
      NOW,
    );
    assert.equal(stats.weekTokens, 11);
    assert.equal(stats.allTimeTokens, 11);
    assert.equal(stats.lastHarness, "now");
  });
});

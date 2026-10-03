import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertProbeMethod,
  summarizeRateLimits,
  summarizeThreads,
} from "./codex-app-server-probe.mjs";

describe("codex app-server probe", () => {
  it("counts threads without keeping titles, previews, or ids", () => {
    const summary = summarizeThreads([
      {
        id: "0199a0e0-7c31-7a55-8c1e-6a5d0e8a9c11",
        source: "vscode",
        originator: "Codex Desktop",
        status: { type: "notLoaded" },
        preview: "secret task text",
        name: "private title",
        path: "/Users/me/.codex/sessions/secret.jsonl",
      },
      {
        id: "not-a-uuid",
        source: { subAgent: { other: "guardian" } },
        originator: null,
        status: { type: "active", activeFlags: ["waitingOnUserInput"] },
      },
    ]);

    assert.deepEqual(summary, {
      count: 2,
      uuidIds: 1,
      sources: { vscode: 1, subAgent: 1 },
      originators: { "Codex Desktop": 1, null: 1 },
      statuses: { notLoaded: 1, "active:waitingOnUserInput": 1 },
    });
    assert.equal(JSON.stringify(summary).includes("secret"), false);
    assert.equal(JSON.stringify(summary).includes("0199a0e0"), false);
  });

  it("keeps rate-limit windows and drops the account id", () => {
    const summary = summarizeRateLimits({
      accountId: "acct_secret",
      ordinaryUsageAllowed: true,
      rateLimits: {
        limitId: "codex",
        planType: "pro",
        primary: { usedPercent: 22, windowDurationMins: 10080, resetsAt: 1_800_000_000 },
        secondary: null,
        rateLimitReachedType: null,
      },
    });

    assert.equal(summary.accountIdPresent, true);
    assert.equal(summary.planTypePresent, true);
    assert.equal(summary.ordinaryUsageAllowed, true);
    assert.deepEqual(summary.primary, {
      usedPercent: 22,
      windowDurationMins: 10080,
      resetsAtPresent: true,
    });
    assert.equal(summary.secondary, null);
    assert.equal(JSON.stringify(summary).includes("acct_secret"), false);
    assert.equal(JSON.stringify(summary).includes("pro"), false);
  });

  it("treats a missing limit window as unavailable", () => {
    const summary = summarizeRateLimits({ rateLimits: { primary: null } });
    assert.equal(summary.primary, null);
    assert.equal(summary.ordinaryUsageAllowed, null);
    assert.equal(summary.accountIdPresent, false);
  });

  it("refuses a model turn", () => {
    assert.doesNotThrow(() => assertProbeMethod("thread/list"));
    assert.throws(() => assertProbeMethod("turn/start"), /refuses turn\/start/);
    assert.throws(() => assertProbeMethod("thread/start"), /refuses thread\/start/);
  });
});

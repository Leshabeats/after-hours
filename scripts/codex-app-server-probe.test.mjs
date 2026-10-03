import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertProbeMethod,
  runProbe,
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

    assert.equal(
      JSON.stringify(summary),
      JSON.stringify({
        count: 2,
        uuidIds: 1,
        sources: { vscode: 1, subAgent: 1 },
        originators: { "Codex Desktop": 1, null: 1 },
        statuses: { notLoaded: 1, "active:waitingOnUserInput": 1 },
      }),
    );
    assert.equal(JSON.stringify(summary).includes("secret"), false);
    assert.equal(JSON.stringify(summary).includes("0199a0e0"), false);
  });

  it("counts originators that collide with object prototype names", () => {
    const summary = summarizeThreads([
      { originator: "constructor", source: "cli", status: { type: "idle" } },
      { originator: "toString", source: "cli", status: { type: "idle" } },
      { originator: "__proto__", source: "cli", status: { type: "idle" } },
    ]);
    const expected = Object.create(null);
    expected.constructor = 1;
    expected.toString = 1;
    expected.__proto__ = 1;
    assert.equal(JSON.stringify(summary.originators), JSON.stringify(expected));
    assert.equal(summary.originators.constructor, 1);
    assert.equal(summary.originators.toString, 1);
    assert.equal(summary.originators.__proto__, 1);
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
    assert.deepEqual(summary.buckets, []);
    assert.equal(JSON.stringify(summary).includes("acct_secret"), false);
    assert.equal(JSON.stringify(summary).includes("pro"), false);
  });

  it("keeps every rate-limit bucket and drops plan names", () => {
    const summary = summarizeRateLimits({
      accountId: "acct_secret",
      rateLimits: {
        limitId: "codex",
        planType: "pro",
        primary: { usedPercent: 22, windowDurationMins: 10080, resetsAt: 1 },
        secondary: null,
      },
      rateLimitsByLimitId: {
        codex: {
          limitId: "codex",
          planType: "pro",
          primary: { usedPercent: 22, windowDurationMins: 10080, resetsAt: 1 },
          secondary: null,
        },
        extra: {
          limitId: "extra",
          planType: "pro",
          primary: { usedPercent: 5, windowDurationMins: 60, resetsAt: null },
          secondary: { usedPercent: 9, windowDurationMins: 300, resetsAt: 2 },
        },
      },
    });

    assert.deepEqual(summary.buckets, [
      {
        limitId: "codex",
        primary: { usedPercent: 22, windowDurationMins: 10080, resetsAtPresent: true },
        secondary: null,
        rateLimitReachedType: null,
      },
      {
        limitId: "extra",
        primary: { usedPercent: 5, windowDurationMins: 60, resetsAtPresent: false },
        secondary: { usedPercent: 9, windowDurationMins: 300, resetsAtPresent: true },
        rateLimitReachedType: null,
      },
    ]);
    assert.equal(JSON.stringify(summary).includes("pro"), false);
    assert.equal(JSON.stringify(summary).includes("acct_secret"), false);
  });

  it("treats a missing limit window as unavailable", () => {
    const summary = summarizeRateLimits({ rateLimits: { primary: null } });
    assert.equal(summary.primary, null);
    assert.equal(summary.ordinaryUsageAllowed, null);
    assert.equal(summary.accountIdPresent, false);
  });

  it("reports a missing codex binary instead of hanging", async () => {
    const started = Date.now();
    await assert.rejects(
      () => runProbe({ bin: "/tmp/after-hours-missing-codex" }),
      /failed to start: ENOENT/,
    );
    assert.ok(Date.now() - started < 5_000);
  });

  it("reports a process that exits before the handshake", async () => {
    const started = Date.now();
    await assert.rejects(() => runProbe({ bin: "/usr/bin/true" }), /exited \(code 0\)/);
    assert.ok(Date.now() - started < 5_000);
  });

  it("refuses a model turn", () => {
    assert.doesNotThrow(() => assertProbeMethod("thread/list"));
    assert.throws(() => assertProbeMethod("turn/start"), /refuses turn\/start/);
    assert.throws(() => assertProbeMethod("thread/start"), /refuses thread\/start/);
  });
});

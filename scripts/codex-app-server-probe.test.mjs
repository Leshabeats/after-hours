import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assertProbeMethod,
  redactDiagnostic,
  runProbe,
  stderrDetail,
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

  it("redacts originator paths, ids, and emails", () => {
    const summary = summarizeThreads([
      {
        id: "not-a-uuid",
        source: "cli",
        originator: "/Users/alice/private/0199a0e0-7c31-7a55-8c1e-6a5d0e8a9c22",
        status: { type: "idle" },
      },
      {
        id: "also-not-a-uuid",
        source: "cli",
        originator: "alice@example.com",
        status: { type: "idle" },
      },
      {
        id: "still-not-a-uuid",
        source: "cli",
        originator: "Codex Desktop",
        status: { type: "idle" },
      },
    ]);
    const json = JSON.stringify(summary);
    assert.equal(json.includes("alice"), false);
    assert.equal(json.includes("/Users"), false);
    assert.equal(json.includes("0199a0e0"), false);
    assert.equal(json.includes("example.com"), false);
    assert.equal(summary.originators["[redacted]"], 2);
    assert.equal(summary.originators["Codex Desktop"], 1);
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
    assert.equal(summary.spendControlReached, null);
    assert.equal(summary.individualRemainingPercent, null);
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
        spendControlReached: null,
        individualRemainingPercent: null,
        credits: null,
      },
      {
        limitId: "extra",
        primary: { usedPercent: 5, windowDurationMins: 60, resetsAtPresent: false },
        secondary: { usedPercent: 9, windowDurationMins: 300, resetsAtPresent: true },
        rateLimitReachedType: null,
        spendControlReached: null,
        individualRemainingPercent: null,
        credits: null,
      },
    ]);
    assert.equal(JSON.stringify(summary).includes("pro"), false);
    assert.equal(JSON.stringify(summary).includes("acct_secret"), false);
  });

  it("keeps a blocked spend control when the usage window is still open", () => {
    const summary = summarizeRateLimits({
      ordinaryUsageAllowed: false,
      rateLimits: {
        limitId: "codex",
        primary: { usedPercent: 10, windowDurationMins: 60, resetsAt: 1 },
        secondary: null,
        spendControlReached: true,
        individualLimit: {
          limit: "usd-secret-limit",
          remainingPercent: 0,
          resetsAt: 5,
          used: "usd-secret-used",
        },
      },
      rateLimitsByLimitId: {
        codex: {
          limitId: "codex",
          primary: { usedPercent: 10, windowDurationMins: 60, resetsAt: 1 },
          spendControlReached: true,
          individualLimit: {
            remainingPercent: 0,
            limit: "usd-secret-limit",
            resetsAt: 5,
            used: "1",
          },
        },
      },
    });

    assert.equal(summary.spendControlReached, true);
    assert.equal(summary.individualRemainingPercent, 0);
    assert.equal(summary.primary.usedPercent, 10);
    assert.equal(summary.buckets[0].spendControlReached, true);
    assert.equal(summary.buckets[0].individualRemainingPercent, 0);
    assert.equal(JSON.stringify(summary).includes("usd-secret"), false);
  });

  it("keeps credit flags and drops the balance when the window is exhausted", () => {
    const summary = summarizeRateLimits({
      ordinaryUsageAllowed: false,
      rateLimits: {
        primary: { usedPercent: 100, windowDurationMins: 60, resetsAt: 1 },
        secondary: null,
        credits: { hasCredits: true, unlimited: false, balance: "secret-balance" },
      },
      rateLimitsByLimitId: {
        codex: {
          limitId: "codex",
          primary: { usedPercent: 100, windowDurationMins: 60, resetsAt: 1 },
          credits: { hasCredits: false, unlimited: true, balance: "secret-balance" },
        },
      },
    });

    assert.equal(summary.ordinaryUsageAllowed, false);
    assert.deepEqual(summary.credits, { hasCredits: true, unlimited: false });
    assert.deepEqual(summary.buckets[0].credits, { hasCredits: false, unlimited: true });
    assert.equal(JSON.stringify(summary).includes("secret-balance"), false);
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
    const dir = mkdtempSync(join(tmpdir(), "ah-probe-"));
    const helper = join(dir, "exit0.mjs");
    writeFileSync(helper, "process.exit(0);\n");
    const started = Date.now();
    try {
      await assert.rejects(
        () => runProbe({ bin: process.execPath, args: [helper] }),
        /exited \(code 0\)/,
      );
      assert.ok(Date.now() - started < 5_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("redacts local paths and thread ids from diagnostics", () => {
    const text = redactDiagnostic(
      "missing /Users/me/.codex/sessions/rollout.jsonl id 0199a0e0-7c31-7a55-8c1e-6a5d0e8a9c11 and C:\\Users\\me\\.codex\\a.jsonl",
    );
    assert.equal(text.includes("/Users"), false);
    assert.equal(text.includes("0199a0e0"), false);
    assert.equal(text.includes("C:\\Users"), false);
    assert.equal(text.includes("[redacted]"), true);
    assert.equal(text.startsWith("missing "), true);
  });

  it("redacts rollout paths whose home directory contains a space", () => {
    const windows = redactDiagnostic(
      "failed to resolve rollout path `C:\\Users\\Jane Doe\\.codex\\sessions\\rollout.jsonl`: file does not exist",
    );
    const unix = redactDiagnostic("missing /Users/Jane Doe/.codex/sessions/rollout.jsonl");
    assert.equal(windows.includes("Jane Doe"), false);
    assert.equal(windows.includes(".codex"), false);
    assert.equal(windows.includes("file does not exist"), true);
    assert.equal(unix.includes("Jane Doe"), false);
    assert.equal(unix.includes(".codex"), false);
    assert.equal(unix.startsWith("missing "), true);
  });

  it("redacts UNC paths and profile names of more than two words", () => {
    const unc = redactDiagnostic(
      "failed \\\\server\\share\\Ada Lovelace\\.codex\\sessions\\rollout.jsonl: file does not exist",
    );
    const three = redactDiagnostic(
      "failed to resolve rollout path `C:\\Users\\Maria Jose Garcia\\.codex\\sessions\\rollout.jsonl`: file does not exist",
    );
    const programFiles = redactDiagnostic(
      "missing C:\\Program Files (x86)\\Codex\\sessions\\a.jsonl after",
    );
    assert.equal(unc.includes("server"), false);
    assert.equal(unc.includes("Lovelace"), false);
    assert.equal(unc.includes(".codex"), false);
    assert.equal(unc.includes("file does not exist"), true);
    assert.equal(three.includes("Maria"), false);
    assert.equal(three.includes("Jose"), false);
    assert.equal(three.includes("Garcia"), false);
    assert.equal(three.includes(".codex"), false);
    assert.equal(three.includes("file does not exist"), true);
    assert.equal(programFiles.includes("Program"), false);
    assert.equal(programFiles.includes("x86"), false);
    assert.equal(programFiles.includes("Codex"), false);
    assert.equal(programFiles.includes("after"), true);
  });

  it("redacts an apostrophe in a profile name and a spaced final filename", () => {
    const named = redactDiagnostic(
      "failed to resolve rollout path `C:\\Users\\O'Brien\\.codex\\sessions\\rollout.jsonl`: file does not exist",
    );
    const spacedFile = redactDiagnostic("missing /tmp/Private Project.jsonl afterwards");
    assert.equal(named.includes("Brien"), false);
    assert.equal(named.includes(".codex"), false);
    assert.equal(named.includes("file does not exist"), true);
    assert.equal(spacedFile.includes("Private"), false);
    assert.equal(spacedFile.includes("Project"), false);
    assert.equal(spacedFile.includes(".jsonl"), false);
    assert.equal(spacedFile.includes("afterwards"), true);
  });

  it("redacts a quoted path through every spaced word", () => {
    const filename = redactDiagnostic(
      "failed to resolve rollout path `/tmp/My Private Project.jsonl`: file does not exist",
    );
    const home = redactDiagnostic(
      "failed to resolve rollout path `C:\\Users\\Jane Doe`: file does not exist",
    );
    const notes = redactDiagnostic(
      "missing C:\\Users\\Mary Ann Smith\\My Private Notes.jsonl afterwards",
    );
    assert.equal(filename.includes("Private"), false);
    assert.equal(filename.includes("Project"), false);
    assert.equal(filename.includes("file does not exist"), true);
    assert.equal(home.includes("Jane"), false);
    assert.equal(home.includes("Doe"), false);
    assert.equal(home.includes("file does not exist"), true);
    assert.equal(notes.includes("Mary"), false);
    assert.equal(notes.includes("Ann"), false);
    assert.equal(notes.includes("Smith"), false);
    assert.equal(notes.includes("Private"), false);
    assert.equal(notes.includes("Notes"), false);
    assert.equal(notes.includes("afterwards"), true);
  });

  it("redacts an extensionless folder name that contains spaces", () => {
    const folder = redactDiagnostic("permission denied: /tmp/Private Folder");
    const longer = redactDiagnostic("permission denied: /tmp/My Private Folder");
    assert.equal(folder.includes("Private"), false);
    assert.equal(folder.includes("Folder"), false);
    assert.equal(folder.includes("permission denied:"), true);
    assert.equal(longer.includes("My"), false);
    assert.equal(longer.includes("Private"), false);
    assert.equal(longer.includes("Folder"), false);
    assert.equal(longer.startsWith("permission denied:"), true);
  });

  it("redacts stderr before keeping the last 500 characters", () => {
    const text = `C:\\Users\\Jane Doe\\.codex\\sessions\\rollout.jsonl${"y".repeat(458)}`;
    const detail = stderrDetail(text);
    assert.equal(text.slice(-500).includes("Jane"), true);
    assert.equal(detail.includes("Jane"), false);
    assert.equal(detail.includes("Doe"), false);
    assert.equal(detail.includes(".codex"), false);
    assert.equal(detail.length <= 500, true);
  });

  it("reads rate limits when the thread list fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-probe-"));
    const helper = join(dir, "list-error.mjs");
    writeFileSync(
      helper,
      [
        'import { createInterface } from "node:readline";',
        "const rl = createInterface({ input: process.stdin });",
        "rl.on('line', (line) => {",
        "  let message;",
        "  try { message = JSON.parse(line); } catch { return; }",
        '  if (message.method === "initialize") {',
        '    process.stdout.write(JSON.stringify({ id: message.id, result: { userAgent: "stub" } }) + "\\n");',
        "    return;",
        "  }",
        '  if (message.method === "thread/list") {',
        "    process.stdout.write(JSON.stringify({ id: message.id, error: { code: -32603, message: 'corrupt /tmp/secret-rollout.jsonl' } }) + '\\n');",
        "    return;",
        "  }",
        '  if (message.method === "account/rateLimits/read") {',
        "    process.stdout.write(JSON.stringify({ id: message.id, result: { ordinaryUsageAllowed: false, rateLimits: { limitId: 'codex', primary: { usedPercent: 10, windowDurationMins: 60, resetsAt: 1 }, secondary: null, spendControlReached: true, individualLimit: { limit: 'usd-secret-limit', remainingPercent: 0, resetsAt: 5, used: 'usd-secret-used' } } } }) + '\\n');",
        "  }",
        "});",
        "",
      ].join("\n"),
    );
    try {
      const summary = await runProbe({ bin: process.execPath, args: [helper] });
      assert.match(summary.threads.error, /^-32603: /);
      assert.equal(summary.threads.error.includes("secret-rollout"), false);
      assert.equal(summary.rateLimits.spendControlReached, true);
      assert.equal(summary.rateLimits.individualRemainingPercent, 0);
      assert.equal(summary.rateLimits.primary.usedPercent, 10);
      assert.equal(JSON.stringify(summary).includes("usd-secret"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("counts archived threads together with the active slice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-probe-"));
    const helper = join(dir, "archived.mjs");
    writeFileSync(
      helper,
      [
        'import { createInterface } from "node:readline";',
        "const rl = createInterface({ input: process.stdin });",
        "rl.on('line', (line) => {",
        "  let message;",
        "  try { message = JSON.parse(line); } catch { return; }",
        '  if (message.method === "initialize") {',
        '    process.stdout.write(JSON.stringify({ id: message.id, result: { userAgent: "stub" } }) + "\\n");',
        "    return;",
        "  }",
        '  if (message.method === "thread/list") {',
        "    const archived = message.params && message.params.archived === true;",
        "    const thread = {",
        '      id: archived ? "0199a0e0-7c31-7a55-8c1e-6a5d0e8a9c22" : "0199a0e0-7c31-7a55-8c1e-6a5d0e8a9c11",',
        '      source: "cli",',
        '      originator: archived ? "archived-origin" : "live-origin",',
        '      status: { type: "idle" },',
        "    };",
        "    process.stdout.write(JSON.stringify({ id: message.id, result: { data: [thread], nextCursor: null } }) + '\\n');",
        "    return;",
        "  }",
        '  if (message.method === "account/rateLimits/read") {',
        "    process.stdout.write(JSON.stringify({ id: message.id, result: { rateLimits: { primary: null } } }) + '\\n');",
        "  }",
        "});",
        "",
      ].join("\n"),
    );
    try {
      const summary = await runProbe({ bin: process.execPath, args: [helper] });
      assert.equal(summary.threads.count, 2);
      assert.equal(summary.threads.uuidIds, 2);
      assert.equal(summary.threads.scope, "interactive");
      assert.equal(summary.threads.archivedIncluded, true);
      assert.equal(summary.threads.more, false);
      assert.equal(summary.threads.originators["live-origin"], 1);
      assert.equal(summary.threads.originators["archived-origin"], 1);
      assert.equal(JSON.stringify(summary).includes("0199a0e0"), false);
      assert.equal(summary.rateLimits.primary, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the active count when the archived slice fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-probe-"));
    const helper = join(dir, "archived-error.mjs");
    writeFileSync(
      helper,
      [
        'import { createInterface } from "node:readline";',
        "const rl = createInterface({ input: process.stdin });",
        "rl.on('line', (line) => {",
        "  let message;",
        "  try { message = JSON.parse(line); } catch { return; }",
        '  if (message.method === "initialize") {',
        '    process.stdout.write(JSON.stringify({ id: message.id, result: { userAgent: "stub" } }) + "\\n");',
        "    return;",
        "  }",
        '  if (message.method === "thread/list") {',
        "    if (message.params && message.params.archived === true) {",
        "      process.stdout.write(JSON.stringify({ id: message.id, error: { code: -32603, message: 'archived /tmp/secret-archive.jsonl' } }) + '\\n');",
        "      return;",
        "    }",
        "    const thread = {",
        '      id: "0199a0e0-7c31-7a55-8c1e-6a5d0e8a9c11",',
        '      source: "cli",',
        '      originator: "live-origin",',
        '      status: { type: "idle" },',
        "    };",
        "    process.stdout.write(JSON.stringify({ id: message.id, result: { data: [thread], nextCursor: null } }) + '\\n');",
        "    return;",
        "  }",
        '  if (message.method === "account/rateLimits/read") {',
        "    process.stdout.write(JSON.stringify({ id: message.id, result: { rateLimits: { primary: { usedPercent: 4, windowDurationMins: 60, resetsAt: null } } } }) + '\\n');",
        "  }",
        "});",
        "",
      ].join("\n"),
    );
    try {
      const summary = await runProbe({ bin: process.execPath, args: [helper] });
      assert.equal(summary.threads.count, 1);
      assert.equal(summary.threads.archivedIncluded, false);
      assert.match(summary.threads.archivedError, /^-32603: /);
      assert.equal(summary.threads.archivedError.includes("secret-archive"), false);
      assert.equal(summary.threads.originators["live-origin"], 1);
      assert.equal(summary.rateLimits.primary.usedPercent, 4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a model turn", () => {
    assert.doesNotThrow(() => assertProbeMethod("thread/list"));
    assert.throws(() => assertProbeMethod("turn/start"), /refuses turn\/start/);
    assert.throws(() => assertProbeMethod("thread/start"), /refuses thread\/start/);
  });
});

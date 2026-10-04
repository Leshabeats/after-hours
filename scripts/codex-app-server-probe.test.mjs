import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  appServerLaunch,
  assertProbeMethod,
  bindStdin,
  formatFailure,
  shouldKillChild,
  stopChild,
  terminateChild,
  redactDiagnostic,
  retainStderr,
  runProbe,
  stderrDetail,
  stderrText,
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
        missingOriginators: 1,
        originators: { "Codex Desktop": 1 },
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

  it("counts a missing originator apart from the label null", () => {
    const summary = summarizeThreads([
      { originator: null, source: "cli", status: { type: "idle" } },
      { source: "cli", status: { type: "idle" } },
      { originator: "null", source: "cli", status: { type: "idle" } },
    ]);
    assert.equal(summary.missingOriginators, 2);
    assert.equal(summary.originators.null, 1);
  });

  it("redacts a custom source path and keeps atlas", () => {
    const summary = summarizeThreads([
      {
        id: "not-a-uuid",
        source: { custom: "/Users/alice/private/0199a0e0-7c31-7a55-8c1e-6a5d0e8a9c22" },
        originator: "Codex Desktop",
        status: { type: "idle" },
      },
      {
        id: "also-not-a-uuid",
        source: { custom: "atlas" },
        originator: "Codex Desktop",
        status: { type: "idle" },
      },
    ]);
    const json = JSON.stringify(summary);
    assert.equal(json.includes("alice"), false);
    assert.equal(json.includes("/Users"), false);
    assert.equal(json.includes("0199a0e0"), false);
    assert.equal(summary.sources["[redacted]"], 1);
    assert.equal(summary.sources["custom:atlas"], 1);
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

  it("keeps the reset-credit count and drops credit ids", () => {
    const summary = summarizeRateLimits({
      ordinaryUsageAllowed: false,
      rateLimits: { primary: { usedPercent: 100, windowDurationMins: 60, resetsAt: 1 } },
      rateLimitResetCredits: {
        availableCount: 2,
        credits: [{ id: "secret-credit-id", title: "secret-title", description: "secret-body" }],
      },
    });
    const missing = summarizeRateLimits({ rateLimits: { primary: null } });

    assert.equal(summary.resetCreditsAvailable, 2);
    assert.equal(missing.resetCreditsAvailable, null);
    assert.equal(JSON.stringify(summary).includes("secret-credit"), false);
    assert.equal(JSON.stringify(summary).includes("secret-title"), false);
    assert.equal(JSON.stringify(summary).includes("secret-body"), false);
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
    const threadId = "0199a0e0-7c31-7a55-8c1e-6a5d0e8a9c11";
    assert.equal(redactDiagnostic(`thread_${threadId}`).includes("0199a0e0"), false);
    assert.equal(redactDiagnostic(`${threadId}_suffix`).includes("0199a0e0"), false);
    const underscored = summarizeThreads([
      {
        id: "not-a-uuid",
        originator: `thread_${threadId}`,
        source: "cli",
        status: { type: "idle" },
      },
    ]);
    assert.equal(JSON.stringify(underscored).includes("0199a0e0"), false);
    assert.equal(underscored.originators["[redacted]"], 1);
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
    const rooted = redactDiagnostic("see \\Users\\Alice\\.codex\\sessions\\rollout.jsonl later");
    const escape = redactDiagnostic("failed \\n later");
    assert.equal(rooted.includes("Alice"), false);
    assert.equal(rooted.includes("Users"), false);
    assert.equal(rooted.includes(".codex"), false);
    assert.equal(rooted.includes("later"), true);
    assert.equal(rooted.startsWith("see "), true);
    assert.equal(escape, "failed \\n later");
    const file = redactDiagnostic("see \\secret.txt later");
    assert.equal(file.includes("secret"), false);
    assert.equal(file.includes("later"), true);
    assert.equal(file.startsWith("see "), true);
    const relative = redactDiagnostic("see PrivateProject\\secrets\\key.txt later");
    assert.equal(relative.includes("PrivateProject"), false);
    assert.equal(relative.includes("secrets"), false);
    assert.equal(relative.includes("key"), false);
    assert.equal(relative.includes("later"), true);
    assert.equal(relative.startsWith("see "), true);
    const spacedFile = redactDiagnostic("see sessions\\Jane Doe.jsonl later");
    const quoted = redactDiagnostic(
      "failed to resolve rollout path `PrivateProject\\My Secrets.txt`: missing",
    );
    const spacedFolder = redactDiagnostic("see Jane Doe\\secrets\\key.txt later");
    for (const value of [spacedFile, quoted, spacedFolder]) {
      assert.equal(value.includes("Jane"), false);
      assert.equal(value.includes("PrivateProject"), false);
      assert.equal(value.includes("sessions"), false);
      assert.equal(value.includes("Secrets"), false);
      assert.equal(value.includes("secrets"), false);
      assert.equal(value.includes("jsonl"), false);
      assert.equal(value.includes("key"), false);
    }
    assert.equal(spacedFile.startsWith("see "), true);
    assert.equal(spacedFile.includes("later"), true);
    assert.equal(spacedFolder.startsWith("see "), true);
    assert.equal(spacedFolder.includes("later"), true);
    assert.equal(quoted.includes("missing"), true);
    assert.equal(stderrDetail("see sessions\\Jane Doe.jsonl later").includes("Jane"), false);
    const spacedSummary = summarizeThreads([
      {
        source: { custom: "sessions\\Jane Doe.jsonl" },
        originator: "sessions\\Jane Doe.jsonl",
        status: { type: "idle" },
      },
      {
        source: { custom: "PrivateProject\\My Secrets.txt" },
        originator: "Jane Doe\\secrets\\key.txt",
        status: { type: "idle" },
      },
    ]);
    const spacedNameJson = JSON.stringify(spacedSummary);
    assert.equal(spacedNameJson.includes("Jane"), false);
    assert.equal(spacedNameJson.includes("sessions"), false);
    assert.equal(spacedNameJson.includes("PrivateProject"), false);
    assert.equal(spacedNameJson.includes("Secrets"), false);
    assert.equal(spacedNameJson.includes("secrets"), false);
    assert.equal(spacedSummary.originators["[redacted]"], 2);
    assert.equal(spacedSummary.sources["[redacted]"], 2);
    assert.equal(redactDiagnostic("failed not\\n later"), "failed not\\n later");
    const threeWords = redactDiagnostic("see sessions\\Jane Mary Doe.jsonl later");
    const secretName = redactDiagnostic("see PrivateProject\\My Secret Name.txt later");
    const secretFile = redactDiagnostic("see sessions\\My Secret file.txt later");
    const secretFolder = redactDiagnostic("see sessions\\My Secret Folder\\key.txt later");
    const programFilesPath = redactDiagnostic("see sessions\\Program Files (x86)\\a.txt later");
    const missing = redactDiagnostic("Missing sessions\\Jane Doe.jsonl");
    const person = redactDiagnostic("see Maria Jose Garcia\\secrets\\key.txt later");
    const documents = redactDiagnostic("see my documents\\secrets\\key.txt later");
    for (const value of [
      threeWords,
      secretName,
      secretFile,
      secretFolder,
      programFilesPath,
      person,
      documents,
    ]) {
      assert.equal(value.startsWith("see "), true);
      assert.equal(value.includes("later"), true);
      assert.equal(value.includes("Jane"), false);
      assert.equal(value.includes("Mary"), false);
      assert.equal(value.includes("sessions"), false);
      assert.equal(value.includes("PrivateProject"), false);
      assert.equal(value.includes("Secret"), false);
      assert.equal(value.includes("Folder"), false);
      assert.equal(value.includes("Program"), false);
      assert.equal(value.includes("Files"), false);
      assert.equal(value.includes("x86"), false);
      assert.equal(value.includes("Maria"), false);
      assert.equal(value.includes("Jose"), false);
      assert.equal(value.includes("Garcia"), false);
      assert.equal(value.includes("documents"), false);
      assert.equal(value.includes("my "), false);
    }
    const opened = redactDiagnostic("Cannot open sessions\\Jane Doe.jsonl because it is locked");
    assert.equal(opened.startsWith("Cannot open "), true);
    assert.equal(opened.includes("because it is locked"), true);
    assert.equal(opened.includes("sessions"), false);
    assert.equal(opened.includes("Jane"), false);
    const readMissing = redactDiagnostic("failed to read Missing sessions\\Jane Doe.jsonl");
    assert.equal(readMissing.startsWith("failed to read Missing "), true);
    assert.equal(readMissing.includes("sessions"), false);
    assert.equal(redactDiagnostic("my documents\\secrets\\key.txt"), "[redacted]");
    assert.equal(redactDiagnostic("Maria Jose Garcia\\secrets\\key.txt"), "[redacted]");
    assert.equal(
      redactDiagnostic("read/write error on thread list"),
      "read/write error on thread list",
    );
    assert.equal(
      redactDiagnostic("I/O error while listing threads"),
      "I/O error while listing threads",
    );
    assert.equal(redactDiagnostic("TCP/IP failed"), "TCP/IP failed");
    assert.equal(redactDiagnostic("read and/or write the file"), "read and/or write the file");
    assert.equal(redactDiagnostic("node/v22.0.0"), "node/v22.0.0");
    assert.equal(redactDiagnostic("\\secret").includes("secret"), false);
    assert.equal(redactDiagnostic("\\Private Folder").includes("Private"), false);
    assert.equal(redactDiagnostic("\\Private Folder").includes("Folder"), false);
    const missingProject = redactDiagnostic("Missing PrivateProject\\secrets\\key.txt");
    const errorProject = redactDiagnostic("Error PrivateProject\\secrets\\key.txt");
    const missingSessions = redactDiagnostic("Missing Sessions\\Jane Doe.jsonl");
    const seePerson = redactDiagnostic("See Maria Jose Garcia\\secrets\\key.txt later");
    assert.equal(missingProject.startsWith("Missing "), true);
    assert.equal(missingProject.includes("PrivateProject"), false);
    assert.equal(errorProject, "Error [redacted]");
    assert.equal(missingSessions.startsWith("Missing "), true);
    assert.equal(missingSessions.includes("Sessions"), false);
    assert.equal(missingSessions.includes("Jane"), false);
    const missingShort = redactDiagnostic("Missing Session\\Jane Doe.jsonl");
    assert.equal(missingShort.startsWith("Missing "), true);
    assert.equal(missingShort.includes("Session"), false);
    assert.equal(missingShort.includes("Jane"), false);
    assert.equal(
      redactDiagnostic("see Jane Doe Documents\\secrets\\key.txt later"),
      "see [redacted] later",
    );
    assert.equal(redactDiagnostic("Maria Jose PrivateProject\\secrets\\key.txt"), "[redacted]");
    assert.equal(seePerson.startsWith("See "), true);
    assert.equal(seePerson.includes("later"), true);
    assert.equal(seePerson.includes("Maria"), false);
    assert.equal(seePerson.includes("Jose"), false);
    assert.equal(seePerson.includes("Garcia"), false);
    assert.equal(redactDiagnostic("Maria Jose Garcia\\secrets\\key.txt"), "[redacted]");
    const rootedClause = redactDiagnostic("see \\secret because it is locked");
    const rootedFolder = redactDiagnostic("cannot open \\Private Folder because it is locked");
    assert.equal(rootedClause.startsWith("see "), true);
    assert.equal(rootedClause.includes("because it is locked"), true);
    assert.equal(rootedClause.includes("secret"), false);
    assert.equal(rootedFolder.startsWith("cannot open "), true);
    assert.equal(rootedFolder.includes("because it is locked"), true);
    assert.equal(rootedFolder.includes("Private"), false);
    assert.equal(rootedFolder.includes("Folder"), false);
    assert.equal(redactDiagnostic("open \\^[ later"), "open \\^[ later");
    const cyrillicRoot = redactDiagnostic("see \\Секрет because it is locked");
    const cyrillicFolder = redactDiagnostic("cannot open \\Мои документы because it is locked");
    const mixedRoot = redactDiagnostic("cannot open \\My documents because it is locked");
    const settings = redactDiagnostic("see \\Documents and Settings later");
    assert.equal(cyrillicRoot.startsWith("see "), true);
    assert.equal(cyrillicRoot.includes("because it is locked"), true);
    assert.equal(cyrillicRoot.includes("Секрет"), false);
    assert.equal(cyrillicFolder.startsWith("cannot open "), true);
    assert.equal(cyrillicFolder.includes("because it is locked"), true);
    assert.equal(cyrillicFolder.includes("Мои"), false);
    assert.equal(cyrillicFolder.includes("документы"), false);
    assert.equal(mixedRoot, "cannot open [redacted] because it is locked");
    assert.equal(settings, "see [redacted] later");
    assert.equal(
      redactDiagnostic("cannot open \\My documents: file does not exist"),
      "cannot open [redacted]: file does not exist",
    );
    assert.equal(redactDiagnostic("see \\Private Folder on disk"), "see [redacted] on disk");
    assert.equal(redactDiagnostic("cwd:\\Program Files (x86)\\Codex"), "cwd:[redacted]");
    assert.equal(
      redactDiagnostic("see \\Program Files (x86)\\Codex\\a.txt later"),
      "see [redacted] later",
    );
    assert.equal(redactDiagnostic("see \\Program Files (x86) later"), "see [redacted] later");
    assert.equal(
      redactDiagnostic("failed to read \\secret (os error 3)"),
      "failed to read [redacted] (os error 3)",
    );
    assert.equal(
      redactDiagnostic("failed to read \\Program Files (x86) (os error 3)"),
      "failed to read [redacted] (os error 3)",
    );
    assert.equal(redactDiagnostic("see \\secret, then continue"), "see [redacted], then continue");
    const manyRoots = `${"\\secret, ".repeat(8000)}later`;
    const manyRootsStarted = Date.now();
    const manyRootsRedacted = redactDiagnostic(manyRoots);
    assert.equal(Date.now() - manyRootsStarted < 1000, true);
    assert.equal(manyRootsRedacted.includes("secret"), false);
    assert.equal(manyRootsRedacted.endsWith("later"), true);
    assert.equal(
      redactDiagnostic("The File Is Missing From Documents\\secrets\\key.txt"),
      "The File Is Missing From [redacted]",
    );
    assert.equal(redactDiagnostic("Very Private Customer Project\\secrets\\key.txt"), "[redacted]");
    assert.equal(
      redactDiagnostic("see Very Private Customer Project\\secrets\\key.txt later"),
      "see [redacted] later",
    );
    const unicodePosix = redactDiagnostic("see Проект/секреты/key.txt later");
    const unicodeWindows = redactDiagnostic("see Проект\\секреты\\key.txt later");
    assert.equal(unicodePosix, "see [redacted] later");
    assert.equal(unicodeWindows, "see [redacted] later");
    const unicodeSummary = summarizeThreads([
      {
        source: { custom: "Проект/секреты/key.txt" },
        originator: "Проект/секреты/key.txt",
        status: { type: "idle" },
      },
    ]);
    assert.equal(unicodeSummary.originators["[redacted]"], 1);
    assert.equal(unicodeSummary.sources["[redacted]"], 1);
    assert.equal(JSON.stringify(unicodeSummary).includes("Проект"), false);
    assert.equal(JSON.stringify(unicodeSummary).includes("секреты"), false);
    const rootSummary = summarizeThreads([
      {
        source: { custom: "\\secret" },
        originator: "\\Private Folder",
        status: { type: "idle" },
      },
    ]);
    assert.equal(JSON.stringify(rootSummary).includes("secret"), false);
    assert.equal(JSON.stringify(rootSummary).includes("Private"), false);
    assert.equal(rootSummary.originators["[redacted]"], 1);
    assert.equal(rootSummary.sources["[redacted]"], 1);
    const prose = `${"word ".repeat(8000)}end`;
    const proseStarted = Date.now();
    assert.equal(redactDiagnostic(prose), prose);
    assert.equal(Date.now() - proseStarted < 1000, true);
    const versions = "a/1.0.0 ".repeat(4000);
    const versionStarted = Date.now();
    assert.equal(redactDiagnostic(versions), versions);
    assert.equal(Date.now() - versionStarted < 1000, true);
    const titled = `${"Word ".repeat(16000)}Documents\\secrets\\key.txt`;
    const titledStarted = Date.now();
    const titledRedacted = redactDiagnostic(titled);
    assert.equal(Date.now() - titledStarted < 1000, true);
    assert.equal(titledRedacted.includes("Word"), false);
    assert.equal(titledRedacted.includes("Documents"), false);
    const fragments = `${"a\\a ".repeat(16000)}.txt`;
    const fragmentStarted = Date.now();
    const fragmentRedacted = redactDiagnostic(fragments);
    assert.equal(Date.now() - fragmentStarted < 1000, true);
    assert.equal(fragmentRedacted.includes("a\\a"), false);
    assert.equal(redactDiagnostic("~user~name/secret"), "[redacted]");
    assert.equal(
      redactDiagnostic("rollout ~alice~/.codex/sessions/a.jsonl missing"),
      "rollout [redacted] missing",
    );
    const schemes = `${"a-".repeat(10000)}:`;
    const schemeStarted = Date.now();
    assert.equal(redactDiagnostic(schemes), schemes);
    assert.equal(Date.now() - schemeStarted < 1000, true);
    const tildes = "~".repeat(16000);
    const tildeStarted = Date.now();
    assert.equal(redactDiagnostic(tildes), tildes);
    assert.equal(Date.now() - tildeStarted < 1000, true);
    const punctuated = "a$".repeat(40000);
    const punctuatedStarted = Date.now();
    assert.equal(redactDiagnostic(punctuated), punctuated);
    assert.equal(Date.now() - punctuatedStarted < 1000, true);
    assert.equal(missing.startsWith("Missing "), true);
    assert.equal(missing.includes("sessions"), false);
    assert.equal(missing.includes("Jane"), false);
    assert.equal(stderrDetail("see sessions\\Jane Mary Doe.jsonl later").includes("Jane"), false);
    const longName = summarizeThreads([
      {
        source: { custom: "sessions\\Jane Mary Doe.jsonl" },
        originator: "sessions\\Jane Mary Doe.jsonl",
        status: { type: "idle" },
      },
    ]);
    const longNameJson = JSON.stringify(longName);
    assert.equal(longNameJson.includes("Jane"), false);
    assert.equal(longNameJson.includes("sessions"), false);
    assert.equal(longName.originators["[redacted]"], 1);
    assert.equal(longName.sources["[redacted]"], 1);
    const posix = redactDiagnostic("see src/private/key.txt later");
    assert.equal(posix, "see [redacted] later");
    assert.equal(redactDiagnostic("O'Brien/secrets/key.txt"), "[redacted]");
    assert.equal(
      redactDiagnostic("see O\u2019Brien/secrets/key.txt later"),
      "see [redacted] later",
    );
    assert.equal(
      redactDiagnostic("Cannot open src/file.txt\\more because it is locked"),
      "Cannot open src/file.txt\\more because it is locked",
    );
    assert.equal(
      redactDiagnostic("open pkg/main.go\\cache because missing"),
      "open pkg/main.go\\cache because missing",
    );
    assert.equal(redactDiagnostic("node/v1.2.3\\extra"), "node/v1.2.3\\extra");
    assert.equal(redactDiagnostic("a/b/c\\d"), "[redacted]");
    assert.equal(redactDiagnostic("see C:secret.txt later"), "see [redacted] later");
    assert.equal(redactDiagnostic("missing C:tmp.txt after"), "missing [redacted] after");
    assert.equal(redactDiagnostic("see C:secret later"), "see [redacted] later");
    assert.equal(redactDiagnostic("see D:PrivateFolder later"), "see [redacted] later");
    assert.equal(
      redactDiagnostic("open C:Users\\Alice because missing"),
      "open [redacted] because missing",
    );
    assert.equal(redactDiagnostic("see C:My Secret.txt later"), "see [redacted] later");
    assert.equal(redactDiagnostic("see C:My Documents\\key later"), "see [redacted] later");
    assert.equal(
      redactDiagnostic("see https://example.com/a:C:secret.txt later"),
      "see https://example.com/a:[redacted] later",
    );
    assert.equal(
      redactDiagnostic("see https://example.com/a:C:secret later"),
      "see https://example.com/a:[redacted] later",
    );
    assert.equal(
      redactDiagnostic("see https://example.com/a:C:My Secret.txt later"),
      "see https://example.com/a:[redacted] later",
    );
    assert.equal(
      redactDiagnostic("open C:Program Files (x86)\\secret.txt later"),
      "open [redacted] later",
    );
    assert.equal(redactDiagnostic("open C:Users\\Jane Doe because"), "open [redacted] because");
    assert.equal(
      redactDiagnostic("The file C:Private Folder was locked."),
      "The file [redacted] was locked.",
    );
    assert.equal(
      redactDiagnostic("see https://example.com/a:C:Users\\Jane Doe later"),
      "see https://example.com/a:[redacted] later",
    );
    assert.equal(redactDiagnostic("open C:secret.txt because."), "open [redacted] because.");
    assert.equal(redactDiagnostic("missing C:tmp.txt after."), "missing [redacted] after.");
    assert.equal(redactDiagnostic("open C:secret.txt e.g. now"), "open [redacted] e.g. now");
    assert.equal(
      redactDiagnostic("Error reading C:data.bin v2.0 now"),
      "Error reading [redacted] v2.0 now",
    );
    assert.equal(redactDiagnostic("see PrivateProject\\secrets later"), "see [redacted] later");
    assert.equal(redactDiagnostic("see sessions\\Jane Doe later"), "see [redacted] later");
    assert.equal(redactDiagnostic("see sessions\\Jane Mary Doe later"), "see [redacted] later");
    assert.equal(redactDiagnostic("failed PrivateProject\\Jane Doe"), "failed [redacted]");
    assert.equal(
      redactDiagnostic("see PrivateProject\\secrets Please retry"),
      "see [redacted] retry",
    );
    assert.equal(redactDiagnostic("see O'Brien\\secrets later"), "see [redacted] later");
    assert.equal(redactDiagnostic("see my_project\\secrets later"), "see [redacted] later");
    const namedPair = summarizeThreads([
      {
        id: "not-a-uuid",
        originator: "sessions\\Jane Doe",
        source: { custom: "O'Brien\\secrets" },
        status: { type: "idle" },
      },
    ]);
    const namedPairJson = JSON.stringify(namedPair);
    assert.equal(namedPairJson.includes("Jane"), false);
    assert.equal(namedPairJson.includes("sessions"), false);
    assert.equal(namedPairJson.includes("O'Brien"), false);
    assert.equal(namedPairJson.includes("secrets"), false);
    assert.equal(namedPair.originators["[redacted]"], 1);
    assert.equal(namedPair.sources["[redacted]"], 1);
    assert.equal(
      redactDiagnostic("Error reading C:data.bin because Users\\Alice is missing"),
      "Error reading [redacted] because [redacted] is missing",
    );
    assert.equal(
      redactDiagnostic("open C:secret.txt because Users\\Alice later"),
      "open [redacted] because [redacted] later",
    );
    assert.equal(
      redactDiagnostic("open C:Program files (x86)\\secret later"),
      "open [redacted] later",
    );
    assert.equal(redactDiagnostic("open C:My secret files\\key later"), "open [redacted] later");
    assert.equal(redactDiagnostic("open \\^[ later"), "open \\^[ later");
    const driveRelative = summarizeThreads([
      {
        source: { custom: "C:My Secret.txt" },
        originator: "C:Users\\Alice",
        status: { type: "idle" },
      },
    ]);
    const driveRelativeJson = JSON.stringify(driveRelative);
    assert.equal(driveRelativeJson.includes("Alice"), false);
    assert.equal(driveRelativeJson.includes("Secret"), false);
    assert.equal(driveRelativeJson.includes("Users"), false);
    assert.equal(driveRelative.originators["[redacted]"], 1);
    assert.equal(driveRelative.sources["[redacted]"], 1);
    const posixSummary = summarizeThreads([
      {
        source: { custom: "src/private/key.txt" },
        originator: "src/private/key.txt",
        status: { type: "idle" },
      },
    ]);
    assert.equal(JSON.stringify(posixSummary).includes("private"), false);
    assert.equal(posixSummary.originators["[redacted]"], 1);
    const version = "codex_cli_rs/0.159.0 (Linux 6.12.94; x86_64)";
    assert.equal(redactDiagnostic(version), version);
    const chained = `a:${"a:".repeat(20000)}a`;
    const started = Date.now();
    assert.equal(redactDiagnostic(chained), chained);
    assert.equal(Date.now() - started < 1000, true);
    const relativeSummary = summarizeThreads([
      {
        source: { custom: "PrivateProject\\secrets\\key.txt" },
        originator: "PrivateProject\\secrets\\key.txt",
        status: { type: "idle" },
      },
    ]);
    const relativeJson = JSON.stringify(relativeSummary);
    assert.equal(relativeJson.includes("PrivateProject"), false);
    assert.equal(relativeJson.includes("secrets"), false);
    assert.equal(relativeJson.includes("key.txt"), false);
    assert.equal(relativeSummary.originators["[redacted]"], 1);
    assert.equal(relativeSummary.sources["[redacted]"], 1);
    const fileSummary = summarizeThreads([
      {
        source: { custom: "\\secret.txt" },
        originator: "\\secret.txt",
        status: { type: "idle" },
      },
    ]);
    assert.equal(JSON.stringify(fileSummary).includes("secret"), false);
    assert.equal(fileSummary.originators["[redacted]"], 1);
    assert.equal(fileSummary.sources["[redacted]"], 1);
    const summary = summarizeThreads([
      {
        source: { custom: "\\Users\\Alice\\.codex\\sessions\\rollout.jsonl" },
        originator: "\\Users\\Alice\\.codex\\sessions\\rollout.jsonl",
        status: { type: "idle" },
      },
    ]);
    const json = JSON.stringify(summary);
    assert.equal(json.includes("Alice"), false);
    assert.equal(summary.originators["[redacted]"], 1);
    assert.equal(summary.sources["[redacted]"], 1);
    const spaced = redactDiagnostic(
      "see \\Documents and Settings\\Jane\\.codex\\sessions\\rollout.jsonl later",
    );
    const summarySpaced = summarizeThreads([
      {
        source: { custom: "\\Program Files\\Codex\\sessions\\rollout.jsonl" },
        originator: "\\Documents and Settings\\Jane\\.codex\\sessions\\rollout.jsonl",
        status: { type: "idle" },
      },
    ]);
    const spacedJson = JSON.stringify(summarySpaced);
    assert.equal(spaced.includes("Documents"), false);
    assert.equal(spaced.includes("Jane"), false);
    assert.equal(spaced.includes(".codex"), false);
    assert.equal(spaced.includes("later"), true);
    assert.equal(spacedJson.includes("Documents"), false);
    assert.equal(spacedJson.includes("Program"), false);
    assert.equal(spacedJson.includes("Jane"), false);
    assert.equal(summarySpaced.originators["[redacted]"], 1);
    assert.equal(summarySpaced.sources["[redacted]"], 1);
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

  it("redacts file URLs including the host", () => {
    const file = redactDiagnostic("see file:///secret-file later");
    const host = redactDiagnostic("see file://private-host/share later");
    const summary = summarizeThreads([
      {
        id: "not-a-uuid",
        source: { custom: "file:///secret-file" },
        originator: "file://private-host/share",
        status: { type: "idle" },
      },
    ]);
    assert.equal(file.startsWith("see "), true);
    assert.equal(file.includes("secret-file"), false);
    assert.equal(file.includes("file:"), false);
    assert.equal(host.startsWith("see "), true);
    assert.equal(host.includes("private-host"), false);
    assert.equal(host.includes("share"), false);
    const json = JSON.stringify(summary);
    assert.equal(json.includes("secret-file"), false);
    assert.equal(json.includes("private-host"), false);
    assert.equal(summary.sources["[redacted]"], 1);
    assert.equal(summary.originators["[redacted]"], 1);
  });

  it("redacts an absolute path that follows a label colon", () => {
    const labeled = redactDiagnostic("cwd:/alice/private");
    const single = redactDiagnostic("cwd:/secret");
    const uri = redactDiagnostic("see https://example.com later");
    assert.equal(labeled.includes("alice"), false);
    assert.equal(labeled.includes("private"), false);
    assert.equal(labeled.startsWith("cwd:"), true);
    assert.equal(single.includes("secret"), false);
    assert.equal(single.startsWith("cwd:"), true);
    assert.equal(uri.includes("example.com"), true);
  });

  it("keeps a remote URL path and the text after it", () => {
    const failure = redactDiagnostic("https://api.openai.com/v1/responses failed with 500");
    const mixed = redactDiagnostic("https://api.openai.com/v1/responses then /Users/me/secret");
    const port = redactDiagnostic("https://api.openai.com:443/v1/responses failed");
    const glued = redactDiagnostic(
      "https://api.openai.com/v1/responses:/Users/jane/.codex/sessions/rollout.jsonl",
    );
    const drive = redactDiagnostic(
      "https://api.openai.com/v1/responses:C:\\Users\\Jane\\.codex\\sessions\\rollout.jsonl",
    );
    const emptyHost = redactDiagnostic("http:///Users/Jane/.codex/sessions/rollout.jsonl");
    assert.equal(failure, "https://api.openai.com/v1/responses failed with 500");
    assert.equal(mixed.includes("https://api.openai.com/v1/responses"), true);
    assert.equal(mixed.includes("then"), true);
    assert.equal(mixed.includes("/Users"), false);
    assert.equal(mixed.includes("secret"), false);
    assert.equal(port, "https://api.openai.com:443/v1/responses failed");
    assert.equal(glued.includes("jane"), false);
    assert.equal(glued.includes(".codex"), false);
    assert.equal(glued.includes("rollout"), false);
    assert.equal(glued.startsWith("https://api.openai.com/v1/responses:"), true);
    assert.equal(drive.includes("Jane"), false);
    assert.equal(drive.includes("rollout"), false);
    assert.equal(drive.startsWith("https://api.openai.com/v1/responses:"), true);
    assert.equal(emptyHost.includes("Users"), false);
    assert.equal(emptyHost.includes("Jane"), false);
    assert.equal(emptyHost.startsWith("http://"), true);
    const home = redactDiagnostic(
      "https://api.openai.com/v1/responses:~/.codex/sessions/rollout.jsonl later",
    );
    const homeWindows = redactDiagnostic(
      "https://api.openai.com/v1/responses:~\\Users\\Jane\\.codex\\sessions\\rollout.jsonl later",
    );
    const homeSpaced = redactDiagnostic(
      "https://api.openai.com/v1/responses:~/Jane Doe/.codex/sessions/rollout.jsonl later",
    );
    const homeDrive = redactDiagnostic(
      "https://api.openai.com/v1/responses:C:\\Documents and Settings\\Jane\\.codex\\sessions\\rollout.jsonl later",
    );
    const namedHome = redactDiagnostic(
      "https://api.openai.com/v1/responses:~jane/.codex/sessions/rollout.jsonl later",
    );
    const namedWindows = redactDiagnostic(
      "see ~jane\\AppData\\Codex\\sessions\\rollout.jsonl later",
    );
    const namedSlash = redactDiagnostic("see ~jane/.codex/sessions/rollout.jsonl later");
    for (const value of [home, homeWindows, homeSpaced, homeDrive, namedHome]) {
      assert.equal(value.startsWith("https://api.openai.com/v1/responses:"), true);
    }
    for (const value of [home, homeWindows, homeSpaced, homeDrive, namedHome, namedSlash]) {
      assert.equal(value.includes("Jane"), false);
      assert.equal(value.includes(".codex"), false);
      assert.equal(value.includes("rollout"), false);
      assert.equal(value.includes("later"), true);
    }
    assert.equal(namedHome.includes("jane"), false);
    assert.equal(namedSlash.startsWith("see "), true);
    assert.equal(namedSlash.includes("jane"), false);
    assert.equal(namedWindows.includes("jane"), false);
    assert.equal(namedWindows.includes("AppData"), false);
    assert.equal(namedWindows.includes("later"), true);
    assert.equal(namedWindows.startsWith("see "), true);
    const namedSummary = summarizeThreads([
      {
        source: { custom: "~jane\\AppData\\Codex\\sessions\\rollout.jsonl" },
        originator: "~jane\\AppData\\Codex\\sessions\\rollout.jsonl",
        status: { type: "idle" },
      },
    ]);
    assert.equal(JSON.stringify(namedSummary).includes("jane"), false);
    assert.equal(namedSummary.originators["[redacted]"], 1);
    assert.equal(namedSummary.sources["[redacted]"], 1);
    const signed = redactDiagnostic(
      "https://user:password@example.com/v1?token=secret#session=hidden failed",
    );
    assert.equal(signed, "https://example.com/v1 failed");
    const credential = redactDiagnostic("see https://alice:C:secret@example.com/path later");
    assert.equal(credential, "see https://example.com/path later");
    assert.equal(credential.includes("alice"), false);
    assert.equal(credential.includes("secret"), false);
    const mailed = redactDiagnostic("auth failed for alice@example.com");
    assert.equal(mailed, "auth failed for [redacted]");
    assert.equal(redactDiagnostic("bob@example.co.uk"), "[redacted]");
    assert.equal(redactDiagnostic("алиса@example.com"), "[redacted]");
    assert.equal(redactDiagnostic("alice@пример.рф"), "[redacted]");
    assert.equal(redactDiagnostic("o'brien@example.com"), "[redacted]");
    assert.equal(redactDiagnostic('see "alice smith"@example.com later'), "see [redacted] later");
    assert.equal(redactDiagnostic('see "a@b"@example.com later'), "see [redacted] later");
    assert.equal(redactDiagnostic("see alice!private@example.com later"), "see [redacted] later");
    assert.equal(
      redactDiagnostic("alice@\u0909\u0926\u093e\u0939\u0930\u0923.\u092d\u093e\u0930\u0924"),
      "[redacted]",
    );
    assert.equal(redactDiagnostic("see alice@localhost later"), "see [redacted] later");
    assert.equal(redactDiagnostic("see alice@mailserver1 later"), "see [redacted] later");
    assert.equal(redactDiagnostic("see alice@b later"), "see alice@b later");
    assert.equal(redactDiagnostic("see user(comment)@example.com later"), "see [redacted] later");
    assert.equal(redactDiagnostic("see user (comment) @example.com later"), "see [redacted] later");
    assert.equal(redactDiagnostic("see user(a(b)c)@example.com later"), "see [redacted] later");
    assert.equal(
      redactDiagnostic("auth failed for user(comment)@localhost."),
      "auth failed for [redacted].",
    );
    const commentMail = summarizeThreads([
      {
        id: "not-a-uuid",
        originator: "user(comment)@example.com",
        source: "cli",
        status: { type: "idle" },
      },
    ]);
    assert.equal(JSON.stringify(commentMail).includes("example.com"), false);
    assert.equal(JSON.stringify(commentMail).includes("comment"), false);
    assert.equal(commentMail.originators["[redacted]"], 1);
    assert.equal(
      redactDiagnostic("auth failed for alice@localhost."),
      "auth failed for [redacted].",
    );
    assert.equal(redactDiagnostic('"a@b"@localhost.'), "[redacted].");
    assert.equal(redactDiagnostic("see alice@example.com. later"), "see [redacted]. later");
    assert.equal(
      redactDiagnostic("see https://example.com/v1 failed for alice/private@example.com"),
      "see https://example.com/v1 failed for [redacted]",
    );
    assert.equal(
      redactDiagnostic("see https://example.com/v1 failed for first.last/team@example.com"),
      "see https://example.com/v1 failed for [redacted]",
    );
    assert.equal(
      redactDiagnostic("see https://example.com/path@attacker.com later"),
      "see https://example.com/[redacted] later",
    );
    assert.equal(
      redactDiagnostic("https://example.com/a/b@example.com"),
      "https://example.com/a/[redacted]",
    );
    assert.equal(redactDiagnostic("alice/private@example.com"), "[redacted]");
    assert.equal(redactDiagnostic("note first.last/team@example.com now"), "note [redacted] now");
    assert.equal(
      redactDiagnostic("see https://example.com/jane.doe@attacker.com later"),
      "see https://example.com/[redacted] later",
    );
    assert.equal(
      redactDiagnostic("see http://localhost/user@example.com later"),
      "see http://localhost/[redacted] later",
    );
    assert.equal(
      redactDiagnostic("https://alice:pass:word@example.com/path"),
      "https://example.com/path",
    );
    const combining = `Jos${"e"}\u0301`;
    assert.equal(redactDiagnostic(`see ${combining}@example.com later`), "see [redacted] later");
    assert.equal(
      redactDiagnostic(`see ${combining}/secrets/key.txt later`),
      "see [redacted] later",
    );
    assert.equal(redactDiagnostic("see bob$name@example.com later"), "see [redacted] later");
    assert.equal(
      redactDiagnostic('auth failed for "a@b"@example.com.'),
      "auth failed for [redacted].",
    );
    assert.equal(redactDiagnostic("see alice@[192.0.2.1] later"), "see [redacted] later");
    assert.equal(redactDiagnostic("see alice@[IPv6:2001:db8::1] later"), "see [redacted] later");
    assert.equal(redactDiagnostic("see alice@[not-an-ip] later"), "see alice@[not-an-ip] later");
    assert.equal(redactDiagnostic("alice@example.xn--p1ai"), "[redacted]");
    const punycode = redactDiagnostic("wrote alice@example.xn--p1ai later");
    assert.equal(punycode.includes("alice"), false);
    assert.equal(punycode.includes("xn--"), false);
    assert.equal(punycode.includes("later"), true);
    const apostrophe = redactDiagnostic("wrote o'brien@example.com later");
    assert.equal(apostrophe.includes("brien"), false);
    assert.equal(apostrophe.includes("o'"), false);
    assert.equal(apostrophe.includes("later"), true);
    assert.equal(
      redactDiagnostic("auth failed for alice@example.com."),
      "auth failed for [redacted].",
    );
    assert.equal(
      redactDiagnostic("auth failed for alice@example.com. Retry later."),
      "auth failed for [redacted]. Retry later.",
    );
    assert.equal(redactDiagnostic("bob@example.co.uk."), "[redacted].");
    assert.equal(redactDiagnostic("alice@example.com.1"), "[redacted].1");
    const pair = redactDiagnostic("auth failed for alice@example.com.bob@secret.personal.test");
    assert.equal(pair.includes("secret"), false);
    assert.equal(pair.includes("@"), false);
    assert.equal(pair.startsWith("auth failed for [redacted]"), true);
    const users = redactDiagnostic("users alice@foo.com.bob@bar.com.");
    assert.equal(users.includes("@"), false);
    assert.equal(users.includes("bar"), false);
    assert.equal(users.endsWith("."), true);
    assert.equal(stderrDetail(pair).includes("secret"), false);
    const dottedHost = `a@${"a.".repeat(40_000)}1`;
    const dottedStarted = Date.now();
    assert.equal(redactDiagnostic(dottedHost), dottedHost);
    assert.equal(Date.now() - dottedStarted < 1000, true);
    assert.equal(stderrDetail("alice@example.com").includes("@"), false);
    assert.equal(stderrDetail("alice@example.com.").includes("alice"), false);
    const dotted = summarizeThreads([
      { originator: "alice@example.com.", source: "cli", status: { type: "idle" } },
    ]);
    assert.equal(JSON.stringify(dotted).includes("alice"), false);
    assert.equal(dotted.originators["[redacted]"], 1);
    const letters = "a".repeat(100_000);
    const started = Date.now();
    assert.equal(redactDiagnostic(letters), letters);
    assert.equal(Date.now() - started < 1000, true);
    const originLetters = "b".repeat(80_000);
    const originStarted = Date.now();
    const originSummary = summarizeThreads([
      { originator: originLetters, source: "cli", status: { type: "idle" } },
    ]);
    assert.equal(Date.now() - originStarted < 1000, true);
    assert.equal(originSummary.originators[originLetters], 1);
  });

  it("redacts a private user agent and a top-level argument path", async () => {
    const failure = formatFailure(new Error("unknown argument --bad=/Users/alice/private"));
    assert.equal(failure.includes("alice"), false);
    assert.equal(failure.includes("/Users"), false);
    assert.equal(failure.startsWith("unknown argument --bad="), true);
    const unix = appServerLaunch("/usr/bin/codex", ["app-server"], "darwin");
    const windows = appServerLaunch(
      "C:\\Program Files\\nodejs\\codex.cmd",
      ["app-server", "--listen", "stdio://"],
      "win32",
    );
    assert.equal(unix.command, "/usr/bin/codex");
    assert.equal(unix.verbatim, false);
    assert.deepEqual(unix.args, ["app-server"]);
    assert.equal(windows.command.endsWith("cmd.exe"), true);
    assert.equal(windows.verbatim, true);
    assert.deepEqual(windows.args.slice(0, 3), ["/d", "/s", "/c"]);
    assert.equal(windows.args[3].includes("Program Files"), true);
    assert.equal(windows.args[3].includes("app-server"), true);
    const parentheses = appServerLaunch("C:\\tools(x86)\\codex.cmd", ["app-server"], "win32");
    assert.equal(parentheses.args[3].includes('"C:\\tools(x86)\\codex.cmd"'), true);
    const percentBin = appServerLaunch("C:\\tools\\%TEMP%\\codex.cmd", ["app-server"], "win32");
    assert.equal(percentBin.env.AFTER_HOURS_CODEX_BIN, "C:\\tools\\%TEMP%\\codex.cmd");
    assert.equal(percentBin.args[3].includes("%TEMP%"), false);
    assert.equal(percentBin.args[3].includes("%AFTER_HOURS_CODEX_BIN%"), true);
    const dir = mkdtempSync(join(tmpdir(), "ah-probe-"));
    const helper = join(dir, "agent.mjs");
    writeFileSync(
      helper,
      [
        'import { createInterface } from "node:readline";',
        "const rl = createInterface({ input: process.stdin });",
        "rl.on('line', (line) => {",
        "  let message;",
        "  try { message = JSON.parse(line); } catch { return; }",
        '  if (message.method === "initialize") {',
        "    process.stdout.write(JSON.stringify({ id: message.id, result: { userAgent: 'Codex Desktop alice@example.com /Users/alice/.codex' } }) + '\\n');",
        "    return;",
        "  }",
        '  if (message.method === "thread/list") {',
        "    process.stdout.write(JSON.stringify({ id: message.id, result: { data: [] } }) + '\\n');",
        "    return;",
        "  }",
        '  if (message.method === "account/rateLimits/read") {',
        "    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\\n');",
        "  }",
        "});",
      ].join("\n"),
    );
    try {
      const summary = await runProbe({ bin: process.execPath, args: [helper] });
      const json = JSON.stringify(summary);
      assert.equal(summary.userAgent, "[redacted]");
      assert.equal(json.includes("alice"), false);
      assert.equal(json.includes("/Users"), false);
      const agent = "codex_cli_rs/0.159.0 (Linux 6.12.94; x86_64) rust (after-hours-probe; 0.0.0)";
      assert.equal(redactDiagnostic(agent), agent);
      const mixed = redactDiagnostic(`${agent} /Users/alice/.codex`);
      assert.equal(mixed.includes("codex_cli_rs/0.159.0"), true);
      assert.equal(mixed.includes("/Users"), false);
      assert.equal(mixed.includes("alice"), false);
      const clean = join(dir, "clean.mjs");
      writeFileSync(
        clean,
        [
          'import { createInterface } from "node:readline";',
          "const rl = createInterface({ input: process.stdin });",
          "rl.on('line', (line) => {",
          "  let message;",
          "  try { message = JSON.parse(line); } catch { return; }",
          '  if (message.method === "initialize") {',
          `    process.stdout.write(JSON.stringify({ id: message.id, result: { userAgent: ${JSON.stringify(agent)} } }) + '\\n');`,
          "    return;",
          "  }",
          '  if (message.method === "thread/list") {',
          "    process.stdout.write(JSON.stringify({ id: message.id, result: { data: [] } }) + '\\n');",
          "    return;",
          "  }",
          '  if (message.method === "account/rateLimits/read") {',
          "    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\\n');",
          "  }",
          "});",
        ].join("\n"),
      );
      const cleanSummary = await runProbe({ bin: process.execPath, args: [clean] });
      assert.equal(cleanSummary.userAgent, agent);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("redacts a remote URL path in an originator or custom source", () => {
    const summary = summarizeThreads([
      {
        id: "not-a-uuid",
        source: { custom: "https://example.com/alice/private-source" },
        originator: "https://chatgpt.com/c/secret-thread-id",
        status: { type: "idle" },
      },
      {
        id: "also-not-a-uuid",
        source: { custom: "atlas" },
        originator: "https://example.com",
        status: { type: "idle" },
      },
    ]);
    const json = JSON.stringify(summary);
    assert.equal(json.includes("secret-thread-id"), false);
    assert.equal(json.includes("private-source"), false);
    assert.equal(json.includes("alice"), false);
    assert.equal(summary.originators["[redacted]"], 1);
    assert.equal(summary.originators["https://example.com"], 1);
    assert.equal(summary.sources["[redacted]"], 1);
    assert.equal(summary.sources["custom:atlas"], 1);
  });

  it("redacts a long spaced path without a quadratic scan", () => {
    const spaced = `/tmp/${"Private ".repeat(4000)}secret`;
    const started = Date.now();
    const redacted = redactDiagnostic(spaced);
    assert.equal(Date.now() - started < 2000, true);
    assert.equal(redacted.includes("Private"), false);
    assert.equal(redacted.includes("secret"), false);
  });

  it("drops the rest of an oversized stderr line", () => {
    const state = { safe: "", pending: "" };
    retainStderr(state, `/${"n".repeat(100_000)}`);
    assert.equal(state.discardLine, true);
    retainStderr(state, "Jane Doe secret\nlater ok");
    const detail = stderrDetail(stderrText(state));
    assert.equal(detail.includes("Jane"), false);
    assert.equal(detail.includes("secret"), false);
    assert.equal(detail.includes("later ok"), true);
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

  it("redacts a long path before the stderr buffer drops its prefix", () => {
    const path = `/${"n".repeat(2500)}Jane Doe secret`;
    const cut = path.slice(-2000);
    assert.equal(cut.includes("/"), false);
    assert.equal(redactDiagnostic(cut).includes("Jane"), true);
    const state = retainStderr({ safe: "", pending: "" }, `${path}\n`);
    const detail = stderrDetail(stderrText(state));
    assert.equal(detail.includes("Jane"), false);
    assert.equal(detail.includes("secret"), false);
    const split = { safe: "", pending: "" };
    retainStderr(split, path.slice(0, 1500));
    retainStderr(split, `${path.slice(1500)}\n`);
    const splitDetail = stderrDetail(stderrText(split));
    assert.equal(splitDetail.includes("Jane"), false);
    assert.equal(splitDetail.includes("Doe"), false);
    assert.equal(splitDetail.includes("secret"), false);
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
        "    if (!message.params || message.params.excludeResetCreditDetails !== true) {",
        "      process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\\n');",
        "      return;",
        "    }",
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
      assert.equal(summary.threads.extraSourcesIncluded, true);
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

  it("counts the default interactive list and the extra source kinds once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-probe-"));
    const helper = join(dir, "sources.mjs");
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
        "    const kinds = message.params && message.params.sourceKinds;",
        "    const extra = Array.isArray(kinds);",
        "    const wrong = extra && JSON.stringify(kinds) !== JSON.stringify(['exec', 'appServer', 'unknown']);",
        "    const thread = {",
        "      id: archived",
        "        ? extra ? '0199a0e0-7c31-7a55-8c1e-6a5d0e8a9c24' : '0199a0e0-7c31-7a55-8c1e-6a5d0e8a9c23'",
        "        : extra ? '0199a0e0-7c31-7a55-8c1e-6a5d0e8a9c22' : '0199a0e0-7c31-7a55-8c1e-6a5d0e8a9c21',",
        "      source: extra ? 'exec' : { custom: 'atlas' },",
        "      originator: wrong ? 'wrong-filter' : extra ? 'exec-origin' : 'atlas-origin',",
        "      status: { type: 'idle' },",
        "    };",
        "    process.stdout.write(JSON.stringify({ id: message.id, result: { data: [thread], nextCursor: null } }) + '\\n');",
        "    return;",
        "  }",
        '  if (message.method === "account/rateLimits/read") {',
        "    process.stdout.write(JSON.stringify({ id: message.id, result: { rateLimits: { primary: null }, rateLimitResetCredits: { availableCount: 1, credits: [{ id: 'secret-credit-id' }] } } }) + '\\n');",
        "  }",
        "});",
        "",
      ].join("\n"),
    );
    try {
      const summary = await runProbe({ bin: process.execPath, args: [helper] });
      assert.equal(summary.threads.count, 4);
      assert.equal(summary.threads.scope, "interactive+exec");
      assert.equal(summary.threads.sources["custom:atlas"], 2);
      assert.equal(summary.threads.sources.exec, 2);
      assert.equal(summary.threads.originators["atlas-origin"], 2);
      assert.equal(summary.threads.originators["exec-origin"], 2);
      assert.equal(summary.threads.originators["wrong-filter"], undefined);
      assert.equal(summary.threads.extraSourcesIncluded, true);
      assert.equal(summary.rateLimits.resetCreditsAvailable, 1);
      assert.equal(JSON.stringify(summary).includes("secret-credit-id"), false);
      assert.equal(JSON.stringify(summary).includes("0199a0e0"), false);
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
        "    if (!message.params || message.params.excludeResetCreditDetails !== true) {",
        "      process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\\n');",
        "      return;",
        "    }",
        "    process.stdout.write(JSON.stringify({ id: message.id, result: { rateLimits: { primary: { usedPercent: 4, windowDurationMins: 60, resetsAt: null } } } }) + '\\n');",
        "  }",
        "});",
        "",
      ].join("\n"),
    );
    try {
      const summary = await runProbe({ bin: process.execPath, args: [helper] });
      assert.equal(summary.threads.count, 1);
      assert.equal(summary.threads.extraSourcesIncluded, true);
      assert.equal(summary.threads.extraSourceError, undefined);
      assert.equal(summary.threads.archivedIncluded, false);
      assert.equal(summary.threads.archivedExtraIncluded, false);
      assert.match(summary.threads.archivedError, /^-32603: /);
      assert.match(summary.threads.archivedExtraError, /^-32603: /);
      assert.equal(summary.threads.archivedError.includes("secret-archive"), false);
      assert.equal(summary.threads.archivedExtraError.includes("secret-archive"), false);
      assert.equal(summary.threads.originators["live-origin"], 1);
      assert.equal(summary.rateLimits.primary.usedPercent, 4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports an archived extra-source failure without blaming the other slices", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-probe-"));
    const helper = join(dir, "archived-extra-error.mjs");
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
        "    const extra = Array.isArray(message.params && message.params.sourceKinds);",
        "    if (archived && extra) {",
        "      process.stdout.write(JSON.stringify({ id: message.id, error: { code: -32603, message: 'archived extra /tmp/secret-extra.jsonl' } }) + '\\n');",
        "      return;",
        "    }",
        "    const thread = {",
        "      id: archived",
        "        ? '0199a0e0-7c31-7a55-8c1e-6a5d0e8a9c23'",
        "        : extra ? '0199a0e0-7c31-7a55-8c1e-6a5d0e8a9c22' : '0199a0e0-7c31-7a55-8c1e-6a5d0e8a9c21',",
        "      source: extra ? 'exec' : 'cli',",
        "      originator: archived ? 'archived-origin' : extra ? 'exec-origin' : 'live-origin',",
        "      status: { type: 'idle' },",
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
      assert.equal(summary.threads.count, 3);
      assert.equal(summary.threads.extraSourcesIncluded, true);
      assert.equal(summary.threads.archivedIncluded, true);
      assert.equal(summary.threads.archivedExtraIncluded, false);
      assert.equal(summary.threads.extraSourceError, undefined);
      assert.equal(summary.threads.archivedError, undefined);
      assert.match(summary.threads.archivedExtraError, /^-32603: /);
      assert.equal(summary.threads.archivedExtraError.includes("secret-extra"), false);
      assert.equal(summary.threads.originators["live-origin"], 1);
      assert.equal(summary.threads.originators["exec-origin"], 1);
      assert.equal(summary.threads.originators["archived-origin"], 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a pending request when app-server output closes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-probe-"));
    const helper = join(dir, "stdout-close.mjs");
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
        "    process.stdout.end();",
        "    setTimeout(() => {}, 30000);",
        "  }",
        "});",
        "",
      ].join("\n"),
    );
    const started = Date.now();
    try {
      await assert.rejects(
        () => runProbe({ bin: process.execPath, args: [helper] }),
        /output closed/,
      );
      assert.equal(Date.now() - started < 5000, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the exit code when stdout closes just before the process exits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-probe-"));
    const helper = join(dir, "stdout-exit.mjs");
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
        '    process.stderr.write("rollout missing at C:\\\\Users\\\\Ada\\\\secret.jsonl\\n");',
        "    process.stdout.end();",
        "    setTimeout(() => process.exit(7), 300);",
        "  }",
        "});",
        "",
      ].join("\n"),
    );
    try {
      await assert.rejects(
        () => runProbe({ bin: process.execPath, args: [helper] }),
        (error) => {
          assert.match(error.message, /exited \(code 7\)/);
          assert.match(error.message, /\[redacted\]/);
          assert.equal(error.message.includes("secret.jsonl"), false);
          assert.equal(error.message.includes("Ada"), false);
          return true;
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores a non-object app-server line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-probe-"));
    const helper = join(dir, "stdout-null.mjs");
    writeFileSync(
      helper,
      [
        'import { createInterface } from "node:readline";',
        "const rl = createInterface({ input: process.stdin });",
        "rl.on('line', (line) => {",
        "  let message;",
        "  try { message = JSON.parse(line); } catch { return; }",
        '  if (!message || typeof message !== "object") return;',
        '  if (message.method === "initialize") {',
        '    process.stdout.write("null\\n");',
        '    process.stdout.write("true\\n");',
        '    process.stdout.write("[1]\\n");',
        '    process.stdout.write(JSON.stringify({ id: message.id, result: { userAgent: "stub" } }) + "\\n");',
        "    return;",
        "  }",
        '  if (message.method === "account/rateLimits/read") {',
        '    process.stdout.write(JSON.stringify({ id: message.id, result: { rateLimits: { primary: null } } }) + "\\n");',
        "    return;",
        "  }",
        '  process.stdout.write(JSON.stringify({ id: message.id, result: { data: [], nextCursor: null } }) + "\\n");',
        "});",
        "",
      ].join("\n"),
    );
    try {
      const summary = await runProbe({ bin: process.execPath, args: [helper] });
      assert.equal(summary.userAgent, "stub");
      assert.equal(summary.rateLimits.primary, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an app-server line that exceeds the stdout limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-probe-"));
    const helper = join(dir, "stdout-limit.mjs");
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
        '    process.stdout.write("x".repeat(100001));',
        "    setTimeout(() => {}, 30000);",
        "  }",
        "});",
        "",
      ].join("\n"),
    );
    const started = Date.now();
    try {
      await assert.rejects(
        () => runProbe({ bin: process.execPath, args: [helper] }),
        /output line exceeded the limit/,
      );
      assert.equal(Date.now() - started < 5000, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects pending requests when stdin fails", () => {
    const stdin = new EventEmitter();
    let rejected = null;
    bindStdin(stdin, (error) => {
      rejected = error;
    });
    stdin.emit("error", { code: "EPIPE" });
    assert.match(rejected.message, /stdin failed: EPIPE/);
  });

  it("kills a live child after stdin fails and leaves a finished child alone", () => {
    const signals = [];
    const live = {
      pid: 4,
      exitCode: null,
      signalCode: null,
      kill(signal) {
        signals.push(signal);
      },
    };
    assert.equal(shouldKillChild(live), true);
    assert.equal(terminateChild(live, "linux"), true);
    assert.deepEqual(signals, ["SIGTERM"]);
    const ended = [];
    const killed = [];
    const windows = {
      pid: 9,
      exitCode: null,
      signalCode: null,
      stdin: {
        destroyed: false,
        end() {
          ended.push("end");
        },
      },
      kill() {
        killed.push("kill");
      },
    };
    assert.equal(
      stopChild(windows, "win32", (command, args) => {
        killed.push([command, ...args]);
        return { unref() {} };
      }),
      true,
    );
    assert.deepEqual(ended, ["end"]);
    assert.deepEqual(killed, [["taskkill", "/pid", "9", "/t", "/f"]]);
    const fallback = [];
    const failed = new EventEmitter();
    terminateChild(
      {
        pid: 8,
        exitCode: null,
        signalCode: null,
        kill(signal) {
          fallback.push(signal);
        },
      },
      "win32",
      () => failed,
    );
    failed.emit("exit", 1);
    assert.deepEqual(fallback, ["SIGTERM"]);
    const thrown = [];
    terminateChild(
      {
        pid: 7,
        exitCode: null,
        signalCode: null,
        kill(signal) {
          thrown.push(signal);
        },
      },
      "win32",
      () => {
        throw new Error("no taskkill");
      },
    );
    assert.deepEqual(thrown, ["SIGTERM"]);
    assert.equal(
      terminateChild({ pid: null, exitCode: null, signalCode: null, kill() {} }, "linux"),
      false,
    );
    assert.equal(
      terminateChild({ pid: 4, exitCode: 0, signalCode: null, kill() {} }, "linux"),
      false,
    );
    assert.equal(
      terminateChild({ pid: 4, exitCode: null, signalCode: "SIGTERM", kill() {} }, "linux"),
      false,
    );
    assert.equal(
      terminateChild(
        {
          pid: 4,
          exitCode: null,
          signalCode: null,
          kill() {
            const error = new Error("gone");
            error.code = "ESRCH";
            throw error;
          },
        },
        "linux",
      ),
      true,
    );
    assert.throws(
      () =>
        terminateChild(
          {
            pid: 4,
            exitCode: null,
            signalCode: null,
            kill() {
              const error = new Error("denied");
              error.code = "EPERM";
              throw error;
            },
          },
          "linux",
        ),
      /denied/,
    );
  });

  it("refuses a model turn", () => {
    assert.doesNotThrow(() => assertProbeMethod("thread/list"));
    assert.throws(() => assertProbeMethod("turn/start"), /refuses turn\/start/);
    assert.throws(() => assertProbeMethod("thread/start"), /refuses thread\/start/);
  });
});

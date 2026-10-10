import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "node:test";
import { createSqliteJournal } from "../journal/store.ts";
import type { LogEntry } from "../journal/types.ts";
import { createSqliteResearch } from "../research/store.ts";
import { createSqliteUsage } from "../usage/store.ts";
import { dataDir } from "./paths.ts";
import { readAuthSecret } from "./secret.ts";

const previous = {
  DATA_DIR: process.env.DATA_DIR,
  AUTH_SECRET: process.env.AUTH_SECRET,
  NODE_ENV: process.env.NODE_ENV,
};

function restore(name: "DATA_DIR" | "AUTH_SECRET" | "NODE_ENV") {
  const value = previous[name];
  if (value == null) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore("DATA_DIR");
  restore("AUTH_SECRET");
  restore("NODE_ENV");
});

const night: LogEntry = {
  id: "vitejs/vite#9",
  owner: "vitejs",
  repo: "vite",
  number: 9,
  title: "Night",
  kind: "blinding",
  url: "https://github.com/vitejs/vite/issues/9",
  isPr: false,
  status: "taken",
  takenAt: 5,
};

describe("data directory", () => {
  it("keeps data/ when DATA_DIR is empty and accepts a relative or absolute override", () => {
    delete process.env.DATA_DIR;
    assert.equal(dataDir(), join(process.cwd(), "data"));
    process.env.DATA_DIR = "   ";
    assert.equal(dataDir(), join(process.cwd(), "data"));
    process.env.DATA_DIR = "tmp-ah-rel";
    assert.equal(dataDir(), resolve("tmp-ah-rel"));
    process.env.DATA_DIR = "/tmp/ah12-abs";
    assert.equal(dataDir(), "/tmp/ah12-abs");
  });

  it("writes the local auth secret into DATA_DIR", () => {
    const dir = mkdtempSync(join(tmpdir(), "ah12-secret-"));
    try {
      process.env.DATA_DIR = dir;
      delete process.env.AUTH_SECRET;
      process.env.NODE_ENV = "development";
      const secret = readAuthSecret();
      assert.equal(secret.length >= 32, true);
      assert.equal(existsSync(join(dir, ".auth-secret")), true);
      assert.equal(readAuthSecret(), secret);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("opens an old journal database, adds research tables, and keeps the rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "ah12-db-"));
    const file = join(dir, "after-hours.sqlite");
    try {
      const first = new DatabaseSync(file);
      createSqliteJournal(first).take("owner", night);
      createSqliteUsage(first).record("owner", {
        at: 5,
        harness: "codex",
        model: "gpt-6-astra",
        inputTokens: 3,
        outputTokens: 4,
        missionId: "vitejs/vite#9",
      });
      first.close();

      const upgraded = new DatabaseSync(file);
      createSqliteResearch(upgraded);
      const journal = upgraded.prepare("SELECT COUNT(*) AS n FROM journal").get() as { n: number };
      const usage = upgraded.prepare("SELECT COUNT(*) AS n FROM usage_events").get() as { n: number };
      const subjects = upgraded
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'github_subjects'")
        .get() as { name: string } | undefined;
      assert.equal(journal.n, 1);
      assert.equal(usage.n, 1);
      assert.equal(subjects?.name, "github_subjects");
      upgraded.close();

      const again = new DatabaseSync(file);
      createSqliteResearch(again);
      const still = again.prepare("SELECT COUNT(*) AS n FROM journal").get() as { n: number };
      assert.equal(still.n, 1);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

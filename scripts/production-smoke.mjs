import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { installShutdown, previewLaunch, stopPreview } from "./preview-process.mjs";

const port = 4173;
const origin = `http://127.0.0.1:${port}`;
const dir = mkdtempSync(join(tmpdir(), "ah12-smoke-"));
const dbPath = join(dir, "after-hours.sqlite");
let pid = 0;
let child = null;
let launchError = null;

installShutdown({
  pid: () => pid,
  afterKill() {
    rmSync(dir, { recursive: true, force: true });
  },
});

function seed() {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      login TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE journal (
      user_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      url TEXT NOT NULL,
      is_pr INTEGER NOT NULL,
      status TEXT NOT NULL,
      taken_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, mission_id)
    );
    CREATE TABLE usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      at INTEGER NOT NULL,
      harness TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      mission_id TEXT
    );
  `);
  db.prepare(
    `INSERT INTO users (id, login, name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run("owner", "ah12smoke", "Smoke", "", 5);
  db.prepare(
    `INSERT INTO journal
      (user_id, mission_id, owner, repo, number, title, kind, url, is_pr, status, taken_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "owner",
    "vitejs/vite#9",
    "vitejs",
    "vite",
    9,
    "Night",
    "blinding",
    "https://github.com/vitejs/vite/issues/9",
    0,
    "taken",
    5,
  );
  db.prepare(
    `INSERT INTO usage_events
      (user_id, at, harness, model, input_tokens, output_tokens, mission_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("owner", 5, "codex", "gpt-6-astra", 3, 4, "vitejs/vite#9");
  db.close();
}

function counts() {
  const db = new DatabaseSync(dbPath);
  const journal = db.prepare("SELECT COUNT(*) AS n FROM journal").get();
  const usage = db.prepare("SELECT COUNT(*) AS n FROM usage_events").get();
  const research = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'research_runs'")
    .get();
  const subjects = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'github_subjects'")
    .get();
  const runs = research
    ? db.prepare("SELECT COUNT(*) AS n FROM research_runs").get()
    : { n: -1 };
  db.close();
  return { journal: journal.n, usage: usage.n, research: Boolean(research), subjects: Boolean(subjects), runs: runs.n };
}

function start() {
  // Unix: a new process group so one signal reaches npm and the preview.
  // Windows has no negative-pid groups; stop uses taskkill /t on this pid.
  const launch = previewLaunch();
  launchError = null;
  child = spawn(launch.command, launch.args, {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    shell: launch.shell,
    windowsHide: true,
    env: {
      ...process.env,
      DATA_DIR: dir,
      AUTH_SECRET: "a".repeat(40),
      NODE_ENV: "production",
    },
    stdio: "ignore",
  });
  child.once("error", (error) => {
    launchError = error;
  });
  child.unref();
  pid = child.pid ?? 0;
  return pid;
}

function stop(current) {
  const tracked = child;
  return stopPreview(current, {
    listening: async () => {
      if (await portOpen()) return true;
      return tracked?.pid === current && tracked.exitCode === null && tracked.signalCode === null;
    },
  });
}

async function portOpen() {
  try {
    const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function listening() {
  if (launchError) throw launchError;
  return portOpen();
}

async function waitUntilUp() {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (await listening()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("preview did not answer");
}

async function hit() {
  const home = await fetch(origin);
  if (!home.ok) throw new Error(`home ${home.status}`);
  const profile = await fetch(`${origin}/u/ah12smoke`);
  if (!profile.ok) throw new Error(`profile ${profile.status}`);
}

try {
  if (await portOpen()) throw new Error("port 4173 is already in use");
  seed();
  pid = start();
  await waitUntilUp();
  await hit();
  const upgraded = counts();
  if (upgraded.journal !== 1 || upgraded.usage !== 1 || !upgraded.research || !upgraded.subjects) {
    throw new Error(`upgrade missed ${JSON.stringify(upgraded)}`);
  }
  if (upgraded.runs !== 0) throw new Error("smoke created a research run");
  await stop(pid);
  pid = start();
  await waitUntilUp();
  await hit();
  const again = counts();
  if (again.journal !== 1 || again.usage !== 1 || again.runs !== 0) {
    throw new Error(`restart changed rows ${JSON.stringify(again)}`);
  }
  console.log("smoke-ok");
} finally {
  await stop(pid);
  rmSync(dir, { recursive: true, force: true });
}

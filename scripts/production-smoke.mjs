import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolatedDatabase } from "../src/lib/db/testing.ts";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { signPayload } from "../src/lib/auth/secret.ts";
import { createPostgresJournal, upsertUser } from "../src/lib/journal/store.ts";
import { createPostgresResearch } from "../src/lib/research/store.ts";
import { enqueue, emptyQueue, readQueue, writeQueue } from "../src/lib/research/queue.ts";
import { createPostgresUsage } from "../src/lib/usage/store.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const entry = join(root, ".output/server/index.mjs");
assert.ok(existsSync(entry), "Run npm run build with the node-server preset first.");
const temp = mkdtempSync(join(tmpdir(), "after-hours-production-"));
const isolated = await isolatedDatabase();
const db = isolated.pool;
const user = { id: "smoke-owner", login: "after-hours-smoke", name: "Smoke", avatarUrl: "" };
const other = { ...user, id: "smoke-other", login: "after-hours-other" };
const secret = randomBytes(32).toString("hex");
const cookie = (account) =>
  `ah_session=${signPayload({ ...account, exp: Date.now() + 600_000 }, secret)}`;
const journal = createPostgresJournal(db);
await upsertUser(db, user);
await upsertUser(db, other);
await journal.take(user.id, {
  id: "vitejs/vite#23221",
  owner: "vitejs",
  repo: "vite",
  number: 23221,
  title: "Existing persistent journal",
  kind: "blinding",
  url: "https://github.com/vitejs/vite/issues/23221",
  isPr: false,
  status: "taken",
  takenAt: Date.now(),
});
await createPostgresUsage(db).record(user.id, {
  at: Date.now(),
  harness: "legacy-smoke",
  model: "fixture",
  inputTokens: 7,
  outputTokens: 3,
});

const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((resolve, reject) =>
  reservation.close((error) => (error ? reject(error) : resolve())),
);
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: isolated.connectionString,
  AUTH_SECRET: secret,
  APP_ORIGIN: origin,
  GITHUB_CLIENT_ID: "",
  GITHUB_CLIENT_SECRET: "",
  GITHUB_TOKEN: "",
  NITRO_HOST: "127.0.0.1",
  NITRO_PORT: String(port),
};
let child;
let exited;
let starts = 0;

async function request(path, options = {}) {
  return fetch(`${origin}${path}`, {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
}

async function html(path, session) {
  const res = await request(path, session ? { headers: { cookie: cookie(session) } } : {});
  assert.equal(res.status, 200, path);
  const text = await res.text();
  assert.ok(text.includes("<html"), path);
  assert.ok(!text.includes("Ночь сломалась"), path);
  return text;
}

async function post(body, token) {
  const res = await request("/api/research", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function start() {
  const cwd = join(temp, `release-${++starts}`);
  mkdirSync(cwd);
  const log = openSync(join(temp, `server-${starts}.log`), "w", 0o600);
  child = spawn(
    process.execPath,
    ["--import", join(root, "scripts/fixtures/offline-fetch.mjs"), entry],
    {
      cwd,
      env,
      stdio: ["ignore", log, log],
    },
  );
  closeSync(log);
  exited = once(child, "exit");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    assert.equal(child.exitCode, null, "Production server exited before readiness.");
    try {
      if ((await request("/")).status === 200) return;
    } catch {
      /* Wait for the listener. */
    }
    await delay(100);
  }
  throw new Error("Production server did not become ready.");
}

async function stop() {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

async function flush(tokenFile, queuePath, expectedCode) {
  const connector = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      join(root, "scripts/research-connector.mjs"),
      "--origin",
      origin,
      "--token-file",
      tokenFile,
      "--queue",
      queuePath,
      "--flush-only",
    ],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  connector.stdout.on("data", (chunk) => {
    output += chunk;
  });
  connector.stderr.resume();
  const [code] = await once(connector, "exit");
  assert.equal(code, expectedCode, "Connector flush exit status");
  return output.trim();
}

let passed = false;
try {
  await start();
  for (const [path, marker] of [
    ["/", "After Hours"],
    ["/list", "The list"],
    ["/log", "Night log"],
  ]) {
    assert.ok((await html(path)).includes(marker), path);
  }
  assert.equal((await request("/api/auth/github")).status, 503);
  const callback = await request("/api/auth/callback?code=invalid&state=invalid");
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), `${origin}/log?auth=error`);
  assert.equal(callback.headers.get("set-cookie"), null);
  assert.equal((await post({})).status, 401);
  assert.equal((await db.query("SELECT COUNT(*) AS n FROM schema_migrations")).rows[0].n, 1);
  assert.equal((await journal.list(user.id)).length, 1);
  assert.equal((await createPostgresUsage(db).list(user.id))[0].inputTokens, 7);
  const usageBody = {
    harness: "http-smoke",
    model: "fixture",
    inputTokens: 11,
    outputTokens: 4,
    userId: other.id,
  };
  assert.equal(
    (
      await request("/api/usage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(usageBody),
      })
    ).status,
    401,
  );
  const usageResponse = await request("/api/usage", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookie(user) },
    body: JSON.stringify(usageBody),
  });
  assert.equal(usageResponse.status, 200);
  assert.equal((await usageResponse.json()).usage.allTimeTokens, 25);
  assert.deepEqual(await createPostgresUsage(db).list(other.id), []);
  console.log("PASS production HTTP, anonymous auth rejection, persistent PostgreSQL schema");

  const repo = createPostgresResearch(db);
  const ownerGrant = await repo.createGrant(user.id, Date.now());
  const otherGrant = await repo.createGrant(other.id, Date.now());
  const body = {
    threadId: "smoke_thread_0001",
    missionId: "vitejs/vite#23221",
    isPr: false,
    status: "completed",
    model: "smoke-fixture",
    userId: other.id,
    report: {
      schemaVersion: 1,
      findings: "Production smoke report marker",
      work: "Fixture, not a real Codex run.",
      evidence: [],
      unknowns: [],
      nextSteps: [],
      links: [],
    },
    turns: [
      {
        turnId: "smoke_turn_0001",
        status: "completed",
        usage: {
          inputTokens: 100,
          cachedInputTokens: 20,
          outputTokens: 25,
          reasoningOutputTokens: 0,
          totalTokens: 125,
        },
      },
    ],
    limit: {
      readAt: Date.now(),
      primary: { usedPercent: 37, windowDurationMins: 300, resetsAt: 1_900_000_000 },
      secondary: null,
      spendControlReached: false,
      individualRemainingPercent: 63,
    },
  };
  const first = await post(body, ownerGrant.token);
  assert.equal(first.status, 200);
  assert.equal(first.body.replay, false);
  assert.equal((await repo.readRun(user.id, body.threadId))?.userId, user.id);
  assert.equal((await post(body, ownerGrant.token)).body.replay, true);
  assert.equal((await post(body, otherGrant.token)).status, 403);
  assert.equal(await repo.readRun(other.id, body.threadId), null);
  assert.equal(await repo.readLimit(other.id), null);
  assert.equal(await repo.setPublished(other.id, first.body.run.id, false, Date.now()), "missing");
  assert.equal((await repo.authorBoard(user.login, null)).publicSpend.totalTokens, 125);

  for (const path of ["/m/vitejs/vite/23221", `/u/${user.login}`]) {
    const publicPage = await html(path);
    assert.ok(publicPage.includes(body.report.findings), path);
    assert.ok(!publicPage.includes(body.threadId), "No private thread id on public page");
    assert.ok(
      !publicPage.includes("individualRemainingPercent"),
      "No private limit on public page",
    );
  }
  assert.ok((await html("/log", user)).includes("Existing persistent journal"));
  assert.ok(!(await html("/log", other)).includes("Existing persistent journal"));
  console.log(
    "PASS authenticated delivery, public mission/profile, replay, token accounting, account isolation",
  );

  const tokenFile = join(temp, "connector-token");
  const queuePath = join(temp, "queue.json");
  writeFileSync(tokenFile, ownerGrant.token, { mode: 0o600 });
  // The server already accepted this body; simulate a lost acknowledgement.
  writeQueue(queuePath, enqueue(emptyQueue(), body.threadId, body));
  await stop();
  assert.equal(await flush(tokenFile, queuePath, 1), "network");
  assert.equal(Object.keys(readQueue(queuePath).pending).length, 1);
  await start();
  assert.equal(await flush(tokenFile, queuePath, 0), "flushed");
  assert.equal(Object.keys(readQueue(queuePath).pending).length, 0);
  assert.equal((await repo.authorBoard(user.login, null)).publicSpend.totalTokens, 125);
  assert.equal((await db.query("SELECT COUNT(*) AS n FROM research_turns")).rows[0].n, 1);
  assert.ok((await html(`/u/${user.login}`)).includes(body.report.findings));
  assert.ok((await html("/log", user)).includes("Existing persistent journal"));
  console.log("PASS production restart from a new cwd, disk queue recovery, no duplicate spend");

  for (const status of ["waiting", "interrupted"]) {
    const delivery = { ...body, threadId: `smoke_${status}_0001`, status };
    const result = await post(delivery, ownerGrant.token);
    assert.equal(result.status, 200);
    assert.equal(result.body.run.publishedAt, null);
    assert.equal(result.body.run.report, null);
  }
  assert.equal((await repo.authorBoard(user.login, null)).reports.length, 1);
  const second = await post(
    {
      ...body,
      threadId: "smoke_thread_0002",
      report: { ...body.report, findings: "Second production research marker" },
      turns: [{ ...body.turns[0], turnId: "smoke_turn_0002" }],
    },
    ownerGrant.token,
  );
  assert.equal(second.status, 200);
  assert.equal((await repo.authorBoard(user.login, null)).reports.length, 2);
  assert.equal((await repo.authorBoard(user.login, null)).publicSpend.totalTokens, 250);
  await repo.setPublished(user.id, first.body.run.id, false, Date.now());
  for (const path of ["/m/vitejs/vite/23221", `/u/${user.login}`]) {
    assert.ok(!(await html(path)).includes(body.report.findings), path);
  }
  assert.equal((await repo.authorBoard(user.login, null)).publicSpend.totalTokens, 125);
  assert.ok((await html(`/u/${user.login}`, user)).includes(body.report.findings));
  assert.equal(await repo.setPublished(user.id, first.body.run.id, true, Date.now()), "updated");
  assert.equal((await repo.authorBoard(user.login, null)).publicSpend.totalTokens, 250);
  assert.ok((await html(`/u/${user.login}`)).includes(body.report.findings));
  await repo.revokeGrant(user.id, ownerGrant.grant.id, Date.now());
  assert.equal((await post(body, ownerGrant.token)).status, 401);
  assert.equal((await db.query("SELECT COUNT(*) AS n FROM schema_migrations")).rows[0].n, 1);
  console.log(
    "PASS incomplete runs stay unpublished, unpublish in both views, grant revocation, PostgreSQL persistence",
  );
  passed = true;
} finally {
  await stop();
  await isolated.close();
  if (passed) rmSync(temp, { recursive: true, force: true });
  else
    console.error(
      `Smoke failed; server logs and queue retained in ${temp}; isolated DB schema removed.`,
    );
}

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Exercise the built Node server with fixture OAuth and an isolated persistent disk.
const entry = fileURLToPath(new URL("../.output/server/index.mjs", import.meta.url));
const build = JSON.parse(await readFile(new URL("../.output/nitro.json", import.meta.url), "utf8"));
assert.equal(build.preset, "node-server");
const temp = await mkdtemp(join(tmpdir(), "after-hours-production-"));
const appDir = join(temp, "app");
const preload = join(temp, "github-fixture.mjs");
await mkdir(appDir);
await chmod(appDir, 0o555);
await writeFile(preload, `
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.href === 'https://github.com/login/oauth/access_token') {
    return Response.json({ access_token: 'fixture-token' });
  }
  if (url.href === 'https://api.github.com/user') {
    return Response.json({ id: 123456789, login: 'smoke-user', name: 'Smoke user' });
  }
  if (url.hostname === 'api.github.com') {
    if (url.pathname.endsWith('/issues/1')) return Response.json({
      title: 'PRIVATE_TITLE_MUST_NOT_LEAK', body: 'PRIVATE_BODY_MUST_NOT_LEAK',
      number: 1, html_url: 'https://github.com/private-fixture/repo/issues/1',
      user: { login: 'human' },
    });
    return Response.json({ private: true, description: 'PRIVATE_DESCRIPTION_MUST_NOT_LEAK' });
  }
  throw new Error('Unexpected outbound request in production smoke');
};
`);

let server;
async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, "exit");
  server.kill("SIGTERM");
  const timeout = setTimeout(() => server.kill("SIGKILL"), 5_000);
  try { await exited; } finally { clearTimeout(timeout); }
}

async function start() {
  server = spawn(process.execPath, ["--import", preload, entry], {
    cwd: appDir,
    env: {
      ...process.env, NODE_ENV: "production", NODE_OPTIONS: "", TEST: "",
      HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1", PORT: "0", NITRO_PORT: "0",
      APP_ORIGIN: "", DATA_DIR: join(temp, "data"),
      AUTH_SECRET: "production-smoke-fixture-secret-at-least-32-characters",
      GITHUB_CLIENT_ID: "fixture-client", GITHUB_CLIENT_SECRET: "fixture-secret",
      GITHUB_TOKEN: "fixture-token",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 15_000);
    server.on("error", (error) => { clearTimeout(timeout); reject(error); });
    server.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`Server exited (${code}): ${output}`)); });
    server.stderr.on("data", (data) => { output += data; });
    server.stdout.on("data", (data) => {
      output += data;
      const address = output.match(/Listening on: (http:\/\/127\.0\.0\.1:\d+)\//)?.[1];
      if (address) { clearTimeout(timeout); resolve(address); }
    });
  });
}

async function request(origin, path, options = {}) {
  return fetch(`${origin}${path}`, { ...options, redirect: "manual", signal: AbortSignal.timeout(10_000) });
}

try {
  let origin = await start();
  for (const path of ["/m/private-fixture/repo/1", "/r/private-fixture/repo"]) {
    const response = await request(origin, path);
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /PRIVATE_(TITLE|BODY|DESCRIPTION)_MUST_NOT_LEAK/);
  }
  const login = await request(origin, "/api/auth/github");
  assert.equal(login.status, 302);
  const state = new URL(login.headers.get("location")).searchParams.get("state");
  const oauthCookie = login.headers.getSetCookie().find((cookie) => cookie.startsWith("ah_oauth="))?.split(";")[0];
  assert.ok(state && oauthCookie);
  const callback = await request(origin, `/api/auth/callback?code=fixture&state=${state}`, { headers: { Cookie: oauthCookie } });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), `${origin}/log`);
  const session = callback.headers.getSetCookie().find((cookie) => cookie.startsWith("ah_session="))?.split(";")[0];
  assert.ok(session, "OAuth must save the user and issue a session on the configured data volume");
  const report = async (base) => {
    const response = await request(base, "/api/usage", {
      method: "POST", headers: { Cookie: session, "Content-Type": "application/json" },
      body: JSON.stringify({ harness: "smoke", model: "fixture", inputTokens: 1200, outputTokens: 400 }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.equal((await report(origin)).usage.allTimeTokens, 1600);
  await stop();
  origin = await start();
  assert.equal((await report(origin)).usage.allTimeTokens, 3200, "SQLite and the signed session must survive a restart");
  const log = await request(origin, "/log", { headers: { Cookie: session } });
  assert.equal(log.status, 200);
  assert.match(await log.text(), /smoke-user/);
  console.log("Production smoke passed: private data blocked, OAuth succeeds, SQLite and session survive restart.");
} finally {
  await stop();
  await chmod(appDir, 0o755);
  await rm(temp, { recursive: true, force: true });
}

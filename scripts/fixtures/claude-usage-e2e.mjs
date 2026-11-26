import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function claudeUsageSmoke({
  root,
  temp,
  origin,
  db,
  repo,
  request,
  html,
  cookie,
  author,
  other,
  stop,
  start,
}) {
  const mission = "/m/smoke/claude/9";
  const profile = `/u/${author.login}`;
  const issue = (account, from = origin) =>
    request("/api/claude-access", {
      method: "POST",
      headers: { Origin: from, ...(account ? { Cookie: cookie(account) } : {}) },
    });
  assert.equal((await issue()).status, 401);
  assert.equal((await issue(author, "https://other.example")).status, 403);
  const issued = await issue(author);
  assert.equal(issued.status, 201);
  assert.equal(issued.headers.get("cache-control"), "no-store");
  const { config, grants } = await issued.json();
  assert.deepEqual(
    grants.map((g) => g.purpose),
    ["mcp", "telemetry"],
  );
  assert.ok((await html("/log", author)).includes("Выдать доступ для Claude Code"));
  const { config: foreignConfig } = await (await issue(other)).json();
  const configPath = join(temp, "claude-config.json");
  const queuePath = configPath + ".queue";
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const cwd = join(temp, "claude-work");
  const bin = join(temp, "claude-bin");
  await Promise.all([mkdir(cwd), mkdir(bin)]);
  await writeFile(
    join(bin, "claude"),
    '#!/bin/sh\nexec "$CLAUDE_FIXTURE_NODE" "$CLAUDE_FIXTURE_SCRIPT" "$@"\n',
    { mode: 0o700 },
  );

  async function adapter(
    mode,
    { dropAck = false, flush = false, expected = 0, prompt = null } = {},
  ) {
    const args = ["--experimental-strip-types"];
    if (dropAck) args.push("--import", join(root, "scripts/fixtures/drop-usage-ack.mjs"));
    args.push(join(root, "scripts/claude-research.mjs"), "--config", configPath);
    if (flush) args.push("--flush-only");
    else args.push("--mission", "smoke/claude#9", "--publish");
    if (prompt) args.push("--prompt-file", prompt);
    const child = spawn(process.execPath, args, {
      cwd,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CLAUDE_SMOKE_MODE: mode,
        CLAUDE_FIXTURE_NODE: process.execPath,
        CLAUDE_FIXTURE_SCRIPT: join(root, "scripts/fixtures/claude-cli.mjs"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (text) => {
      output += text;
    });
    child.stderr.setEncoding("utf8").on("data", (text) => {
      output += text;
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), 25_000);
    try {
      assert.equal((await once(child, "close"))[0], expected, `Claude adapter ${mode}: ${output}`);
    } finally {
      clearTimeout(timer);
    }
    return output;
  }
  const recorded = () =>
    db.query(
      "SELECT input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens FROM claude_research_usage",
    );
  const check = (token, payload) =>
    request("/api/research-usage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

  assert.match(
    await adapter("must-not-run", { prompt: configPath, expected: 1 }),
    /Keep access tokens out/,
  );
  assert.equal(
    (await db.query("SELECT count(*) AS n FROM research_runs WHERE user_id = $1", [author.id]))
      .rows[0].n,
    0,
  );
  assert.match(
    await adapter("success", { dropAck: true, expected: 1 }),
    /usage delivery is pending/,
  );
  const entries = await readdir(queuePath);
  assert.equal(entries.length, 1);
  const { delivery } = JSON.parse(await readFile(join(queuePath, entries[0]), "utf8"));
  assert.deepEqual((await recorded()).rows, [delivery.usage]);
  for (const path of [mission, profile]) {
    const page = await html(path);
    assert.ok(page.includes("Claude public report success"), path);
    assert.match(page, /3(?:\u00a0|\u202f| |&nbsp;|&#160;)394/);
    for (const privateField of [
      "cache_creation_input_tokens",
      "total_cost_usd",
      "rate_limit_info",
      delivery.run_id,
    ])
      assert.ok(!page.includes(privateField));
  }
  assert.equal((await repo.authorBoard(author.login, null)).reports.length, 1);
  assert.equal((await repo.missionBoard("smoke", "claude", 9, null)).reports.length, 1);
  assert.equal((await check(config.mcpToken, delivery)).status, 401);
  assert.equal((await check(foreignConfig.usageToken, delivery)).status, 404);
  assert.equal(
    (
      await check(config.usageToken, {
        ...delivery,
        usage: { ...delivery.usage, output_tokens: 51 },
      })
    ).status,
    409,
  );
  for (const path of ["/mcp", "/api/research"]) {
    assert.equal(
      (
        await request(path, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.usageToken}` },
        })
      ).status,
      401,
    );
  }

  await stop();
  await start();
  assert.match(await adapter("must-not-run", { flush: true }), /3394 tokens recorded/);
  assert.deepEqual(await readdir(queuePath), []);
  assert.equal((await recorded()).rowCount, 1);
  const run = await repo.readRun(author.id, delivery.run_id);
  assert.equal((await repo.authorBoard(author.login, null)).publicSpend.totalTokens, 3394);
  assert.equal((await repo.missionBoard("smoke", "claude", 9, null)).publicSpend.totalTokens, 3394);
  await repo.setPublished(author.id, run.id, false, Date.now());
  assert.deepEqual(await (await check(config.usageToken, delivery)).json(), {
    ok: true,
    replay: true,
  });
  assert.equal((await repo.authorBoard(author.login, null)).publicSpend.totalTokens, null);
  assert.ok(!(await html(mission)).includes(run.report.findings));
  assert.ok((await html(profile, author)).includes(run.report.findings));

  assert.match(await adapter("missing"), /no valid usage/);
  assert.match(await adapter("failed", { expected: 1 }), /did not complete successfully/);
  assert.match(await adapter("pending", { expected: 1 }), /No completed report/);
  const pending = (
    await db.query(
      "SELECT thread_id FROM research_runs WHERE user_id = $1 AND status = 'in_progress'",
      [author.id],
    )
  ).rows[0];
  assert.equal(
    (await check(config.usageToken, { ...delivery, run_id: pending.thread_id })).status,
    409,
  );
  assert.equal((await recorded()).rowCount, 1);
  assert.deepEqual(await readdir(queuePath), []);
  const board = await repo.authorBoard(author.login, null);
  assert.deepEqual(board.reports.map((r) => [r.report.findings, r.spend.totalTokens]).sort(), [
    ["Claude public report failed", null],
    ["Claude public report missing", null],
  ]);
  await repo.revokeGrant(author.id, grants[1].id, Date.now());
  assert.equal((await check(config.usageToken, delivery)).status, 401);
  console.log(
    "PASS Claude CLI through MCP, public totals, lost ack, restart, privacy and unknown usage",
  );
}

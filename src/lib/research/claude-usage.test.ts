import assert from "node:assert/strict";
import { it } from "node:test";
import { postgresTest } from "../db/testing.ts";
import { createMemoryResearch, createPostgresResearch, type ResearchRepo } from "./store.ts";
import { CLAUDE_USAGE_PATH } from "./claude-usage.ts";
import { handleClaudeUsagePost, handleResearchPost } from "./http.ts";
import { handleMcp } from "../mcp/server.ts";
import type { ResearchDelivery } from "./types.ts";

async function contract(repo: ResearchRepo) {
  const origin = "https://after-hours.test";
  const author = { id: "author", login: "author", name: "Owner", avatarUrl: "" };
  await repo.upsertAuthor(author);
  const pair = await repo.createClaudeGrants(author.id, Date.now(), origin);
  const foreign = await repo.createClaudeGrants("other", Date.now(), origin);
  const legacy = await repo.createGrant(author.id, Date.now());
  const threadId = "mcp_" + "a".repeat(48);
  const delivery: ResearchDelivery = {
    threadId,
    missionId: "example/repo#123",
    owner: "example",
    repo: "repo",
    number: 123,
    isPr: false,
    status: "in_progress",
    at: Date.now(),
    turns: [],
    limit: null,
  };
  const usage = {
    input_tokens: 2,
    output_tokens: 50,
    cache_creation_input_tokens: 3342,
    cache_read_input_tokens: 0,
  };
  const post = (token: string, body: unknown = { run_id: threadId, usage }, resource = origin) =>
    handleClaudeUsagePost(
      new Request(resource + CLAUDE_USAGE_PATH, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
      repo,
      resource,
    );

  assert.equal((await post(pair.mcp.token)).status, 401);
  assert.equal((await post(legacy.token)).status, 401);
  assert.equal((await post(pair.telemetry.token, undefined, "https://foreign.test")).status, 401);
  const headers = { Authorization: `Bearer ${pair.telemetry.token}` };
  assert.equal(
    (await handleMcp(new Request(origin + "/mcp", { headers }), { repo, origin })).status,
    401,
  );
  assert.equal(
    (
      await handleResearchPost(
        new Request(origin + "/api/research", { method: "POST", headers }),
        repo,
      )
    ).status,
    401,
  );
  assert.equal(
    (await post(pair.telemetry.token, { run_id: threadId, usage: { ...usage, output_tokens: -1 } }))
      .status,
    400,
  );
  assert.equal(
    (await post(pair.telemetry.token, { run_id: threadId, usage: { ...usage, costUSD: 1 } }))
      .status,
    400,
  );
  assert.equal((await repo.ingest(author.id, delivery, "start")).ok, true);
  assert.equal((await post(pair.telemetry.token)).status, 409);
  const report = {
    schemaVersion: 1 as const,
    findings: "Measured",
    work: "Fixture",
    evidence: [],
    unknowns: [],
    nextSteps: [],
    links: [],
  };
  const submitted: ResearchDelivery = { ...delivery, status: "completed", report };
  const accepted = await repo.ingest(author.id, submitted);
  assert.ok(accepted.ok);
  assert.equal((await post(foreign.telemetry.token)).status, 404);

  const both = await Promise.all([post(pair.telemetry.token), post(pair.telemetry.token)]);
  assert.deepEqual(
    await Promise.all(both.map((r) => r.json())).then((r) => r.map((x) => x.replay).sort()),
    [false, true],
  );
  assert.equal(
    (await post(pair.telemetry.token, { run_id: threadId, usage: { ...usage, output_tokens: 51 } }))
      .status,
    409,
  );
  assert.deepEqual(await repo.readRun(author.id, threadId), {
    ...accepted.run,
    claudeTotalTokens: 3394,
  });
  const replay = await repo.ingest(author.id, submitted);
  assert.ok(replay.ok && replay.replay);
  assert.equal(replay.run.claudeTotalTokens, 3394);
  const card = (await repo.authorBoard(author.login, null)).reports[0];
  assert.equal(card.spend.totalTokens, 3394);
  assert.equal(card.spend.cachedInputTokens, null);
  assert.equal(card.spend.inputTokens, null);

  const aged = await repo.createClaudeGrants(author.id, Date.now() - 31 * 86_400_000, origin);
  assert.equal((await post(aged.telemetry.token)).status, 401);
  await repo.revokeGrant(author.id, pair.telemetry.grant.id, Date.now());
  assert.equal((await post(pair.telemetry.token)).status, 401);
  assert.ok(await repo.authenticate(pair.mcp.token, origin + "/mcp"));
}

it("Claude telemetry scopes and immutable delivery in memory", () =>
  contract(createMemoryResearch()));
postgresTest("Claude telemetry scopes and concurrent delivery in PostgreSQL", (pool) =>
  contract(createPostgresResearch(pool)),
);

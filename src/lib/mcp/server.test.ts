import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMemoryResearch } from "../research/store.ts";
import { handleMcp } from "./server.ts";
import { publicMission } from "./missions.ts";
import { postgresTest } from "../db/testing.ts";
import { createPostgresResearch } from "../research/store.ts";
import type { ResearchRepo } from "../research/store.ts";
const task = {
  missionId: "fixture/public#7",
  owner: "fixture",
  repo: "public",
  number: 7,
  isPr: false,
  title: "Fixture",
  body: "Untrusted issue",
  url: "https://github.com/fixture/public/issues/7",
};
const report = {
  schemaVersion: 1,
  findings: "Found",
  work: "Read code",
  evidence: ["Fixture evidence"],
  unknowns: [],
  nextSteps: [],
  links: [],
};

async function client(repo: ResearchRepo, userId: string) {
  const { token, grant } = await repo.createGrant(userId, Date.now());
  const deps = {
    repo,
    origin: "https://after-hours.test",
    mission: async () => task,
    find: async () => [task],
  };
  const transport = new StreamableHTTPClientTransport(new URL(deps.origin + "/mcp"), {
    requestInit: { headers: { Authorization: "Bearer " + token } },
    fetch: async (url, init) => handleMcp(new Request(url, init), deps),
  });
  const sdk = new Client({ name: "independent-test-client", version: "1.0" });
  await sdk.connect(transport);
  return { sdk, grant, deps };
}

async function lifecycle(repo: ResearchRepo) {
  await repo.upsertAuthor({ id: "owner", login: "owner", name: "Owner", avatarUrl: "" });
  await repo.upsertAuthor({ id: "stranger", login: "stranger", name: "Stranger", avatarUrl: "" });
  const a = await client(repo, "owner");
  const b = await client(repo, "stranger");
  const call = (name: string, args: Record<string, unknown>) =>
    a.sdk.callTool({ name, arguments: args });
  try {
    assert.equal((await a.sdk.listTools()).tools.length, 6);
    const request_id = randomUUID();
    const started = await call("start_research", { mission: task.missionId, request_id });
    assert.ok(!started.isError, JSON.stringify(started));
    const run_id = (started.structuredContent as { run_id: string }).run_id;
    assert.match(run_id, /^mcp_/);
    const replay = await call("start_research", { mission: task.missionId, request_id });
    assert.equal((replay.structuredContent as { run_id: string }).run_id, run_id);
    assert.equal(
      (await b.sdk.callTool({ name: "submit_report", arguments: { run_id, report } })).isError,
      true,
    );
    await call("update_research", { run_id, status: "waiting" });
    assert.equal((await repo.missionBoard("fixture", "public", 7, null)).reports.length, 0);
    const submitted = await call("submit_report", { run_id, report, totalTokens: 999 });
    assert.ok(!submitted.isError, JSON.stringify(submitted));
    assert.equal(
      ((await call("submit_report", { run_id, report })).structuredContent as { replay: boolean })
        .replay,
      true,
    );
    assert.equal(
      (await call("submit_report", { run_id, report: { ...report, findings: "Changed" } })).isError,
      true,
    );
    assert.equal((await call("update_research", { run_id, status: "interrupted" })).isError, true);
    const run = await repo.readRun("owner", run_id);
    assert.equal(run?.turns.length, 0);
    assert.equal((await repo.missionBoard("fixture", "public", 7, null)).reports.length, 1);
    await repo.setPublished("owner", run!.id, false, Date.now());
    await call("submit_report", { run_id, report });
    assert.equal((await repo.missionBoard("fixture", "public", 7, null)).reports.length, 0);
    await repo.revokeGrant("owner", a.grant.id, Date.now());
    await assert.rejects(call("get_research", { run_id }));
  } finally {
    await a.sdk.close();
    await b.sdk.close();
  }
}
it("MCP: SDK HTTP lifecycle, replay, privacy, unknown usage and revocation", async () =>
  lifecycle(createMemoryResearch()));
postgresTest("MCP: PostgreSQL lifecycle through SDK HTTP transport", (pool) =>
  lifecycle(createPostgresResearch(pool)),
);
it("MCP: rejects anonymous and hostile-origin calls", async () => {
  const deps = { repo: createMemoryResearch(), origin: "https://after-hours.test" };
  const unauthorized = await handleMcp(new Request(deps.origin + "/mcp"), deps);
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get("www-authenticate")!, /oauth-protected-resource/);
  assert.equal(
    (
      await handleMcp(
        new Request(deps.origin + "/mcp", {
          headers: { Origin: "https://attacker.test" },
        }),
        deps,
      )
    ).status,
    403,
  );
});
it("MCP: private/unknown visibility and transferred issues are never exposed", async () => {
  for (const metadata of [{ private: true }, {}, { private: false, visibility: "private" }]) {
    let calls = 0;
    await assert.rejects(
      publicMission("fixture/private#7", async () => {
        calls++;
        return Response.json(metadata);
      }),
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    publicMission("fixture/public#7", async (url) =>
      String(url).endsWith("/issues/7")
        ? Response.json({
            number: 7,
            title: "Secret",
            repository_url: "https://api.github.com/repos/fixture/private",
          })
        : Response.json({ private: false }),
    ),
  );
});

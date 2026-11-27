import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMemoryResearch } from "../research/store.ts";
import { handleMcp } from "./server.ts";
import { createPublicMissionReader, findMissions, publicMission } from "./missions.ts";
import type { DiscoveryLoad } from "../discovery/types.ts";
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

async function client(repo: ResearchRepo, userId: string, mission = async () => task) {
  const { token, grant } = await repo.createGrant(userId, Date.now());
  const deps = {
    repo,
    origin: "https://after-hours.test",
    mission,
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
  let githubUnavailable = false;
  let missionCalls = 0;
  const a = await client(repo, "owner", async () => {
    missionCalls++;
    if (githubUnavailable) throw new Error("GitHub unavailable");
    return task;
  });
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
    assert.equal(
      (await b.sdk.callTool({ name: "submit_report", arguments: { run_id, report } })).isError,
      true,
    );
    await call("update_research", { run_id, status: "waiting" });
    assert.equal((await repo.missionBoard("fixture", "public", 7, null)).reports.length, 0);
    githubUnavailable = true;
    const replay = await call("start_research", { mission: task.url.toUpperCase(), request_id });
    assert.deepEqual(replay.structuredContent, { run_id, status: "waiting" });
    assert.equal(
      (await call("start_research", { mission: "fixture/public#8", request_id })).isError,
      true,
    );
    assert.equal(missionCalls, 1);
    assert.equal((await call("submit_report", { run_id, report })).isError, true);
    assert.equal((await repo.missionBoard("fixture", "public", 7, null)).reports.length, 0);
    githubUnavailable = false;
    const submitted = await call("submit_report", { run_id, report, totalTokens: 999 });
    assert.ok(!submitted.isError, JSON.stringify(submitted));
    githubUnavailable = true;
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
    const hidden = await call("submit_report", { run_id, report });
    assert.equal((hidden.structuredContent as { published: boolean }).published, false);
    assert.equal((await repo.missionBoard("fixture", "public", 7, null)).reports.length, 0);
    assert.equal(missionCalls, 3);
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
postgresTest("MCP: a racing start does not reset the winning run", async (pool) => {
  const repo = createPostgresResearch(pool);
  await repo.upsertAuthor({ id: "owner", login: "owner", name: "Owner", avatarUrl: "" });
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fast = await client(repo, "owner");
  const slow = await client(repo, "owner", async () => {
    enter();
    await released;
    return task;
  });
  const start = {
    name: "start_research",
    arguments: { mission: task.missionId, request_id: randomUUID() },
  };
  const pending = slow.sdk.callTool(start);
  try {
    await Promise.race([entered, pending]);
    const first = await fast.sdk.callTool(start);
    const run_id = (first.structuredContent as { run_id: string }).run_id;
    assert.equal(typeof run_id, "string");
    const waiting = await fast.sdk.callTool({
      name: "update_research",
      arguments: { run_id, status: "waiting" },
    });
    assert.deepEqual(waiting.structuredContent, { run_id, status: "waiting" });
    release();
    assert.deepEqual((await pending).structuredContent, { run_id, status: "waiting" });
  } finally {
    release();
    await Promise.all([pending, fast.sdk.close(), slow.sdk.close()]);
  }
});
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

it("MCP: read tools share recent public metadata and always fetch the issue anonymously", async () => {
  let now = 100_000;
  let repoChecks = 0;
  let issueReads = 0;
  let isPublic = true;
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    assert.equal(init?.redirect, "error");
    if (String(url).toLowerCase().endsWith("/repos/fixture/public")) {
      repoChecks++;
      return Response.json({ private: !isPublic });
    }
    issueReads++;
    if (!isPublic) return new Response(null, { status: 404 });
    return Response.json({
      number: Number(String(url).split("/").at(-1)),
      title: `Issue read ${issueReads}`,
      repository_url: "https://api.github.com/repos/fixture/public",
    });
  };
  const read = createPublicMissionReader(fetcher, () => now);
  await Promise.all([read("fixture/public#7"), read("Fixture/Public#8")]);
  assert.equal(repoChecks, 1);
  assert.equal(issueReads, 2);
  isPublic = false;
  await assert.rejects(publicMission("fixture/public#7", fetcher), /public repositories/);
  await assert.rejects(read("fixture/public#7"), /unavailable/);
  assert.equal(issueReads, 3);
  now += 30_000;
  await assert.rejects(read("fixture/public#7"), /public repositories/);
  isPublic = true;
  assert.equal((await read("fixture/public#7")).title, "Issue read 4");
  assert.equal(repoChecks, 4);
});

it("MCP: a rate-limited search does not look like an empty catalog", async () => {
  await assert.rejects(
    findMissions({ limit: 5 }, async (url) => {
      if (String(url).includes("/search/issues"))
        return Response.json({ items: [{ html_url: task.url }] });
      return new Response(null, { status: 429, headers: { "Retry-After": "120" } });
    }),
    /GitHub rate limit\. Retry in 120 seconds/,
  );
});

it("MCP: uses the published topic selection and rechecks current repository and issue identity", async () => {
  const now = Date.now();
  const load = async (): Promise<DiscoveryLoad> => ({
    status: "ready",
    stale: false,
    updatedAt: now,
    issuesIndexed: true,
    cards: [
      {
        isPublic: true,
        world: "web",
        id: "101",
        owner: "fixture",
        repo: "public",
        description: "Fixture",
        blurb: "",
        logoUrl: "",
        url: "https://github.com/fixture/public",
        language: "TypeScript",
        stars: 5,
        live: false,
        tags: ["web-tests"],
        license: "MIT",
        createdAt: now,
        firstSeenAt: now,
        observedAt: now,
        badges: ["active"],
        reasons: [],
        growth: null,
        issues: [
          {
            number: 8,
            title: "Old permission test",
            excerpt: "",
            checkedAt: now,
            evidence: "file",
          },
          {
            number: 7,
            title: "Permission test fails",
            excerpt: "",
            checkedAt: now,
            evidence: "file",
          },
        ],
      },
    ],
  });
  let repoId = 101;
  let unavailable = false;
  const calls: string[] = [];
  const fetcher = async (url: RequestInfo | URL) => {
    if (unavailable) return new Response(null, { status: 503 });
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path === "/repos/fixture/public")
      return Response.json({
        id: repoId,
        private: false,
        archived: false,
        license: { spdx_id: "MIT" },
      });
    assert.match(path, /^\/repos\/fixture\/public\/issues\/[78]$/);
    const number = Number(path.split("/").at(-1));
    return Response.json({
      title: "Permission test fails",
      body: "Steps to reproduce: open fullscreen/tests/permissions.html and compare the expected and actual values.",
      number,
      state: number === 7 ? "open" : "closed",
      repository_url: "https://api.github.com/repos/fixture/public",
    });
  };
  const input = {
    category: "web",
    tag: "web-tests",
    language: "typescript",
    view: "active" as const,
    limit: 5,
  };
  assert.deepEqual(
    (await findMissions(input, fetcher, load)).map(({ number }) => number),
    [7],
  );
  assert.equal(calls.filter((path) => path === "/repos/fixture/public").length, 1);
  assert.equal(
    calls.some((path) => path === "/search/issues"),
    false,
  );
  assert.deepEqual(
    (await findMissions({ ...input, limit: 1 }, fetcher, load)).map(({ number }) => number),
    [7],
  );
  assert.deepEqual(await findMissions({ ...input, tag: "browser-apis" }, fetcher, load), []);
  repoId = 102;
  assert.deepEqual(await findMissions(input, fetcher, load), []);
  unavailable = true;
  await assert.rejects(findMissions(input, fetcher, load), /GitHub data is unavailable/);
});

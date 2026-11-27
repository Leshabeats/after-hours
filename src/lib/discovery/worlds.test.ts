import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { migrate } from "../db/migrate.ts";
import { postgresTest } from "../db/testing.ts";
import { collectDiscovery, parseRepository } from "./collector.ts";
import { filterDiscovery } from "./presentation.ts";
import { buildSnapshot, classifyRepository, DAY } from "./ranking.ts";
import {
  createMemoryDiscovery,
  createPostgresDiscovery,
  DiscoveryLeaseLostError,
} from "./store.ts";

const NOW = Date.UTC(2026, 10, 27, 12);
const raw = (id: number, spdx?: string) => ({
  id,
  private: false,
  visibility: "public",
  name: `browser-tests-${id}`,
  owner: { login: "browser" },
  description: "Tests for the Web platform",
  language: "TypeScript",
  topics: ["web-platform-tests"],
  stargazers_count: 11,
  forks_count: 1,
  created_at: new Date(NOW - 10 * DAY).toISOString(),
  pushed_at: new Date(NOW - DAY).toISOString(),
  archived: false,
  fork: false,
  license: spdx === undefined ? null : { spdx_id: spdx },
});
function stored(id: number, stars = 11) {
  return {
    ...parseRepository(raw(id, "MIT"), NOW, "refresh", "web")!,
    countsSource: "repository" as const,
    firstSeenAt: NOW,
    stars,
  };
}

it("uses exact world topics rather than description or model guesses", () => {
  const fixture = {
    owner: "example",
    repo: "everything",
    description: "RAG Linux Web",
    topics: [],
  };
  assert.deepEqual(classifyRepository(fixture, "ai"), []);
  assert.deepEqual(classifyRepository({ ...fixture, topics: ["LLM-INFERENCE", "rag"] }, "ai"), [
    "inference",
    "rag",
  ]);
  assert.deepEqual(classifyRepository({ ...fixture, topics: ["flatpak"] }, "linux"), ["packages"]);
  assert.deepEqual(classifyRepository({ ...fixture, topics: ["sql-client"] }, "data"), [
    "database-clients",
  ]);
});

it("publishes the scoped Web feed only after licensing and stable-ID rechecks", async () => {
  const store = createMemoryDiscovery();
  const requests: URL[] = [];
  let rateLimited = false;
  const options = {
    world: "web" as const,
    collectIssues: true,
    store,
    now: () => NOW,
    sleep: async () => {},
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.pathname === "/search/repositories")
        return Response.json({
          items: [raw(1, "MIT"), raw(2, "NOASSERTION"), raw(3, "GPL-3.0-only"), raw(4)],
          incomplete_results: false,
          total_count: 4,
        });
      if (url.pathname === "/repositories/1") return Response.json(raw(1, "Apache-2.0"));
      if (url.pathname === "/repositories/3") return Response.json(raw(3, "NOASSERTION"));
      if (url.pathname === "/graphql") {
        assert.equal(init?.method, "POST");
        assert.match(String(init?.body), /browser-tests-1/);
        if (rateLimited) return Response.json({ errors: [{ type: "RATE_LIMITED" }] });
        return Response.json({
          data: {
            r0: {
              databaseId: 1,
              nameWithOwner: "browser/browser-tests-1",
              isPrivate: false,
              visibility: "PUBLIC",
              isArchived: false,
              issues: {
                nodes: [
                  {
                    number: 7,
                    title: "Fix the browser permission test",
                    body: "Steps to reproduce: open browser/tests/permissions.html and compare the expected and actual results.",
                    state: "OPEN",
                    updatedAt: new Date(NOW - 1000).toISOString(),
                    assignees: { totalCount: 0 },
                    labels: { nodes: [] },
                    closedByPullRequestsReferences: { nodes: [], pageInfo: { hasNextPage: false } },
                  },
                ],
              },
            },
          },
        });
      }
      if (url.pathname.endsWith("/pulls")) return Response.json([]);
      return new Response(null, { status: 404 });
    },
  };
  assert.equal((await collectDiscovery({ ...options, maxRequests: 2 })).status, "partial");
  assert.equal(await store.snapshot(), null);
  assert.equal((await collectDiscovery(options)).status, "published");
  const result = (await store.snapshot())!;
  assert.equal(result.issuesIndexed, true);
  assert.deepEqual(
    result.cards[0]?.issues?.map((issue) => issue.number),
    [7],
  );
  assert.deepEqual(
    result.cards.map(({ id, license, world }) => [id, license, world]),
    [["1", "Apache-2.0", "web"]],
  );
  assert.equal(filterDiscovery(result.cards, { cat: "web", tag: "web-tests" }).length, 1);
  assert.equal(filterDiscovery(result.cards, { cat: "games" }).length, 0);
  const searches = requests.filter((url) => url.pathname === "/search/repositories");
  assert.ok(
    searches.some((url) => url.searchParams.get("q")?.includes("topic:web-platform-tests")),
  );
  assert.ok(searches.every((url) => !url.searchParams.get("q")?.includes("topic:game-engine")));
  assert.ok(requests.some((url) => url.pathname === "/repositories/3"));
  rateLimited = true;
  assert.equal((await collectDiscovery({ ...options, now: () => NOW + DAY })).status, "paused");
  assert.deepEqual(await store.snapshot(), result);
});

postgresTest(
  "world leases, baselines and snapshots are separate while explicit privacy revocation is shared",
  async (pool) => {
    const games = createPostgresDiscovery(pool);
    const web = createPostgresDiscovery(pool, "web");
    const [gameLease, webLease] = await Promise.all([
      games.acquire(NOW, 100),
      web.acquire(NOW, 100),
    ]);
    assert.ok(gameLease && webLease);
    await assert.rejects(web.save(gameLease, NOW + 1, 100, [], null), DiscoveryLeaseLostError);
    const game = { ...stored(7, 21), tags: ["tools"] as const };
    await games.save(gameLease, NOW + 1, 100, [{ ...game, tags: [...game.tags] }], null);
    await web.save(webLease, NOW + 1, 100, [stored(7, 82)], { cursor: 2 });
    await web.publish(webLease, NOW + 2, buildSnapshot([stored(7, 82)], [], NOW + 2, "web"));
    assert.equal(await games.snapshot(), null);
    assert.equal((await web.snapshot())?.cards[0]?.stars, 82);
    assert.deepEqual(
      (await games.metrics(0)).map((point) => point.stars),
      [21],
    );
    assert.deepEqual(
      (await web.metrics(0)).map((point) => point.stars),
      [82],
    );

    await games.save(
      gameLease,
      NOW + 3,
      100,
      [{ ...stored(7), observedAt: NOW + 3, isPublic: false }],
      null,
    );
    assert.deepEqual((await web.snapshot())?.cards, []);
    assert.equal((await web.snapshot())?.generatedAt, NOW + 2);
    const tentative = {
      ...stored(7),
      observedAt: NOW + 4,
      countsSource: "search" as const,
    };
    await games.save(gameLease, NOW + 4, 100, [tentative], null);
    assert.equal((await games.repositories())[0]?.isPublic, false);
    assert.deepEqual((await web.snapshot())?.cards, []);

    await games.release(gameLease, NOW + 5, "GitHub rate limited", NOW + 1000);
    assert.equal(await web.acquire(NOW + 999, 100), null);
    assert.ok(await web.acquire(NOW + 1000, 100));
  },
);

postgresTest(
  "upgrading the existing GameDev tables preserves the pointer, checkpoint and measured history",
  async (pool) => {
    // Reconstruct the previously applied discovery schema inside the isolated test schema.
    await pool.query(`
    DROP TABLE discovery_sync_state, discovery_daily_metrics;
    DROP TABLE discovery_runs, discovery_repositories;
    DELETE FROM schema_migrations WHERE version = '006_discovery_worlds.sql'
  `);
    await pool.query(
      await readFile(new URL("../../../migrations/002_discovery.sql", import.meta.url), "utf8"),
    );
    const repo = { ...stored(7), tags: ["tools" as const] };
    const snapshot = buildSnapshot([repo], [], NOW);
    await pool.query("INSERT INTO discovery_repositories VALUES ('7',$1,$1,$2)", [
      NOW,
      JSON.stringify(repo),
    ]);
    await pool.query("INSERT INTO discovery_daily_metrics VALUES ('7','2026-11-27',$1,11,1)", [
      NOW,
    ]);
    await pool.query(
      `
    INSERT INTO discovery_runs (id,status,started_at,updated_at,snapshot,completed_at)
    VALUES ('published','completed',$1,$1,$2,$1)
  `,
      [NOW, JSON.stringify(snapshot)],
    );
    await pool.query(
      `
    INSERT INTO discovery_runs (id,status,started_at,updated_at,checkpoint)
    VALUES ('interrupted','interrupted',$1,$1,'{"version":7}')
  `,
      [NOW],
    );
    await pool.query(
      "UPDATE discovery_sync_state SET published_run_id = 'published', current_run_id = 'interrupted'",
    );
    await migrate(pool);

    const games = createPostgresDiscovery(pool);
    const web = createPostgresDiscovery(pool, "web");
    assert.deepEqual(await games.snapshot(), snapshot);
    assert.equal((await games.metrics(0))[0]?.stars, 11);
    assert.deepEqual((await games.acquire(NOW + 1, 100))?.checkpoint, { version: 7 });
    assert.equal(await web.snapshot(), null);
    assert.deepEqual(await web.metrics(0), []);
  },
);

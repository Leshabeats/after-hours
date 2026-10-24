import assert from "node:assert/strict";
import { test } from "node:test";
import { postgresTest } from "../db/testing.ts";
import { collectDiscovery, parseRepository } from "./collector.ts";
import { DAY } from "./ranking.ts";
import { createMemoryDiscovery, createPostgresDiscovery } from "./store.ts";
import type { DiscoveryStore, Observation } from "./types.ts";

const NOW = Date.UTC(2026, 9, 24, 12);
const ID = 42;
const MEASURED = NOW - 19 * 60 * 60 * 1000;
type Flow = "search-first" | "late-page";

function raw(id: number, stars: number, forks: number) {
  return {
    id,
    private: false,
    visibility: "public",
    owner: { login: "fixture" },
    name: `engine-${id}`,
    description: "Public game engine",
    topics: ["game-engine"],
    language: "Rust",
    stargazers_count: stars,
    forks_count: forks,
    created_at: new Date(NOW - 100 * DAY).toISOString(),
    pushed_at: new Date(NOW - DAY).toISOString(),
    archived: false,
    disabled: false,
    fork: false,
    size: 1,
  };
}

function observation(id: number, at: number, stars: number, forks: number): Observation {
  const parsed = parseRepository(raw(id, stars, forks), at, "fixture");
  assert.ok(parsed);
  return parsed;
}

async function seed(store: DiscoveryStore, flow: Flow) {
  const lease = await store.acquire(NOW, DAY);
  assert.ok(lease);
  await store.save(lease, NOW, DAY, [observation(ID, NOW - 7 * DAY, 100, 10)], null);
  await store.save(
    lease,
    NOW,
    DAY,
    [
      {
        ...observation(ID, MEASURED, 160, 16),
        releaseAt: NOW - 2 * DAY,
        activityCheckedAt: MEASURED,
      },
    ],
    null,
  );
  if (flow === "search-first") {
    // Keep the already-fresh target outside the rotating metadata queue, so its
    // first current-scan count comes from search and its next fetch verifies identity.
    await store.save(
      lease,
      NOW,
      DAY,
      Array.from({ length: 220 }, (_, i) => observation(1000 + i, NOW - 3 * DAY, 5, 1)),
      null,
    );
  }
  await store.publish(lease, NOW, { version: 1, generatedAt: NOW, cards: [] });
}

async function scan(
  store: DiscoveryStore,
  config: {
    flow: Flow;
    stars: number;
    start?: number;
    stalled?: boolean;
    resume?: boolean;
    search?: boolean;
  },
) {
  let time = config.start ?? NOW;
  let query: string | undefined;
  const stableTimes: number[] = [];
  const events: string[] = [];
  let requests = 0;
  let partials = 0;
  const maxRequests = config.resume ? 3 : 500;
  for (let invocation = 0; invocation < 150; invocation++) {
    const result = await collectDiscovery({
      store,
      maxRequests,
      now: () => time,
      sleep: async (ms) => {
        if (!config.stalled) time += ms;
      },
      fetchImpl: (async (input, init) => {
        const url = new URL(String(input));
        assert.equal(url.origin, "https://api.github.com");
        assert.equal(init?.redirect, "manual");
        requests++;
        if (url.pathname === "/search/repositories") {
          query ??= url.searchParams.get("q")!;
          const first = query === url.searchParams.get("q");
          const page = url.searchParams.get("page");
          const include =
            config.search !== false && first && page === (config.flow === "late-page" ? "2" : "1");
          if (include) events.push("search:50");
          return Response.json({
            items: include ? [raw(ID, 50, 1)] : [],
            total_count:
              config.search !== false && first && config.flow === "late-page" && page === "1"
                ? 31
                : include
                  ? 1
                  : 0,
            incomplete_results: false,
          });
        }
        const match = url.pathname.match(/^\/repositories\/(\d+)(\/.*)?$/);
        if (!match) {
          assert.equal(url.pathname, "/repos/gloriouseggroll/proton-ge-custom");
          return Response.json({}, { status: 404 });
        }
        const id = Number(match[1]);
        if (match[2] === "/releases/latest")
          return id === ID
            ? Response.json({
                published_at: new Date(time - DAY).toISOString(),
                draft: false,
                prerelease: false,
              })
            : Response.json({}, { status: 404 });
        if (match[2] === "/pulls") return Response.json([]);
        assert.equal(match[2], undefined);
        if (id === ID) {
          stableTimes.push(time);
          events.push(`repository:${config.stars}`);
        }
        return Response.json(
          raw(id, id === ID ? config.stars : 5, id === ID ? config.stars / 10 : 1),
        );
      }) as typeof fetch,
    });
    assert.ok(result.requests <= maxRequests);
    if (result.status === "published") {
      assert.ok(requests <= 500);
      if (config.resume) assert.ok(partials > 0);
      assert.ok(stableTimes.length > 0, "publication must verify the stable public repository ID");
      return { time, stableTimes, events };
    }
    assert.equal(result.status, "partial");
    partials++;
  }
  assert.fail("checkpoint did not complete within its bounded invocation allowance");
}

async function assertCounts(
  store: DiscoveryStore,
  stars: number,
  stableTimes: number[],
  day: number,
) {
  const snapshot = await store.snapshot();
  assert.ok(snapshot);
  const card = snapshot.cards.find((row) => row.id === String(ID));
  assert.ok(card);
  assert.equal(card.isPublic, true);
  assert.equal(card.url, `https://github.com/fixture/engine-${ID}`);
  assert.equal(
    card.stars,
    stars,
    "verified stable-ID counts must supersede search counts, including real declines",
  );
  assert.ok(stableTimes.includes(card.observedAt), "count time must belong to a repository sample");
  const repository = (await store.repositories()).find((row) => row.id === String(ID));
  assert.ok(repository);
  assert.equal(repository.stars, stars);
  assert.equal(repository.forks, stars / 10);
  assert.equal(repository.countsObservedAt, card.observedAt);
  const currentMetrics = (await store.metrics(0)).filter(
    (row) =>
      row.repoId === String(ID) && Math.floor(row.observedAt / DAY) === Math.floor(day / DAY),
  );
  assert.deepEqual(currentMetrics, [
    { repoId: String(ID), observedAt: card.observedAt, stars, forks: stars / 10 },
  ]);
  return card;
}

async function provenance(store: DiscoveryStore, flow: Flow, stars: number) {
  await seed(store, flow);
  const stalled = flow === "late-page" && stars === 180;
  const result = await scan(store, { flow, stars, stalled, resume: stalled });
  const searchIndex = result.events.indexOf("search:50");
  const firstStable = result.events.indexOf(`repository:${stars}`);
  assert.ok(searchIndex >= 0);
  assert.ok(flow === "late-page" ? firstStable < searchIndex : searchIndex < firstStable);
  const card = await assertCounts(store, stars, result.stableTimes, NOW);
  assert.deepEqual(card.growth, { stars: stars - 100, days: 7 });
  assert.equal(card.badges.includes("growing"), stars > 100);
  if (stalled) {
    // The same-timestamp scan must write 180, not search's 50 or the prior 160.
    // Its stored sample then becomes next week's actual baseline.
    const next = await scan(store, {
      flow,
      stars: 200,
      start: NOW + 7 * DAY,
      stalled: true,
      search: false,
    });
    const nextCard = await assertCounts(store, 200, next.stableTimes, NOW + 7 * DAY);
    assert.deepEqual(nextCard.growth, { stars: 20, days: 7 });
    assert.ok(nextCard.badges.includes("growing"));
  }
}

for (const flow of ["search-first", "late-page"] as const) {
  for (const stars of [180, 100, 80]) {
    const name = `${flow}: stable-ID ${stars} stars overrides search50 with authentic daily metrics`;
    test(name, async () => provenance(createMemoryDiscovery(), flow, stars));
    postgresTest(`postgres: ${name}`, async (pool) =>
      provenance(createPostgresDiscovery(pool), flow, stars),
    );
  }
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { postgresTest } from "../db/testing.ts";
import { collectDiscovery, parseRepository } from "./collector.ts";
import { buildSnapshot, DAY } from "./ranking.ts";
import { createMemoryDiscovery, createPostgresDiscovery } from "./store.ts";
import type { DiscoveryStore, Observation } from "./types.ts";

const NOW = Date.UTC(2026, 9, 24, 12);
const MATURE_IDS = Array.from({ length: 30 }, (_, i) => i + 10);
const MATURE = new Set(MATURE_IDS.map(String));

function raw(id: number, stars = MATURE.has(String(id)) ? 160 : 5) {
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
    forks_count: 1,
    created_at: new Date(NOW - (id >= 10_000 ? 1 : 100) * DAY).toISOString(),
    pushed_at: new Date(NOW - DAY).toISOString(),
    archived: false,
    disabled: false,
    fork: false,
    size: 1,
  };
}

function observation(id: number, at: number, stars: number): Observation {
  const parsed = parseRepository(raw(id, stars), at, "fixture");
  assert.ok(parsed);
  return { ...parsed, countsSource: "repository" };
}

async function retainedMeasurement(store: DiscoveryStore, hours = 19, mixed = false) {
  const measuredAt = NOW - hours * 60 * 60 * 1000;
  const excluded = new Set(mixed ? ["10", "11", "12", "13", "14", "15"] : []);
  const seed = await store.acquire(NOW, DAY);
  assert.ok(seed);
  // The 7-day baseline is closest to the existing measurement. Remeasuring now
  // would instead choose the newer 155-star sample and erase this valid +60 window.
  for (const [at, stars] of [
    [measuredAt - 7 * DAY, 100],
    [measuredAt - 6 * DAY, 155],
  ]) {
    await store.save(
      seed,
      NOW,
      DAY,
      MATURE_IDS.map((id) => observation(id, at, stars)),
      null,
    );
  }
  await store.save(
    seed,
    NOW,
    DAY,
    [
      ...MATURE_IDS.map((id) => ({
        ...observation(id, measuredAt, 160),
        releaseAt: NOW - 2 * DAY,
        activityCheckedAt: measuredAt,
      })),
      ...Array.from({ length: 220 }, (_, i) => observation(1000 + i, NOW - 3 * DAY, 5)),
    ],
    null,
  );
  if (mixed) {
    await store.save(seed, NOW, DAY, [observation(5000, NOW - 9.5 * DAY, 100)], null);
    await store.save(
      seed,
      NOW,
      DAY,
      [
        {
          ...observation(5000, NOW - 3 * DAY, 150),
          releaseAt: NOW - 4 * DAY,
          activityCheckedAt: NOW - 3 * DAY,
        },
      ],
      null,
    );
  }
  await store.publish(seed, NOW, { version: 1, generatedAt: NOW, cards: [] });

  const before = buildSnapshot(await store.repositories(), await store.metrics(0), NOW);
  assert.equal(before.cards.filter((card) => card.badges.includes("growing")).length, 30);

  let time = NOW;
  let searchPages = 0;
  const requests: string[] = [];
  const result = await collectDiscovery({
    store,
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    fetchImpl: (async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://api.github.com");
      assert.equal(init?.redirect, "manual");
      requests.push(url.pathname);
      if (url.pathname === "/search/repositories") {
        const group = searchPages++;
        const items =
          group < 8 ? Array.from({ length: 15 }, (_, i) => raw(10_000 + group * 15 + i)) : [];
        return Response.json({ items, total_count: items.length, incomplete_results: false });
      }
      const match = url.pathname.match(/^\/repositories\/(\d+)(\/.*)?$/);
      if (!match) {
        assert.equal(url.pathname, "/repos/gloriouseggroll/proton-ge-custom");
        return Response.json({}, { status: 404 });
      }
      const id = Number(match[1]);
      if (match[2] === "/releases/latest") {
        return MATURE.has(String(id))
          ? Response.json({
              published_at: new Date(NOW - 2 * DAY).toISOString(),
              draft: false,
              prerelease: false,
            })
          : Response.json({}, { status: 404 });
      }
      if (match[2] === "/pulls") return Response.json([]);
      assert.equal(match[2], undefined);
      if (mixed) {
        if (id === 10)
          return Response.json({ ...raw(id), private: true, description: "PRIVATE BODY" });
        if (id === 11) return Response.json({ ...raw(id), private: undefined });
        if (id >= 12 && id <= 14) return Response.json({}, { status: [404, 410, 451][id - 12] });
        if (id === 15) return Response.json({ ...raw(id), archived: true });
        if (id === 16)
          return Response.json({ ...raw(id), owner: { login: "renamed" }, name: "engine-renamed" });
      }
      return Response.json(raw(id));
    }) as typeof fetch,
  });
  assert.equal(result.status, "published");
  assert.ok(result.requests <= 500);
  assert.equal(result.requests, requests.length);
  assert.ok(searchPages >= 8);
  const stored = await store.repositories();
  assert.equal(stored.filter((repo) => Number(repo.id) >= 10_000).length, 120);
  const direct = buildSnapshot(stored, await store.metrics(0), time);
  assert.equal(
    direct.cards.filter((card) => MATURE.has(card.id) && card.badges.includes("growing")).length,
    30 - excluded.size,
  );
  const snapshot = await store.snapshot();
  assert.ok(snapshot);
  const grown = snapshot.cards.filter(
    (card) => MATURE.has(card.id) && card.badges.includes("growing"),
  );
  assert.equal(
    grown.length,
    30 - excluded.size,
    "verified publication must retain still-valid growth measurements",
  );
  for (const card of grown) {
    assert.equal(card.isPublic, true);
    const renamed = mixed && card.id === "16";
    assert.equal(card.owner, renamed ? "renamed" : "fixture");
    assert.equal(card.repo, renamed ? "engine-renamed" : `engine-${card.id}`);
    assert.equal(
      card.url,
      renamed
        ? "https://github.com/renamed/engine-renamed"
        : `https://github.com/fixture/engine-${card.id}`,
    );
    assert.equal(card.stars, 160);
    assert.equal(card.observedAt, measuredAt);
    assert.deepEqual(card.growth, { stars: 60, days: 7 });
    assert.ok(
      requests.includes(`/repositories/${card.id}`),
      "public identity must be verified by stable ID in this run",
    );
  }
  if (mixed) {
    assert.ok(snapshot.cards.every((c) => !excluded.has(c.id) && c.id !== "5000"));
    assert.ok(!JSON.stringify([stored, snapshot]).includes("PRIVATE BODY"));
    const metrics = await store.metrics(0);
    for (const id of MATURE) {
      assert.ok(
        metrics.filter((m) => m.repoId === id).every((m) => m.observedAt <= measuredAt),
        "identity-only validation or revocation cannot manufacture daily counts",
      );
    }
    assert.ok(
      metrics.filter((m) => m.repoId === "5000").every((m) => m.observedAt <= NOW - 3 * DAY),
    );
  }
}

test("publication retains valid measured growth when 120 new engines compete for verification", async () =>
  retainedMeasurement(createMemoryDiscovery()));
postgresTest(
  "postgres: publication retains 19-hour measurements with current public identity",
  async (pool) => retainedMeasurement(createPostgresDiscovery(pool)),
);

test("36-hour measurements survive pressure while stale, private and unavailable rows stay excluded", async () =>
  retainedMeasurement(createMemoryDiscovery(), 36, true));
postgresTest(
  "postgres: retained counts preserve privacy, availability and renamed identity",
  async (pool) => retainedMeasurement(createPostgresDiscovery(pool), 36, true),
);

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { postgresTest } from "../db/testing.ts";
import { collectDiscovery, parseRepository } from "./collector.ts";
import { DAY } from "./ranking.ts";
import { createMemoryDiscovery, createPostgresDiscovery } from "./store.ts";
import type { DiscoveryStore, Observation } from "./types.ts";

const SEARCH_AT = Date.UTC(2026, 9, 24, 23, 50);
const RESUME_AT = Date.UTC(2026, 9, 25, 0, 10);
const ID = 42;

function raw(id: number, stars: number) {
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
    forks_count: stars / 10,
    created_at: new Date(SEARCH_AT - 100 * DAY).toISOString(),
    pushed_at: new Date(SEARCH_AT - DAY).toISOString(),
    archived: false,
    disabled: false,
    fork: false,
    size: 1,
  };
}

function measured(id: number, at: number, stars: number, scanId: string): Observation {
  const repo = parseRepository(raw(id, stars), at, "fixture");
  assert.ok(repo);
  return { ...repo, countsSource: "repository", countsScanId: scanId, countsMeasured: true };
}

function harness(at: number, stars: number, includeSearch: boolean) {
  let time = at;
  let searched = false;
  const metadataTimes: number[] = [];
  const options = {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    fetchImpl: (async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://api.github.com");
      assert.equal(init?.redirect, "manual");
      if (url.pathname === "/search/repositories") {
        const items = includeSearch && !searched ? [raw(ID, 50)] : [];
        searched = true;
        return Response.json({ items, total_count: items.length, incomplete_results: false });
      }
      if (url.pathname.endsWith("/releases/latest"))
        return Response.json({
          published_at: new Date(time - DAY).toISOString(),
          draft: false,
          prerelease: false,
        });
      if (url.pathname.endsWith("/pulls")) return Response.json([]);
      const match = url.pathname.match(/^\/repositories\/(\d+)$/);
      if (!match) {
        assert.equal(url.pathname, "/repos/gloriouseggroll/proton-ge-custom");
        return Response.json({}, { status: 404 });
      }
      const id = Number(match[1]);
      if (id === ID) metadataTimes.push(time);
      return Response.json(raw(id, id === ID ? stars : 900));
    }) as typeof fetch,
  };
  return { ...options, metadataTimes };
}

async function midnight(store: DiscoveryStore, nextStars: number, sameDaySample = false) {
  const seed = await store.acquire(SEARCH_AT, DAY);
  assert.ok(seed);
  const previousAt = SEARCH_AT - (sameDaySample ? 60 * 60 * 1000 : DAY);
  const prior = measured(ID, previousAt, 170, seed.runId);
  const unrelated = measured(77, SEARCH_AT - 2 * 60 * 60 * 1000, 900, seed.runId);
  await store.save(seed, SEARCH_AT, DAY, [prior, unrelated], null);
  await store.publish(seed, SEARCH_AT, { version: 1, generatedAt: SEARCH_AT, cards: [] });
  const existingMetrics = await store.metrics(0);
  const search = harness(SEARCH_AT, 180, true);
  const partial = await collectDiscovery({ store, ...search, maxRequests: 1 });
  assert.equal(partial.status, "partial");
  assert.equal(partial.requests, 1);
  assert.deepEqual(search.metadataTimes, []);
  assert.deepEqual(
    await store.metrics(0),
    existingMetrics,
    "provisional search cannot create a daily metric or replace another scan's genuine sample",
  );

  const resume = harness(RESUME_AT, 180, false);
  const result = await collectDiscovery({ store, ...resume });
  assert.equal(result.status, "published");
  assert.ok(result.requests + partial.requests <= 500);
  const card = (await store.snapshot())!.cards.find((row) => row.id === String(ID))!;
  assert.ok(card);
  assert.equal(card.stars, 180);
  assert.ok(resume.metadataTimes.includes(card.observedAt));
  const history = (await store.metrics(0)).filter((row) => row.repoId === String(ID));
  assert.deepEqual(history, [
    { repoId: String(ID), observedAt: previousAt, stars: 170, forks: 17 },
    { repoId: String(ID), observedAt: card.observedAt, stars: 180, forks: 18 },
  ]);
  assert.ok(
    (await store.metrics(0)).some(
      (row) => row.repoId === "77" && row.observedAt === unrelated.observedAt && row.stars === 900,
    ),
    "other scans' authentic measurements remain intact",
  );

  // A false sample at 23:50 would be the closest 7-day baseline. The real sample
  // shortly after midnight must instead produce +20, zero, or -20, never growth from50.
  const next = harness(SEARCH_AT + 7 * DAY, nextStars, false);
  const nextResult = await collectDiscovery({ store, ...next });
  assert.equal(nextResult.status, "published");
  assert.ok(nextResult.requests <= 500);
  const nextCard = (await store.snapshot())!.cards.find((row) => row.id === String(ID))!;
  assert.ok(nextCard);
  assert.equal(nextCard.stars, nextStars);
  assert.deepEqual(nextCard.growth, { stars: nextStars - 180, days: 7 });
  assert.equal(nextCard.badges.includes("growing"), nextStars > 180);
  assert.equal((await store.metrics(0)).filter((row) => row.repoId === String(ID)).length, 3);
}

async function priorProvisional(store: DiscoveryStore, source: "search" | undefined) {
  const lease = await store.acquire(RESUME_AT, DAY);
  assert.ok(lease);
  const old = { ...measured(ID, SEARCH_AT, 50, randomUUID()), countsSource: source };
  const checkpoint = {
    version: 7,
    scanId: lease.runId,
    startedAt: RESUME_AT,
    index: 0,
    phase: "identity",
    tasks: [
      {
        kind: "repo",
        id: String(ID),
        owner: "fixture",
        repo: `engine-${ID}`,
        preserveCounts: true,
      },
    ],
    ids: [],
    identityIds: [],
    admissions: {},
  };
  await store.save(lease, RESUME_AT, DAY, [old], checkpoint);
  await store.release(lease, RESUME_AT, "fixture resumed in identity phase");
  const current = harness(RESUME_AT, 180, false);
  const result = await collectDiscovery({ store, ...current });
  assert.equal(result.status, "published");
  const card = (await store.snapshot())!.cards.find((row) => row.id === String(ID))!;
  assert.equal(
    card.stars,
    180,
    "prior-scan provisional or unmarked counts must yield to stable-ID measurement",
  );
  assert.ok(current.metadataTimes.includes(card.observedAt));
  assert.deepEqual(await store.metrics(0), [
    { repoId: String(ID), observedAt: card.observedAt, stars: 180, forks: 18 },
  ]);
}

for (const stars of [200, 180, 160]) {
  const name = `cross-midnight search50 cannot become next week's baseline for ${stars} stars`;
  test(name, async () => midnight(createMemoryDiscovery(), stars));
  postgresTest(`postgres: ${name}`, async (pool) => midnight(createPostgresDiscovery(pool), stars));
}
test("midnight search cannot overwrite another scan's same-day repository sample", async () =>
  midnight(createMemoryDiscovery(), 200, true));
postgresTest(
  "postgres: midnight preserves another scan's same-day repository sample",
  async (pool) => midnight(createPostgresDiscovery(pool), 200, true),
);
for (const source of ["search", undefined] as const) {
  const name = `prior-scan ${source ?? "unmarked"} counts require a stable-ID sample`;
  test(name, async () => priorProvisional(createMemoryDiscovery(), source));
  postgresTest(`postgres: ${name}`, async (pool) =>
    priorProvisional(createPostgresDiscovery(pool), source),
  );
}

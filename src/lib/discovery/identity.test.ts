import assert from "node:assert/strict";
import { test } from "node:test";
import { postgresTest } from "../db/testing.ts";
import { collectDiscovery, parseRepository } from "./collector.ts";
import { buildSnapshot, DAY } from "./ranking.ts";
import { filterDiscovery, fateProjects } from "./presentation.ts";
import { createMemoryDiscovery, createPostgresDiscovery } from "./store.ts";
import type { DiscoveryStore } from "./types.ts";
const NOW = Date.UTC(2026, 9, 24, 12);
function raw(id: number, owner = "games", name = "shared") {
  return {
    id,
    owner: { login: owner },
    name,
    description: "Game engine",
    language: "Rust",
    topics: ["game-engine"],
    stargazers_count: id === 9000 ? 200 : 5,
    forks_count: 1,
    created_at: new Date(NOW - (id === 9000 ? 100 : 1) * DAY).toISOString(),
    pushed_at: new Date(NOW - DAY).toISOString(),
    archived: false,
    fork: false,
    size: 100,
  };
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

test("ranking and fate preserve different IDs even when cached slugs collide", () => {
  const old = {
    ...parseRepository(raw(9000), NOW, "fixture")!,
    firstSeenAt: NOW - 10 * DAY,
    mergedPrs: 1,
    activityCheckedAt: NOW,
  };
  const replacement = {
    ...parseRepository(raw(9001), NOW, "fixture")!,
    firstSeenAt: NOW,
    tags: ["steamos" as const],
  };
  const snapshot = buildSnapshot(
    [old, replacement, old],
    [{ repoId: old.id, observedAt: NOW - 7 * DAY, stars: 10, forks: 1 }],
    NOW,
  );
  assert.equal(snapshot.cards.length, 2);
  assert.deepEqual(
    filterDiscovery(snapshot.cards, { cat: "games", tag: "steamos" }).map((r) => r.id),
    ["9001"],
  );
  const shelf = {
    live: false,
    ecosystem: [],
    direction: [],
    libraries: [],
    discovery: { status: "ready" as const, stale: false, updatedAt: NOW, cards: snapshot.cards },
  };
  assert.equal(fateProjects(shelf, { cat: "games" }).length, 2);
});

async function renameReuse(store: DiscoveryStore, conflict = false) {
  const old = parseRepository(raw(9000), NOW - 7 * DAY, "fixture")!;
  const lease = await store.acquire(NOW - 7 * DAY, 8 * DAY);
  assert.ok(lease);
  await store.save(lease, NOW - 7 * DAY, 8 * DAY, [{ ...old, stars: 10 }], null);
  await store.save(
    lease,
    NOW - 1000,
    8 * DAY,
    [
      ...Array.from({ length: 180 }, (_, i) => ({
        ...old,
        id: String(1000 + i),
        repo: `old-${i}`,
        observedAt: NOW - DAY,
        countsObservedAt: NOW - DAY,
        disabled: true,
      })),
      { ...old, observedAt: NOW - 1000, countsObservedAt: NOW - 1000 },
    ],
    null,
  );
  const previous = { version: 1 as const, generatedAt: NOW - 1000, cards: [] };
  await store.publish(lease, NOW - 1000, previous);
  let time = NOW;
  let unavailable = true;
  const urls: string[] = [];
  const options = {
    store,
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    fetchImpl: (async (input) => {
      const u = new URL(String(input));
      urls.push(u.pathname);
      if (u.pathname === "/search/repositories")
        return json({
          items: [{ ...raw(9001), description: "SteamOS tools", topics: ["steamos"] }],
          total_count: 1,
          incomplete_results: false,
        });
      if (u.pathname.endsWith("/releases/latest")) return json({}, 404);
      if (u.pathname.endsWith("/pulls"))
        return json([
          { merged_at: new Date(NOW - DAY).toISOString(), user: { login: "human", type: "User" } },
        ]);
      if (u.pathname === "/repositories/9000")
        return json(conflict && unavailable ? raw(9000) : raw(9000, "transferred", "renamed"));
      if (u.pathname === "/repositories/9001")
        return unavailable && !conflict
          ? json({}, 503)
          : json({ ...raw(9001), description: "SteamOS tools", topics: ["steamos"] });
      return json({}, 404);
    }) as typeof fetch,
  };
  assert.equal((await collectDiscovery(options)).status, "paused");
  assert.deepEqual(await store.snapshot(), previous);
  unavailable = false;
  time += 60_001;
  assert.equal((await collectDiscovery(options)).status, "published");
  const snapshot = (await store.snapshot())!;
  const original = snapshot.cards.find((r) => r.id === "9000")!;
  const replacement = snapshot.cards.find((r) => r.id === "9001")!;
  assert.equal(snapshot.cards.length, 2);
  assert.equal(original.url, "https://github.com/transferred/renamed");
  assert.equal(original.firstSeenAt, NOW - 7 * DAY);
  assert.equal(original.growth?.stars, 190);
  assert.equal(replacement.url, "https://github.com/games/shared");
  assert.equal(replacement.growth, null);
  assert.equal(urls.filter((p) => p === "/repositories/9000").length, conflict ? 2 : 1);
  const shelf = {
    live: false,
    ecosystem: [],
    direction: [],
    libraries: [],
    discovery: {
      status: "ready" as const,
      stale: false,
      updatedAt: snapshot.generatedAt,
      cards: snapshot.cards,
    },
  };
  assert.deepEqual(
    filterDiscovery(snapshot.cards, { cat: "games", tag: "steamos" }).map((r) => r.id),
    ["9001"],
  );
  assert.equal(fateProjects(shelf, { cat: "games" }).length, 2);
  assert.equal(fateProjects(shelf, { cat: "games", tag: "steamos" })[0].url, replacement.url);
}
test("rename/reuse refreshes final card identities, checkpoints and filters", async () =>
  renameReuse(createMemoryDiscovery()));
postgresTest(
  "postgres: rename/reuse refreshes final card identities, checkpoints and filters",
  async (pool) => renameReuse(createPostgresDiscovery(pool)),
);

test("conflicting canonical URLs retain the prior snapshot and retry verification", async () =>
  renameReuse(createMemoryDiscovery(), true));
postgresTest(
  "postgres: conflicting canonical URLs retry without publishing stale identity",
  async (pool) => renameReuse(createPostgresDiscovery(pool), true),
);

import assert from "node:assert/strict";
import { test } from "node:test";
import { postgresTest } from "../db/testing.ts";
import { collectDiscovery, parseRepository } from "./collector.ts";
import { DAY } from "./ranking.ts";
import { createMemoryDiscovery, createPostgresDiscovery } from "./store.ts";
import type { DiscoveryStore, Observation } from "./types.ts";
const NOW = Date.UTC(2026, 9, 24, 12);
function raw(id: number) {
  return {
    id,
    private: false,
    visibility: "public",
    owner: { login: "fixture" },
    name: `engine-${id}`,
    description: "Public game engine",
    topics: ["game-engine"],
    language: "Rust",
    stargazers_count: 150,
    forks_count: 1,
    created_at: new Date(NOW - (id < 200 ? 20 : 100) * DAY).toISOString(),
    pushed_at: new Date(NOW - DAY).toISOString(),
    archived: false,
    fork: false,
    size: 1,
  };
}
async function publication(store: DiscoveryStore) {
  const stale = Array.from({ length: 100 }, (_, i) => i + 1),
    fresh = Array.from({ length: 30 }, (_, i) => i + 200);
  const lease = await store.acquire(NOW, DAY);
  assert.ok(lease);
  const current = (id: number): Observation => ({
    ...parseRepository(raw(id), id < 200 ? NOW - 3 * DAY : NOW, "fixture")!,
    activityCheckedAt: id < 200 ? NOW - 3 * DAY : NOW,
    releaseAt: NOW - 4 * DAY,
  });
  const checkpoints = {
    version: 6,
    startedAt: NOW,
    index: 0,
    phase: "activity",
    tasks: [],
    ids: [],
    admissions: {},
    identityIds: fresh.map(String),
  };
  await store.save(
    lease,
    NOW,
    DAY,
    [...stale, ...fresh].map((id) => ({
      ...current(id),
      stars: 100,
      observedAt: id < 200 ? NOW - 9.5 * DAY : NOW - 7 * DAY,
      countsObservedAt: id < 200 ? NOW - 9.5 * DAY : NOW - 7 * DAY,
    })),
    checkpoints,
  );
  await store.save(lease, NOW, DAY, [...stale, ...fresh].map(current), checkpoints);
  await store.release(lease, NOW, "fixture paused after activity");
  let time = NOW;
  const requests: string[] = [];
  const result = await collectDiscovery({
    store,
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    fetchImpl: (async (input) => {
      const p = new URL(String(input)).pathname;
      requests.push(p);
      const id = Number(p.match(/^\/repositories\/(\d+)$/)?.[1]);
      return Response.json(raw(id));
    }) as typeof fetch,
  });
  assert.equal(result.status, "published");
  assert.equal(requests.length, 30);
  const snapshot = (await store.snapshot())!;
  assert.equal(snapshot.cards.length, 30);
  assert.ok(
    snapshot.cards.every(
      (c) => Number(c.id) >= 200 && c.badges.includes("growing") && c.isPublic === true,
    ),
  );
}
test("fresh measured growth survives publication after stale growth expires", async () =>
  publication(createMemoryDiscovery()));
postgresTest("postgres: fresh growth survives stale-score publication pressure", async (pool) =>
  publication(createPostgresDiscovery(pool)),
);

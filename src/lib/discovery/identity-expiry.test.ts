import assert from "node:assert/strict";
import { test } from "node:test";
import { postgresTest } from "../db/testing.ts";
import { collectDiscovery, parseRepository } from "./collector.ts";
import { buildSnapshot, DAY } from "./ranking.ts";
import { createMemoryDiscovery, createPostgresDiscovery } from "./store.ts";
import type { DiscoveryStore } from "./types.ts";

const NOW = Date.UTC(2026, 9, 24, 12);
function raw(id: number) {
  return {
    id,
    private: false,
    owner: { login: "fixture" },
    name: `engine-${id}`,
    description: "Game engine",
    topics: ["game-engine"],
    language: "Rust",
    stargazers_count: 150,
    forks_count: 1,
    created_at: new Date(NOW - (id < 200 ? 20 : 100) * DAY).toISOString(),
    pushed_at: new Date(NOW - 4 * DAY).toISOString(),
    archived: false,
    fork: false,
    size: 1,
  };
}
async function expiry(store: DiscoveryStore) {
  const expiring = Array.from({ length: 100 }, (_, i) => i + 1);
  const fresh = Array.from({ length: 30 }, (_, i) => i + 200);
  const lease = await store.acquire(NOW, DAY);
  assert.ok(lease);
  const checkpoint = {
    version: 6,
    startedAt: NOW,
    phase: "activity",
    index: 0,
    tasks: [],
    ids: [],
    admissions: {},
    identityIds: [],
  };
  const observed = (id: number, at: number, stars: number) => ({
    ...parseRepository(raw(id), at, "fixture")!,
    stars,
    releaseAt: NOW - 4 * DAY,
    activityCheckedAt: NOW - 2 * DAY,
  });
  await store.save(
    lease,
    NOW,
    DAY,
    [
      ...expiring.map((id) => observed(id, NOW - 9.5 * DAY, 100)),
      ...fresh.map((id) => observed(id, NOW - 10.5 * DAY, 100)),
    ],
    checkpoint,
  );
  await store.save(
    lease,
    NOW,
    DAY,
    expiring.map((id) => observed(id, NOW - 6 * DAY, 150)),
    checkpoint,
  );
  await store.save(
    lease,
    NOW,
    DAY,
    [
      ...expiring.map((id) => observed(id, NOW - 1.99 * DAY, 150)),
      ...fresh.map((id) => observed(id, NOW - 1.5 * DAY, 150)),
    ],
    checkpoint,
  );
  await store.release(lease, NOW, "fixture after activity");
  assert.ok(
    buildSnapshot(await store.repositories(), await store.metrics(0), NOW).cards.every(
      (c) => Number(c.id) < 200 && c.badges.includes("growing"),
    ),
  );
  let time = NOW;
  const requests: string[] = [];
  const options = {
    store,
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    fetchImpl: (async (input) => {
      const path = new URL(String(input)).pathname;
      const id = Number(path.match(/^\/repositories\/(\d+)$/)?.[1]);
      assert.ok(id > 0, path);
      requests.push(path);
      return Response.json(raw(id));
    }) as typeof fetch,
  };
  assert.equal((await collectDiscovery({ ...options, maxRequests: 0 })).status, "partial");
  // The saved identity plan is valid, but its first 100 measurements expire while paused.
  time += 0.02 * DAY;
  for (let i = 0; i < 8; i++) {
    const result = await collectDiscovery({ ...options, maxRequests: 25 });
    assert.ok(result.requests <= 25);
    if (result.status === "published") break;
    assert.equal(result.status, "partial");
    assert.equal(await store.snapshot(), null, "partial revalidation must not publish");
  }
  const snapshot = await store.snapshot();
  assert.ok(snapshot);
  const grown = snapshot.cards.filter((c) => c.badges.includes("growing"));
  assert.equal(grown.length, 30);
  assert.ok(grown.every((c) => Number(c.id) >= 200 && c.observedAt === NOW - 1.5 * DAY));
  assert.ok(grown.every((c) => c.growth?.stars === 50 && c.growth.days === 9));
  assert.equal(
    requests.length,
    130,
    "new winners need identity verification after expiry changes rank",
  );
  const metrics = await store.metrics(0);
  for (const id of fresh) {
    assert.ok(requests.includes(`/repositories/${id}`));
    assert.equal(
      Math.max(...metrics.filter((m) => m.repoId === String(id)).map((m) => m.observedAt)),
      NOW - 1.5 * DAY,
    );
  }
  for (const id of expiring) {
    assert.ok(metrics.some((m) => m.repoId === String(id) && m.observedAt > NOW));
  }
}
test("expired identity plans remeasure and verify new winners across bounded resumes", async () =>
  expiry(createMemoryDiscovery()));
postgresTest(
  "postgres: expiry replans preserve fresh nine-day baselines and actual measurements",
  async (pool) => expiry(createPostgresDiscovery(pool)),
);

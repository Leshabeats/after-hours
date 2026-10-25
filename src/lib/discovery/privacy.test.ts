import assert from "node:assert/strict";
import { test } from "node:test";
import { postgresTest } from "../db/testing.ts";
import { collectDiscovery, parseRepository } from "./collector.ts";
import { buildSnapshot, eligible } from "./ranking.ts";
import { readDiscovery } from "./read.ts";
import { createMemoryDiscovery, createPostgresDiscovery } from "./store.ts";
import type { DiscoveryStore } from "./types.ts";
const NOW = Date.UTC(2026, 9, 24, 12);
const SECRET = "PRIVATE_FIXTURE_DO_NOT_PUBLISH";
function raw(patch: Record<string, unknown> = {}) {
  return {
    id: 1,
    private: false,
    visibility: "public",
    owner: { login: "public-owner" },
    name: "public-engine",
    description: "Public engine",
    topics: ["game-engine"],
    language: "Rust",
    stargazers_count: 20,
    forks_count: 1,
    created_at: new Date(NOW - 100 * 86400000).toISOString(),
    pushed_at: new Date(NOW - 1000).toISOString(),
    archived: false,
    fork: false,
    size: 1,
    ...patch,
  };
}
const json = (body: unknown, status = 200) => Response.json(body, { status });
test("metadata must explicitly confirm public visibility", () => {
  for (const patch of [
    { private: true },
    { private: undefined },
    { private: "false" },
    { visibility: "private" },
    { visibility: "internal" },
  ])
    assert.equal(parseRepository(raw(patch), NOW, "fixture"), null);
  assert.ok(parseRepository(raw(), NOW, "fixture"));
  const valid = { ...parseRepository(raw(), NOW, "fixture")!, isPublic: true, firstSeenAt: NOW };
  for (const isPublic of [false, undefined]) {
    assert.equal(eligible({ ...valid, isPublic }), false);
    assert.deepEqual(buildSnapshot([{ ...valid, isPublic }], [], NOW).cards, []);
  }
});
async function ingestion(store: DiscoveryStore) {
  let time = NOW;
  const queries: string[] = [];
  const result = await collectDiscovery({
    store,
    token: "fixture-only-token",
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    fetchImpl: (async (input) => {
      const u = new URL(String(input));
      if (u.pathname === "/search/repositories") {
        queries.push(u.searchParams.get("q")!);
        return json({
          items: [
            raw(),
            raw({ id: 99, private: true, name: SECRET, description: SECRET }),
            raw({ id: 98, private: undefined, name: SECRET }),
            raw({ id: 97, visibility: "internal", name: SECRET }),
          ],
          total_count: 4,
          incomplete_results: false,
        });
      }
      if (u.pathname === "/repositories/1") return json(raw());
      if (u.pathname.endsWith("/pulls")) return json([]);
      return json({}, 404);
    }) as typeof fetch,
  });
  assert.equal(result.status, "published");
  assert.equal((await store.repositories()).length, 1);
  assert.ok(queries.every((q) => q.includes("is:public")));
  assert.equal((await store.snapshot())!.cards.length, 1);
  assert.equal(
    JSON.stringify([
      await store.repositories(),
      await store.metrics(0),
      await store.snapshot(),
    ]).includes(SECRET),
    false,
  );
}
test("ingestion drops private and unconfirmed payloads without storing metadata", async () =>
  ingestion(createMemoryDiscovery()));
postgresTest("postgres: public-only ingestion", async (pool) =>
  ingestion(createPostgresDiscovery(pool)),
);
async function transition(store: DiscoveryStore) {
  const old = {
    ...parseRepository(raw(), NOW - 1000, "fixture")!,
    countsSource: "repository" as const,
    isPublic: true,
    firstSeenAt: NOW - 1000,
  };
  const lease = await store.acquire(NOW - 1000, 1000);
  assert.ok(lease);
  await store.save(lease, NOW - 1000, 1000, [old], null);
  await store.publish(lease, NOW - 1000, buildSnapshot([old], [], NOW - 1000));
  assert.equal((await store.snapshot())!.cards.length, 1);
  let time = NOW;
  const result = await collectDiscovery({
    store,
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    fetchImpl: (async (input) => {
      const p = new URL(String(input)).pathname;
      if (p === "/search/repositories")
        return json({ items: [], total_count: 0, incomplete_results: false });
      if (p === "/repositories/1")
        return json(
          raw({ private: true, description: SECRET, name: SECRET, stargazers_count: 999 }),
        );
      return json({}, 503);
    }) as typeof fetch,
  });
  assert.equal(result.status, "paused");
  const saved = (await store.repositories())[0];
  assert.equal(saved.description, "Public engine");
  assert.equal(saved.countsObservedAt, NOW - 1000);
  assert.equal((await store.metrics(0)).length, 1);
  assert.deepEqual((await store.snapshot())!.cards, []);
  assert.equal(
    JSON.stringify([await store.repositories(), await store.snapshot()]).includes(SECRET),
    false,
  );
}
test("private refresh hides a prior published card even if the run later pauses", async () =>
  transition(createMemoryDiscovery()));
postgresTest("postgres: private refresh revokes public snapshot visibility", async (pool) =>
  transition(createPostgresDiscovery(pool)),
);
test("reader rejects legacy or nonpublic cards without a public marker", async () => {
  const known = { ...parseRepository(raw(), NOW, "fixture")!, isPublic: true, firstSeenAt: NOW };
  const card = buildSnapshot([known], [], NOW).cards[0];
  const result = await readDiscovery(
    async () => ({
      version: 1,
      generatedAt: NOW,
      cards: [
        { ...card, isPublic: undefined },
        { ...card, isPublic: false },
      ],
    }),
    NOW,
  );
  assert.equal(result.status, "empty");
  assert.deepEqual(result.cards, []);
});

async function publicationBoundary(store: DiscoveryStore) {
  const valid = { ...parseRepository(raw(), NOW, "fixture")!, isPublic: true, firstSeenAt: NOW };
  const lease = await store.acquire(NOW, 1000);
  assert.ok(lease);
  await store.save(
    lease,
    NOW,
    1000,
    [valid, { ...valid, id: "99", isPublic: false, description: SECRET, repo: SECRET }],
    null,
  );
  const card = buildSnapshot([valid], [], NOW).cards[0];
  await store.publish(lease, NOW, {
    version: 1,
    generatedAt: NOW,
    cards: [
      card,
      { ...card, id: "99", description: SECRET },
      { ...card, id: "98", isPublic: false, description: SECRET },
      { ...card, id: "97", isPublic: undefined, description: SECRET },
    ],
  });
  assert.deepEqual(
    (await store.snapshot())!.cards.map((c) => c.id),
    ["1"],
  );
  assert.equal(
    JSON.stringify([await store.repositories(), await store.snapshot()]).includes(SECRET),
    false,
  );
}
test("publication and storage independently reject nonpublic metadata", async () =>
  publicationBoundary(createMemoryDiscovery()));
postgresTest("postgres: publication and storage reject nonpublic metadata", async (pool) =>
  publicationBoundary(createPostgresDiscovery(pool)),
);

import assert from "node:assert/strict";
import { test } from "node:test";
import { postgresTest } from "../db/testing.ts";
import { collectDiscovery, parseRepository } from "./collector.ts";
import { DAY } from "./ranking.ts";
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
    language: "Rust",
    topics: ["game-engine"],
    stargazers_count: 5,
    forks_count: 1,
    created_at: new Date(NOW - DAY).toISOString(),
    pushed_at: new Date(NOW - DAY).toISOString(),
    archived: false,
    fork: false,
    size: 1,
  };
}
async function replacement(store: DiscoveryStore, privateReplacement: boolean, lateSearch = false) {
  if (lateSearch) {
    const lease = await store.acquire(NOW, DAY);
    assert.ok(lease);
    await store.save(lease, NOW, DAY, [parseRepository(raw(10100), NOW - DAY, "fixture")!], null);
    await store.publish(lease, NOW, { version: 1, generatedAt: NOW, cards: [] });
  }
  let time = NOW,
    search = 0;
  const confirmed = new Set<string>();
  const confirmations: string[] = [];
  const result = await collectDiscovery({
    store,
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    fetchImpl: (async (input) => {
      const url = new URL(String(input));
      const path = url.pathname;
      if (path === "/search/repositories") {
        if (lateSearch && url.searchParams.get("page") === "2")
          return Response.json({ items: [raw(10100)], total_count: 31, incomplete_results: false });
        const first = search++ * 15;
        const items = Array.from({ length: Math.max(0, Math.min(15, 101 - first)) }, (_, i) =>
          raw(10000 + first + i),
        );
        return Response.json({
          items,
          total_count: lateSearch && first === 0 ? 31 : items.length,
          incomplete_results: false,
        });
      }
      if (path.endsWith("/pulls")) return Response.json([]);
      if (path.endsWith("/releases/latest") || path.startsWith("/repos/"))
        return Response.json({}, { status: 404 });
      const id = path.match(/^\/repositories\/(\d+)$/)?.[1];
      assert.ok(id, path);
      confirmed.add(id);
      confirmations.push(id);
      if (id === "10000" || (id === "10100" && privateReplacement))
        return Response.json({ ...raw(Number(id)), private: true, description: "PRIVATE FIXTURE" });
      if (id === "10100")
        return Response.json({ ...raw(10100), owner: { login: "transferred" }, name: "renamed" });
      return Response.json(raw(Number(id)));
    }) as typeof fetch,
  });
  assert.equal(result.status, "published");
  assert.ok(result.requests <= 500);
  const snapshot = (await store.snapshot())!;
  assert.ok(
    confirmed.has("10100"),
    "search cannot confirm a replacement winner's current identity",
  );
  if (lateSearch)
    assert.equal(
      confirmations.filter((id) => id === "10100").length,
      2,
      "later search metadata must invalidate an earlier stable-ID receipt",
    );
  assert.ok(snapshot.cards.every((card) => confirmed.has(card.id)));
  assert.equal(snapshot.cards.length, privateReplacement ? 99 : 100);
  assert.ok(!snapshot.cards.some((card) => card.id === "10000"));
  const card = snapshot.cards.find((c) => c.id === "10100");
  if (privateReplacement) assert.equal(card, undefined);
  else assert.equal(card?.url, "https://github.com/transferred/renamed");
  assert.ok(!JSON.stringify([snapshot, await store.repositories()]).includes("PRIVATE FIXTURE"));
}
for (const privateReplacement of [false, true]) {
  test(`replacement winner requires stable-ID confirmation (private=${privateReplacement})`, async () =>
    replacement(createMemoryDiscovery(), privateReplacement));
  postgresTest(
    `postgres: replacement winner identity/privacy (private=${privateReplacement})`,
    async (pool) => replacement(createPostgresDiscovery(pool), privateReplacement),
  );
}

test("later search pages cannot reuse an earlier identity confirmation", async () =>
  replacement(createMemoryDiscovery(), false, true));
postgresTest("postgres: search overwrite invalidates a stable-ID receipt", async (pool) =>
  replacement(createPostgresDiscovery(pool), false, true),
);

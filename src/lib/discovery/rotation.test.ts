import assert from "node:assert/strict";
import { test } from "node:test";
import { postgresTest } from "../db/testing.ts";
import { collectDiscovery, parseRepository } from "./collector.ts";
import { buildSnapshot, DAY } from "./ranking.ts";
import { filterDiscovery } from "./presentation.ts";
import { createMemoryDiscovery, createPostgresDiscovery } from "./store.ts";
import type { DiscoveryStore, Observation } from "./types.ts";
const START = Date.UTC(2026, 9, 24, 12);
function raw(id: number, at: number, stars = 100) {
  const topic = id === 6100 ? "steamos" : id === 6200 ? "proton" : "game-engine";
  return {
    id,
    name: `repo-${id}`,
    owner: { login: "fixture" },
    description: topic === "proton" ? "Proton Linux compatibility" : "Game engine",
    topics: [topic],
    language: "Rust",
    private: false,
    stargazers_count: stars,
    forks_count: 1,
    created_at: new Date(
      id >= 10000 ? START + Math.floor((id - 10000) / 100) * DAY : START - 100 * DAY,
    ).toISOString(),
    pushed_at: new Date(at).toISOString(),
    archived: false,
    disabled: id >= 7000 && id < 10000,
    fork: false,
    size: 100,
  };
}
function observation(id: number, at: number, stars = 100): Observation {
  return { ...parseRepository(raw(id, at, stars), at, "fixture")!, countsSource: "repository" };
}
async function seed(store: DiscoveryStore, batches: Observation[][]) {
  const lease = await store.acquire(START, DAY);
  assert.ok(lease);
  for (const rows of batches) await store.save(lease, START, DAY, rows, null);
  await store.publish(lease, START, { version: 1, generatedAt: START, cards: [] });
}
function dailyApi(day: number, extra?: (path: string) => Response | undefined) {
  let time = START + day * DAY;
  const requests: string[] = [],
    queries = new Map<string, number>();
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  return {
    requests,
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    advance: (ms: number) => {
      time += ms;
    },
    fetchImpl: (async (input) => {
      const u = new URL(String(input));
      requests.push(u.pathname);
      const intercepted = extra?.(u.pathname);
      if (intercepted) return intercepted;
      if (u.pathname === "/search/repositories") {
        const q = u.searchParams.get("q")!;
        if (!queries.has(q)) queries.set(q, queries.size);
        const group = queries.get(q)!;
        const items =
          group < 4
            ? Array.from({ length: 15 }, (_, i) => raw(10000 + day * 100 + group * 15 + i, time))
            : [];
        return json({ items, total_count: items.length, incomplete_results: false });
      }
      if (u.pathname.endsWith("/releases/latest")) return json({}, 404);
      if (u.pathname.endsWith("/pulls"))
        return json([
          { merged_at: new Date(time - DAY).toISOString(), user: { type: "User", login: "human" } },
        ]);
      const id = Number(u.pathname.match(/^\/repositories\/(\d+)$/)?.[1]);
      return id ? json(raw(id, time, 100 + day * 10)) : json({}, 404);
    }) as typeof fetch,
  };
}
async function enrichment(store: DiscoveryStore) {
  const ids = Array.from({ length: 120 }, (_, i) => i + 1);
  await seed(store, [
    ids.map((id) => observation(id, START - 6.5 * DAY, 10)),
    ids.map((id) => observation(id, START - DAY)),
  ]);
  for (let day = 0; day < 10; day++) {
    const h = dailyApi(day);
    const result = await collectDiscovery({ store, ...h });
    assert.equal(result.status, "published");
    assert.ok(result.requests <= 500);
    assert.equal(h.requests.filter((p) => p.endsWith("/pulls")).length, 40);
    const old = (await store.repositories()).filter((r) => Number(r.id) < 10000);
    if (day === 0) {
      assert.equal(old.filter((r) => r.activityCheckedAt !== null).length, 40);
      assert.ok(
        (await store.snapshot())!.cards.some(
          (r) => Number(r.id) < 10000 && r.badges.includes("growing"),
        ),
      );
    }
    if (day === 2) assert.equal(old.filter((r) => r.activityCheckedAt !== null).length, 120);
    if (day === 9)
      assert.ok(
        old.every((r) => r.activityCheckedAt !== null && h.now() - r.activityCheckedAt < 7 * DAY),
      );
    const published = (await store.snapshot())!;
    for (const card of published.cards.filter((r) => r.badges.includes("growing"))) {
      assert.ok(card.growth && card.growth.days >= 6 && card.growth.days <= 9);
    }
    assert.ok(
      published.cards
        .filter((r) => Number(r.id) >= 10000 + day * 100)
        .every((r) => !r.badges.includes("growing")),
    );
  }
}
test("ten daily influxes do not starve baseline-ready activity checks or renewals", async () =>
  enrichment(createMemoryDiscovery()));
postgresTest("postgres: baseline-ready activity rotation across ten daily influxes", async (pool) =>
  enrichment(createPostgresDiscovery(pool)),
);

async function quietCatalog(store: DiscoveryStore) {
  const initial = [
    ...Array.from({ length: 600 }, (_, i) => observation(i + 1, START - 10 * DAY)),
    observation(6100, START - 3 * DAY),
    observation(6200, START - 3 * DAY),
    ...Array.from({ length: 180 }, (_, i) => observation(7000 + i, START - 20 * DAY)),
  ];
  await seed(store, [initial]);
  const visited = new Set<number>();
  for (let day = 0; day < 6; day++) {
    let blocked = day === 0;
    const h = dailyApi(day, (path) => {
      if (path === "/repositories/6100" && blocked) return new Response("{}", { status: 503 });
      if (path === "/repositories/6200" && day >= 4)
        return Response.json({ ...raw(6200, START + day * DAY), archived: true });
    });
    const previous = await store.snapshot();
    let result = await collectDiscovery({ store, ...h });
    if (day === 0) {
      assert.equal(result.status, "paused");
      assert.deepEqual(await store.snapshot(), previous);
      const quiet = (await store.repositories()).find((r) => r.id === "6100")!;
      assert.equal(quiet.countsObservedAt, START - 3 * DAY);
      // Cached counts remain genuinely stale and cannot enter a published snapshot directly.
      assert.equal(buildSnapshot([quiet], [], h.now()).cards.length, 0);
      blocked = false;
      h.advance(60_001);
      result = await collectDiscovery({ store, ...h });
    }
    assert.equal(result.status, "published");
    assert.ok(result.requests <= 500);
    const snapshot = (await store.snapshot())!;
    assert.equal(
      filterDiscovery(snapshot.cards, { cat: "games", tag: "steamos" }).some(
        (r) => r.id === "6100",
      ),
      true,
    );
    assert.equal(
      snapshot.cards.some((r) => r.id === "6200"),
      day < 4,
    );
    const stored = new Map((await store.repositories()).map((r) => [r.id, r]));
    for (const card of snapshot.cards) {
      assert.ok(h.now() - card.observedAt <= 2 * DAY);
      assert.equal(card.observedAt, stored.get(card.id)!.countsObservedAt);
      assert.ok(stored.get(card.id)!.observedAt >= START + day * DAY);
      assert.ok(h.requests.includes(`/repositories/${card.id}`));
    }
    const metadata = h.requests.flatMap((p) => {
      const m = p.match(/^\/repositories\/(\d+)$/);
      return m ? [Number(m[1])] : [];
    });
    if (day === 0) assert.ok(metadata.slice(0, 162).every((id) => id < 7000));
    for (const id of metadata) if (id <= 600) visited.add(id);
    if (day === 3) assert.equal(visited.size, 600);
  }
}
test("growing quiet catalog preserves tags through real verification and fair refresh", async () =>
  quietCatalog(createMemoryDiscovery()));
postgresTest(
  "postgres: growing quiet catalog preserves tags without fabricated freshness",
  async (pool) => quietCatalog(createPostgresDiscovery(pool)),
);

async function retryExcluded(store: DiscoveryStore) {
  await seed(store, [
    [
      ...Array.from({ length: 600 }, (_, i) => observation(i + 1, START - 10 * DAY)),
      ...Array.from({ length: 40 }, (_, i) => observation(7000 + i, START - 20 * DAY)),
    ],
  ]);
  let recovered = false;
  for (let day = 0; day < 6; day++) {
    const h = dailyApi(day, (path) =>
      path === "/repositories/7000"
        ? day < 3
          ? new Response("{}", { status: 404 })
          : Response.json({
              ...raw(7000, START + day * DAY),
              disabled: false,
              topics: ["steamos"],
              description: "SteamOS tools",
            })
        : undefined,
    );
    const result = await collectDiscovery({ store, ...h });
    assert.equal(result.status, "published");
    const metadata = h.requests.filter((path) => /^\/repositories\/\d+$/.test(path));
    if (day === 0) {
      const firstQueue = metadata.slice(0, 180);
      assert.equal(firstQueue.filter((path) => Number(path.split("/").at(-1)) >= 7000).length, 18);
      assert.equal(firstQueue.length, 180);
    }
    const target = (await store.repositories()).find((r) => r.id === "7000")!;
    if (day < 3) {
      assert.equal(target.disabled, true);
      assert.equal(target.countsObservedAt, START - 20 * DAY);
    }
    if (!target.disabled) {
      recovered = true;
      assert.ok(target.countsObservedAt! >= START + 3 * DAY);
      assert.ok(
        (await store.snapshot())!.cards.some((r) => r.id === "7000" && r.tags.includes("steamos")),
      );
    }
  }
  assert.equal(recovered, true);
}
test("excluded retries recover a temporary 404 despite an always-full eligible queue", async () =>
  retryExcluded(createMemoryDiscovery()));
postgresTest(
  "postgres: bounded excluded retries recover 404 without synthetic history",
  async (pool) => retryExcluded(createPostgresDiscovery(pool)),
);

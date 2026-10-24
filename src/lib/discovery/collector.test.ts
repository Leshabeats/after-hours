import assert from "node:assert/strict";
import { test } from "node:test";
import { collectDiscovery, parseRepository } from "./collector.ts";
import { buildSnapshot, classifyRepository, DAY, eligible } from "./ranking.ts";
import { createMemoryDiscovery } from "./store.ts";
import type { DiscoverySnapshot, StoredRepository } from "./types.ts";

const NOW = Date.UTC(2026, 9, 24, 12);
function raw(patch: Record<string, unknown> = {}) {
  return {
    id: 10,
    name: "moon",
    owner: { login: "games" },
    description: "Game engine for Linux",
    language: "Rust",
    topics: ["game-engine"],
    stargazers_count: 100,
    forks_count: 3,
    created_at: new Date(NOW - 100 * DAY).toISOString(),
    pushed_at: new Date(NOW - DAY).toISOString(),
    archived: false,
    fork: false,
    disabled: false,
    size: 100,
    ...patch,
  };
}
function repo(patch: Partial<StoredRepository> = {}): StoredRepository {
  return {
    ...parseRepository(raw(), NOW, "fixture")!,
    firstSeenAt: NOW,
    ...patch,
    countsObservedAt: patch.countsObservedAt ?? patch.observedAt ?? NOW,
  };
}
const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers });
function harness(override?: (url: string) => Response | undefined) {
  let time = NOW;
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    urls.push(url);
    assert.equal(new URL(url).hostname, "api.github.com");
    assert.equal(init?.redirect, "manual");
    const custom = override?.(url);
    if (custom) return custom;
    if (url.includes("/search/repositories"))
      return json({ items: [raw()], total_count: 1, incomplete_results: false });
    if (url.endsWith("/releases/latest")) return json({ message: "Not Found" }, 404);
    if (url.includes("/pulls?"))
      return json([
        {
          merged_at: new Date(NOW - DAY).toISOString(),
          user: { login: "maintainer", type: "User" },
        },
      ]);
    return json({ message: "Not Found" }, 404);
  };
  return {
    fetchImpl,
    urls,
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    advance: (ms: number) => {
      time += ms;
    },
  };
}

test("taxonomy is multi-tag, excludes terminal emulators and unrelated Proton", () => {
  assert.deepEqual(
    classifyRepository({
      owner: "a",
      repo: "terminal",
      description: "GPU terminal emulator",
      topics: ["emulator"],
    }),
    [],
  );
  assert.deepEqual(
    classifyRepository({ owner: "a", repo: "proton", description: "Mail client", topics: [] }),
    [],
  );
  assert.deepEqual(
    classifyRepository({
      owner: "a",
      repo: "deck",
      description: "Nintendo game emulator for Steam Deck",
      topics: [],
    }),
    ["emulation", "linux-gaming", "steamos"],
  );
  assert.ok(
    classifyRepository({
      owner: "a",
      repo: "art",
      description: "Game sprites and textures",
      topics: ["game-assets"],
    }).includes("assets"),
  );
});

test("metadata validates stable IDs and treats archived/mirror/ordinary forks as excluded", () => {
  assert.equal(parseRepository(raw({ id: Number.MAX_SAFE_INTEGER + 1 }), NOW, "test"), null);
  assert.equal(parseRepository(raw({ created_at: "not-a-date" }), NOW, "test"), null);
  assert.equal(parseRepository(raw({ owner: { login: "a/../../secrets" } }), NOW, "test"), null);
  for (const patch of [
    { archived: true },
    { mirror_url: "https://example.org/mirror" },
    { fork: true },
    { size: 0 },
  ])
    assert.equal(eligible(parseRepository(raw(patch), NOW, "test")!), false);
  assert.equal(
    eligible(
      parseRepository(
        raw({ fork: true, owner: { login: "GloriousEggroll" }, name: "proton-ge-custom" }),
        NOW,
        "test",
      )!,
    ),
    true,
  );
});

test("first discovery is not creation, and stars alone cannot establish trustworthy growth", () => {
  const old = repo();
  const first = buildSnapshot([old], [], NOW).cards[0];
  assert.deepEqual(first.badges, ["discovered"]);
  assert.equal(first.growth, null);
  const history = [{ repoId: old.id, observedAt: NOW - 7 * DAY, stars: 10, forks: 1 }];
  assert.equal(buildSnapshot([old], history, NOW).cards[0].badges.includes("growing"), false);
  const active = { ...old, mergedPrs: 2, activityCheckedAt: NOW };
  assert.equal(buildSnapshot([active], history, NOW).cards[0].badges.includes("growing"), true);
  assert.equal(
    buildSnapshot([active], [{ ...history[0], observedAt: NOW - DAY }], NOW).cards[0].growth,
    null,
  );
  assert.equal(
    buildSnapshot(
      [{ ...active, activityCheckedAt: NOW - 8 * DAY }],
      history,
      NOW,
    ).cards[0].badges.includes("growing"),
    false,
  );
  const newlyCreated = buildSnapshot([repo({ createdAt: NOW - DAY })], [], NOW).cards[0];
  assert.ok(newlyCreated.badges.includes("new"));
});

test("budget checkpoint resumes without duplicate repos/metrics and publishes only on completion", async () => {
  const store = createMemoryDiscovery();
  const h = harness();
  const first = await collectDiscovery({ store, ...h, maxRequests: 1 });
  assert.equal(first.status, "partial");
  assert.equal(await store.snapshot(), null);
  assert.equal((await store.repositories()).length, 1);
  const second = await collectDiscovery({ store, ...h });
  assert.equal(second.status, "published");
  assert.equal((await store.repositories()).length, 1);
  assert.equal((await store.metrics(0)).length, 1);
  assert.equal(h.urls.filter((url) => url.includes("topic%3Agame-engine%20created")).length, 1);
  const snapshot = await store.snapshot();
  assert.equal(snapshot?.cards.length, 1);
  assert.deepEqual(snapshot?.cards[0].badges, ["discovered"]);
});

test("rate limit persists pause and leaves prior snapshot intact", async () => {
  const store = createMemoryDiscovery();
  const h = harness();
  await collectDiscovery({ store, ...h });
  const snapshot = await store.snapshot();
  const blocked = harness(() => json({ message: "rate limit" }, 429, { "retry-after": "120" }));
  blocked.advance(5 * 60_000);
  const result = await collectDiscovery({ store, ...blocked });
  assert.equal(result.status, "paused");
  assert.deepEqual(await store.snapshot(), snapshot);
  assert.equal((await collectDiscovery({ store, ...blocked })).status, "busy");
  assert.equal(blocked.urls.length, 1);
  blocked.advance(120_001);
  const recovery = harness();
  recovery.advance(8 * 60_000);
  assert.equal((await collectDiscovery({ store, ...recovery })).status, "published");
});

test("incomplete search and malformed response do not replace published results", async () => {
  const store = createMemoryDiscovery();
  const snapshot: DiscoverySnapshot = { version: 1, generatedAt: NOW - DAY, cards: [] };
  const lease = await store.acquire(NOW - DAY, 1000);
  assert.ok(lease);
  await store.publish(lease, NOW - DAY, snapshot);
  const h = harness(() => json({ items: [raw()], total_count: 2000, incomplete_results: true }));
  assert.equal((await collectDiscovery({ store, ...h })).status, "paused");
  assert.deepEqual(await store.snapshot(), snapshot);
  h.advance(16 * 60_000);
  await assert.rejects(
    collectDiscovery({
      store,
      now: h.now,
      sleep: h.sleep,
      fetchImpl: async () => json({ unexpected: true }),
    }),
    /Discovery scan failed/,
  );
  assert.deepEqual(await store.snapshot(), snapshot);
});

test("API outage saves no fabricated zero and retries the same task", async () => {
  const store = createMemoryDiscovery();
  const h = harness((url) => (url.includes("/pulls?") ? json({ error: true }, 503) : undefined));
  assert.equal((await collectDiscovery({ store, ...h })).status, "paused");
  assert.equal((await store.repositories())[0].mergedPrs, null);
  assert.equal(await store.snapshot(), null);
  const good = harness();
  good.advance(10 * 60_000);
  assert.equal((await collectDiscovery({ store, ...good })).status, "published");
  assert.equal(
    good.urls.some((url) => url.includes("/search/")),
    false,
  );
});

test("bounded activity counts human merged PRs only and doesn't invent historical stars", async () => {
  const store = createMemoryDiscovery();
  const h = harness((url) =>
    url.includes("/pulls?")
      ? json([
          {
            merged_at: new Date(NOW - DAY).toISOString(),
            user: { login: "deps[bot]", type: "Bot" },
          },
          { merged_at: null, user: { login: "human", type: "User" } },
        ])
      : undefined,
  );
  await collectDiscovery({ store, ...h });
  assert.equal((await store.repositories())[0].mergedPrs, 0);
  assert.equal((await store.snapshot())?.cards[0].growth, null);
});

test("known repository refresh uses stable identity when its old slug is reused", async () => {
  const store = createMemoryDiscovery();
  const lease = await store.acquire(NOW - DAY, 1000);
  assert.ok(lease);
  await store.save(lease, NOW - DAY, 1000, [repo({ observedAt: NOW - DAY })], null);
  await store.publish(lease, NOW - DAY, { version: 1, generatedAt: NOW - DAY, cards: [] });
  const h = harness((url) => {
    if (url.includes("/search/"))
      return json({ items: [], total_count: 0, incomplete_results: false });
    if (url.endsWith("/repos/games/moon"))
      return json(raw({ id: 999, description: "Replacement repository at reused slug" }));
    if (url.endsWith("/repositories/10")) return json(raw({ name: "renamed" }));
  });
  assert.equal((await collectDiscovery({ store, ...h })).status, "published");
  assert.equal((await store.repositories()).length, 1);
  assert.equal((await store.repositories())[0].repo, "renamed");
  assert.equal((await store.repositories())[0].firstSeenAt, NOW - DAY);
  assert.equal(h.urls.filter((url) => url.endsWith("/repositories/10")).length, 1);
  assert.equal(
    h.urls.some((url) => url.endsWith("/repos/games/moon")),
    false,
  );
});

test("repository redirects never forward credentials to another origin", async () => {
  const store = createMemoryDiscovery();
  const h = harness((url) =>
    url.includes("/repos/") && !url.includes("/search/")
      ? new Response(null, {
          status: 301,
          headers: { location: "https://attacker.invalid/repos/a/b" },
        })
      : undefined,
  );
  assert.equal((await collectDiscovery({ store, ...h, token: "fixture-secret" })).status, "paused");
  assert.equal(
    h.urls.some((url) => url.includes("attacker.invalid")),
    false,
  );
  assert.equal(await store.snapshot(), null);
});

test("terminal repository unavailability advances metadata and enrichment checkpoints", async () => {
  for (const status of [410, 451]) {
    for (const duringActivity of [false, true]) {
      const store = createMemoryDiscovery();
      const lease = await store.acquire(NOW - DAY, 1000);
      assert.ok(lease);
      await store.save(lease, NOW - DAY, 1000, [repo({ observedAt: NOW - DAY })], null);
      await store.publish(lease, NOW - DAY, { version: 1, generatedAt: NOW - DAY, cards: [] });
      const h = harness((url) => {
        if (url.includes("/search/"))
          return json({ items: [], total_count: 0, incomplete_results: false });
        if (url.endsWith("/repositories/10"))
          return duringActivity ? json(raw()) : json({}, status);
        if (url.endsWith("/releases/latest") && duringActivity) return json({}, status);
      });
      assert.equal((await collectDiscovery({ store, ...h })).status, "published");
      assert.equal((await store.repositories())[0].disabled, true);
      assert.equal((await store.snapshot())?.cards.length, 0);
    }
  }
});

test("unavailable counts never become an artificial weekly baseline on recovery", async () => {
  for (const status of [404, 410, 451]) {
    const store = createMemoryDiscovery();
    const initialAt = NOW - 14 * DAY;
    const lease = await store.acquire(initialAt, 1000);
    assert.ok(lease);
    await store.save(lease, initialAt, 1000, [repo({ observedAt: initialAt, stars: 10 })], null);
    await store.publish(lease, initialAt, { version: 1, generatedAt: initialAt, cards: [] });
    const absent = harness((url) => {
      if (url.includes("/search/"))
        return json({ items: [], total_count: 0, incomplete_results: false });
      if (url.endsWith("/repositories/10") || url.endsWith("/repos/games/moon"))
        return json({}, status);
    });
    absent.advance(-7 * DAY);
    assert.equal((await collectDiscovery({ store, ...absent })).status, "published");
    assert.equal((await store.metrics(0)).length, 1);
    const hidden = (await store.repositories())[0];
    assert.equal(hidden.disabled, true);
    assert.equal(hidden.countsObservedAt, initialAt);
    const back = harness((url) => {
      if (url.includes("/search/"))
        return json({ items: [], total_count: 0, incomplete_results: false });
      if (url.endsWith("/repositories/10")) return json(raw({ stargazers_count: 200 }));
    });
    assert.equal((await collectDiscovery({ store, ...back })).status, "published");
    const published = (await store.snapshot())!.cards[0];
    assert.equal(published.growth, null);
    assert.equal(published.badges.includes("growing"), false);
    assert.equal((await store.metrics(0)).length, 2);
  }
});

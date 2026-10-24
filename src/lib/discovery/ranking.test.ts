import assert from "node:assert/strict";
import { it } from "node:test";
import { postgresTest } from "../db/testing.ts";
import { buildSnapshot, DAY } from "./ranking.ts";
import { filterDiscovery, fateProjects } from "./presentation.ts";
import { readDiscovery } from "./read.ts";
import { createMemoryDiscovery, createPostgresDiscovery } from "./store.ts";
import {
  GAME_TAGS,
  type DiscoverySnapshot,
  type DiscoveryStore,
  type StoredRepository,
} from "./types.ts";

const NOW = Date.UTC(2026, 9, 24, 12);

function repository(id: string, patch: Partial<StoredRepository> = {}): StoredRepository {
  return {
    id,
    owner: "fixture",
    repo: id,
    description: "A game engine",
    language: "Rust",
    topics: ["game-engine"],
    stars: 100,
    forks: 2,
    createdAt: NOW - DAY,
    pushedAt: NOW - DAY,
    observedAt: NOW,
    countsMeasured: true,
    countsObservedAt: NOW,
    archived: false,
    fork: false,
    mirror: false,
    disabled: false,
    tags: ["engines"],
    source: "fixture",
    releaseAt: null,
    mergedPrs: null,
    isPublic: true,
    activityCheckedAt: null,
    firstSeenAt: NOW - DAY,
    ...patch,
  };
}

function crowdedEngines(): StoredRepository[] {
  const old = {
    createdAt: NOW - 730 * DAY,
    firstSeenAt: NOW - 365 * DAY,
    stars: 20_000,
    releaseAt: NOW - DAY,
    activityCheckedAt: NOW,
  };
  return [
    ...Array.from({ length: 100 }, (_, i) => repository(`engine-${String(i).padStart(3, "0")}`)),
    repository("steamos", {
      ...old,
      description: "SteamOS tools",
      tags: ["steamos", "linux-gaming"],
    }),
    repository("proton", {
      ...old,
      description: "Proton compatibility",
      tags: ["proton", "linux-gaming"],
    }),
  ];
}

async function assertDiscoverable(snapshot: DiscoverySnapshot) {
  assert.equal(snapshot.cards.length, 100);
  assert.equal(new Set(snapshot.cards.map((card) => card.id)).size, 100);
  const discovery = await readDiscovery(async () => snapshot, NOW);
  const shelf = { ecosystem: [], direction: [], libraries: [], live: false, discovery };
  for (const tag of ["steamos", "proton"] as const) {
    const search = { cat: "games", tag } as const;
    assert.deepEqual(
      filterDiscovery(discovery.cards, search).map((card) => card.repo),
      [tag],
    );
    assert.deepEqual(
      fateProjects(shelf, search).map((card) => card.repo),
      [tag],
    );
  }
}

it("100 new engines cannot hide eligible SteamOS and Proton projects from filters or fate", async () => {
  const snapshot = buildSnapshot(crowdedEngines(), [], NOW);
  await assertDiscoverable(snapshot);
  assert.deepEqual(
    snapshot.cards.slice(-2).map((card) => card.id),
    ["proton", "steamos"],
  );
  assert.equal(snapshot.cards.filter((card) => card.tags.includes("engines")).length, 98);
});

it("a full snapshot gives each populated tag room, deduplicates overlaps and keeps global ranking", () => {
  const candidates = GAME_TAGS.flatMap(({ id: tag }, tagIndex) =>
    Array.from({ length: 25 }, (_, i) =>
      repository(`${tag}-${i}`, {
        tags: [tag],
        stars: (GAME_TAGS.length - tagIndex) * 100 + i,
      }),
    ),
  );
  const shared = repository("shared", { tags: GAME_TAGS.map((tag) => tag.id), stars: 5000 });
  candidates.push(shared, { ...shared });
  const snapshot = buildSnapshot(candidates, [], NOW);
  assert.equal(snapshot.cards.length, 100);
  assert.equal(new Set(snapshot.cards.map((card) => card.id)).size, 100);
  assert.equal(
    new Set(snapshot.cards.map((card) => `${card.owner}/${card.repo}`.toLowerCase())).size,
    100,
  );
  assert.equal(snapshot.cards[0].id, "shared");
  for (const { id } of GAME_TAGS) {
    assert.ok(snapshot.cards.filter((card) => card.tags.includes(id)).length >= 14, id);
  }
  assert.deepEqual(
    snapshot.cards.map((card) => card.stars),
    snapshot.cards.map((card) => card.stars).sort((a, b) => b - a),
  );
  assert.deepEqual(buildSnapshot([...candidates].reverse(), [], NOW), snapshot);
});

async function roundtrip(store: DiscoveryStore) {
  const lease = await store.acquire(NOW, DAY);
  assert.ok(lease);
  await store.save(lease, NOW, DAY, crowdedEngines(), { done: true });
  const snapshot = buildSnapshot(await store.repositories(), await store.metrics(0), NOW);
  await store.publish(lease, NOW + 1, snapshot);
  const published = await store.snapshot();
  assert.deepEqual(published, snapshot);
  assert.ok(published);
  await assertDiscoverable(published);
}

it("memory: tag coverage survives observation and snapshot roundtrip", async () =>
  roundtrip(createMemoryDiscovery()));
postgresTest("postgres: tag coverage survives observation and snapshot roundtrip", async (pool) =>
  roundtrip(createPostgresDiscovery(pool)),
);

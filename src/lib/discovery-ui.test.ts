import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterDiscovery,
  fateProjects,
  growthLabel,
  discoveryFreshness,
} from "./discovery/presentation.ts";
import { readDiscovery } from "./discovery/read.ts";
import type { DiscoveryCard, DiscoverySnapshot } from "./discovery/types.ts";
import type { ProjectShelf } from "./github-live.ts";

const day = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 24);
const card: DiscoveryCard = {
  isPublic: true,
  id: "1",
  owner: "Game",
  repo: "Engine",
  description: "Engine",
  blurb: "Engine",
  logoUrl: "https://github.com/Game.png",
  url: "https://github.com/Game/Engine",
  language: "Rust",
  stars: 12,
  live: false,
  tags: ["engines", "tools"],
  createdAt: now - 200 * day,
  firstSeenAt: now - day,
  observedAt: now,
  badges: ["discovered", "growing"],
  reasons: ["Недавно найден"],
  growth: { stars: 3, days: 2.5 },
};

describe("GameDev discovery presentation", () => {
  it("intersects language, tag and mode without a star floor or assuming every found repository is new", () => {
    assert.deepEqual(
      filterDiscovery([card], { cat: "games", tag: "tools", lang: "Rust", view: "discovered" }),
      [card],
    );
    for (const filter of [{ tag: "assets" }, { lang: "C++" }, { view: "new" }] as const) {
      assert.deepEqual(filterDiscovery([card], { cat: "games", ...filter }), []);
    }
    assert.deepEqual(filterDiscovery([card], { cat: "web" }), []);
    assert.deepEqual(filterDiscovery([card], { cat: "games", view: "all" }), [card]);
  });

  it("handles empty snapshots and missing languages without inventing a match", () => {
    assert.deepEqual(filterDiscovery(undefined, { cat: "games" }), []);
    assert.deepEqual(filterDiscovery(null, { cat: "games" }), []);
    const unknown = { ...card, language: null, tags: [], badges: [] };
    assert.deepEqual(filterDiscovery([unknown], { cat: "games" }), [unknown]);
    assert.deepEqual(filterDiscovery([unknown], { cat: "games", lang: "Rust" }), []);
    assert.deepEqual(filterDiscovery([unknown], { cat: "games", tag: "engines" }), []);
  });

  it("deduplicates fate candidates by case-insensitive GitHub slug while preserving language shelves", () => {
    const curated = { ...card, owner: "game", repo: "engine" };
    const library = { ...card, owner: "lib", repo: "utility" };
    const shelf: ProjectShelf = {
      live: true,
      ecosystem: [curated],
      direction: [curated],
      libraries: [library],
      discovery: { cards: [card], status: "ready", stale: false, updatedAt: now },
    };
    assert.deepEqual(fateProjects(shelf, { cat: "games" }), [card, library]);
    assert.deepEqual(fateProjects(shelf, { cat: "games", tag: "assets" }), [curated, library]);
    assert.deepEqual(fateProjects({ ...shelf, discovery: undefined }, { cat: "games" }), [
      curated,
      library,
    ]);
  });

  it("labels measured growth with the actual interval and leaves unmeasured growth absent", () => {
    assert.equal(growthLabel(card.growth), "+3 ★ за 2,5 дн.");
    assert.equal(growthLabel(null), null);
    assert.equal(growthLabel({ stars: 0, days: 3 }), "0 ★ за 3 дн.");
    assert.equal(growthLabel({ stars: 3, days: 0 }), null);
  });
});

describe("published discovery read", () => {
  it("reads a single published snapshot and never calls its cached cards live", async () => {
    let reads = 0;
    const snapshot: DiscoverySnapshot = {
      version: 1,
      generatedAt: now,
      cards: [{ ...card, live: true }],
    };
    const result = await readDiscovery(async () => {
      reads++;
      return snapshot;
    }, now);
    assert.equal(reads, 1);
    assert.equal(result.status, "ready");
    assert.equal(result.stale, false);
    assert.equal(result.cards[0].live, false);
    assert.equal(snapshot.cards[0].live, true);
  });

  it("keeps stale snapshots and distinguishes unpublished, published-empty and unavailable", async () => {
    const stale = await readDiscovery(
      async () => ({ version: 1, generatedAt: now - 3 * day, cards: [card] }),
      now,
    );
    assert.equal(stale.stale, true);
    assert.match(discoveryFreshness(stale), /Обновление задерживается/);
    assert.deepEqual(await readDiscovery(async () => null, now), {
      status: "empty",
      updatedAt: null,
      stale: false,
      cards: [],
    });
    assert.deepEqual(
      await readDiscovery(async () => ({ version: 1, generatedAt: now, cards: [] }), now),
      { status: "empty", updatedAt: now, stale: false, cards: [] },
    );
    const unavailable = await readDiscovery(async () => {
      throw new Error("relation does not exist");
    }, now);
    assert.deepEqual(unavailable, {
      status: "unavailable",
      updatedAt: null,
      stale: false,
      cards: [],
    });
    assert.match(discoveryFreshness(unavailable), /недоступна/);
  });
});

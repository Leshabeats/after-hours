import assert from "node:assert/strict";
import { it } from "node:test";
import { buildSnapshot, DAY, selectPublicationCandidates } from "./ranking.ts";
import type { DailyMetric, StoredRepository } from "./types.ts";

const NOW = Date.UTC(2026, 9, 24, 12);

function repository(
  id: string,
  patch: Partial<StoredRepository> = {},
): StoredRepository & { isPublic: true } {
  return {
    id,
    owner: "fixture",
    repo: id,
    description: "Game engine",
    language: "Rust",
    topics: ["game-engine"],
    stars: 120,
    forks: 2,
    createdAt: NOW - 100 * DAY,
    pushedAt: NOW - DAY,
    observedAt: NOW,
    countsObservedAt: NOW,
    archived: false,
    disabled: false,
    mirror: false,
    fork: false,
    tags: ["engines"],
    source: "fixture",
    releaseAt: NOW - DAY,
    mergedPrs: null,
    activityCheckedAt: NOW,
    firstSeenAt: NOW - 50 * DAY,
    ...patch,
    isPublic: true,
  };
}

function baseline(repo: StoredRepository): DailyMetric {
  return {
    repoId: repo.id,
    observedAt: (repo.countsObservedAt ?? repo.observedAt) - 7 * DAY,
    stars: 100,
    forks: 1,
  };
}

it("100 stale high-score projects cannot displace 30 fresh growing publication candidates", () => {
  const stale = Array.from({ length: 100 }, (_, i) =>
    repository(`stale-${i}`, {
      countsObservedAt: NOW - 3 * DAY,
      observedAt: NOW,
      createdAt: NOW - 10 * DAY,
      mergedPrs: 3,
      stars: 1000,
    }),
  );
  const fresh = Array.from({ length: 30 }, (_, i) => repository(`fresh-${i}`));
  const repos = [...stale, ...fresh];
  const metrics = repos.map(baseline);
  const snapshot = buildSnapshot(repos, metrics, NOW);
  assert.equal(snapshot.cards.length, 30);
  assert.ok(snapshot.cards.every((card) => card.badges.includes("growing")));
  const candidates = selectPublicationCandidates(repos, metrics, NOW);
  assert.equal(candidates.filter((card) => card.id.startsWith("fresh-")).length, 30);
  assert.deepEqual(
    candidates.map((card) => card.id),
    snapshot.cards.map((card) => card.id),
  );
});

it("only missing tags reserve stale retries, ordered by oldest measurement then stable ID rather than growth", () => {
  const fresh = repository("fresh");
  const quiet = repository("quiet-a", {
    tags: ["steamos", "linux-gaming"],
    countsObservedAt: NOW - 40 * DAY,
    observedAt: NOW - 40 * DAY,
    releaseAt: null,
    activityCheckedAt: null,
  });
  const tied = { ...quiet, id: "quiet-b", repo: "quiet-b" };
  const oldGrowth = repository("high-score", {
    tags: ["steamos", "linux-gaming"],
    countsObservedAt: NOW - 3 * DAY,
    observedAt: NOW,
    createdAt: NOW - 10 * DAY,
    stars: 1000,
    mergedPrs: 5,
  });
  const covered = repository("covered-stale", {
    countsObservedAt: NOW - 50 * DAY,
    observedAt: NOW - 50 * DAY,
  });
  const repos = [oldGrowth, tied, covered, quiet, fresh, quiet];
  const selected = selectPublicationCandidates(repos, repos.map(baseline), NOW);
  assert.deepEqual(
    selected.map((card) => card.id),
    ["fresh", "quiet-a"],
  );
  assert.equal(selected[1].growth, null);
  assert.equal(selected[1].badges.includes("growing"), false);
  assert.deepEqual(
    buildSnapshot(repos, repos.map(baseline), NOW).cards.map((card) => card.id),
    ["fresh"],
  );
});

it("fallback slots trim redundant fresh tags, retain sole fresh representatives and share multi-tag slots under the cap", () => {
  const engines = Array.from({ length: 99 }, (_, i) =>
    repository(`engine-${String(i).padStart(3, "0")}`, { createdAt: NOW - DAY }),
  );
  const tools = repository("sole-tools", {
    tags: ["tools"],
    stars: 0,
    releaseAt: null,
    activityCheckedAt: null,
  });
  const stale = {
    countsObservedAt: NOW - 10 * DAY,
    observedAt: NOW - 10 * DAY,
    releaseAt: null,
    activityCheckedAt: null,
  };
  const platform = repository("platform", {
    ...stale,
    tags: ["steamos", "linux-gaming", "proton"],
  });
  const assets = repository("assets", { ...stale, tags: ["assets"] });
  const repos = [...engines, tools, platform, assets, platform, engines[0]];
  const selected = selectPublicationCandidates(repos, [], NOW);
  assert.equal(selected.length, 100);
  assert.equal(new Set(selected.map((card) => card.id)).size, 100);
  assert.equal(selected.filter((card) => card.tags.includes("engines")).length, 97);
  assert.ok(selected.some((card) => card.id === "sole-tools"));
  assert.equal(selected.filter((card) => card.id === "platform").length, 1);
  for (const tag of ["engines", "tools", "assets", "steamos", "linux-gaming", "proton"]) {
    assert.ok(
      selected.some((card) => card.tags.some((candidate) => candidate === tag)),
      tag,
    );
  }
  assert.deepEqual(selectPublicationCandidates([...repos].reverse(), [], NOW), selected);
});

it("verification priority does not use growth that expires or changes baseline before remeasurement", () => {
  const expiring = Array.from({ length: 100 }, (_, i) =>
    repository(`expiring-${i}`, {
      observedAt: NOW - DAY,
      countsObservedAt: NOW - DAY,
      createdAt: NOW - 20 * DAY,
      stars: 150,
      activityCheckedAt: NOW - DAY,
    }),
  );
  const fresh = Array.from({ length: 30 }, (_, i) =>
    repository(`fresh-${i}`, {
      observedAt: NOW - 0.5 * DAY,
      countsObservedAt: NOW - 0.5 * DAY,
      stars: 150,
    }),
  );
  const metrics = [
    ...expiring.map((r) => ({ repoId: r.id, observedAt: NOW - 9.5 * DAY, stars: 100, forks: 1 })),
    ...expiring.map((r) => ({ repoId: r.id, observedAt: NOW - 6 * DAY, stars: 150, forks: 1 })),
    ...fresh.map((r) => ({ repoId: r.id, observedAt: NOW - 7 * DAY, stars: 100, forks: 1 })),
  ];
  const repos = [...expiring, ...fresh];
  const historical = buildSnapshot(repos, metrics, NOW);
  assert.ok(
    historical.cards.every((r) => r.id.startsWith("expiring-") && r.badges.includes("growing")),
  );
  const selected = selectPublicationCandidates(repos, metrics, NOW);
  assert.equal(selected.filter((r) => r.id.startsWith("fresh-")).length, 30);
  const oldCard = selected.find((r) => r.id.startsWith("expiring-"))!;
  assert.equal(oldCard.observedAt, NOW - DAY);
  assert.equal(oldCard.growth?.days, 8.5);
  assert.ok(oldCard.badges.includes("growing"));
  const ids = new Set(selected.map((r) => r.id));
  const remeasured = repos
    .filter((r) => ids.has(r.id))
    .map((r) => ({ ...r, observedAt: NOW, countsObservedAt: NOW }));
  assert.equal(
    buildSnapshot(remeasured, metrics, NOW).cards.filter((r) => r.badges.includes("growing"))
      .length,
    30,
  );
});

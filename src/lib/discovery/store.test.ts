import assert from "node:assert/strict";
import { it } from "node:test";
import { postgresTest } from "../db/testing.ts";
import { migrate } from "../db/migrate.ts";
import { createPostgresJournal } from "../journal/store.ts";
import {
  createMemoryDiscovery,
  createPostgresDiscovery,
  DiscoveryLeaseLostError,
} from "./store.ts";
import type { DiscoverySnapshot, DiscoveryStore, Observation } from "./types.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 24, 12);
const DURATION = 10 * DAY;
function observation(patch: Partial<Observation> = {}): Observation {
  return {
    id: "github-1",
    owner: "original",
    repo: "game",
    description: "A game tool",
    language: "Rust",
    topics: ["gamedev"],
    stars: 100,
    forks: 10,
    createdAt: NOW - 10 * DAY,
    pushedAt: NOW - DAY,
    observedAt: NOW,
    archived: false,
    fork: false,
    mirror: false,
    disabled: false,
    tags: ["tools"],
    source: "search",
    releaseAt: NOW - DAY,
    mergedPrs: 4,
    activityCheckedAt: NOW,
    ...patch,
  };
}
function snapshot(generatedAt: number): DiscoverySnapshot {
  return { version: 1, generatedAt, cards: [] };
}
function parity(name: string, exercise: (store: DiscoveryStore) => Promise<void>) {
  it(`memory: ${name}`, async () => exercise(createMemoryDiscovery()));
  postgresTest(`postgres: ${name}`, async (pool) => exercise(createPostgresDiscovery(pool)));
}

parity(
  "stable ids survive duplicate/rename; metadata null preserves activity and measured null clears it",
  async (store) => {
    const lease = await store.acquire(NOW, DURATION);
    assert.ok(lease);
    await store.save(lease, NOW, DURATION, [observation(), observation()], { page: 1 });
    await store.save(
      lease,
      NOW + 3,
      DURATION,
      [
        observation({
          owner: "renamed",
          repo: "new-name",
          stars: 120,
          observedAt: NOW + 2,
          releaseAt: null,
          mergedPrs: null,
          activityCheckedAt: null,
        }),
        observation({ observedAt: NOW - 1, stars: 1 }),
      ],
      { page: 2 },
    );
    const rows = await store.repositories();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.owner, "renamed");
    assert.equal(rows[0]?.repo, "new-name");
    assert.equal(rows[0]?.firstSeenAt, NOW);
    assert.equal(rows[0]?.stars, 120);
    assert.equal(rows[0]?.releaseAt, NOW - DAY);
    assert.equal(rows[0]?.mergedPrs, 4);
    assert.equal(rows[0]?.activityCheckedAt, NOW);
    await store.save(
      lease,
      NOW + 4,
      DURATION,
      [
        observation({
          observedAt: NOW + 4,
          activityCheckedAt: NOW + 4,
          releaseAt: null,
          mergedPrs: null,
        }),
      ],
      { page: 3 },
    );
    assert.equal((await store.repositories())[0]?.mergedPrs, null);
    assert.equal((await store.repositories())[0]?.releaseAt, null);
    assert.equal((await store.repositories())[0]?.activityCheckedAt, NOW + 4);
    await store.save(
      lease,
      NOW + 5,
      DURATION,
      [observation({ observedAt: NOW + 5, activityCheckedAt: NOW + 5, mergedPrs: 0 })],
      { page: 4 },
    );
    assert.equal((await store.repositories())[0]?.mergedPrs, 0);
    assert.equal((await store.metrics(0)).length, 1);
    assert.equal((await store.metrics(0))[0]?.observedAt, NOW + 5);
  },
);

parity(
  "metrics use UTC days and repeated or older same-day samples cannot double count",
  async (store) => {
    const boundary = Date.UTC(2026, 9, 25);
    const lease = await store.acquire(boundary - 1000, DURATION);
    assert.ok(lease);
    await store.save(
      lease,
      boundary + 1000,
      DURATION,
      [
        observation({ observedAt: boundary - 1, stars: 101 }),
        observation({ observedAt: boundary, stars: 102 }),
        observation({ observedAt: boundary + 500, stars: 103 }),
        observation({ observedAt: boundary + 200, stars: 1 }),
      ],
      null,
    );
    assert.deepEqual(
      (await store.metrics(0)).map((metric) => [metric.observedAt, metric.stars]),
      [
        [boundary - 1, 101],
        [boundary + 500, 103],
      ],
    );
    assert.equal((await store.metrics(boundary)).length, 1);
    assert.equal((await store.repositories())[0]?.stars, 103);
  },
);

parity(
  "acquire serializes contenders and expired takeover fences every old mutation",
  async (store) => {
    const leases = await Promise.all(Array.from({ length: 12 }, () => store.acquire(NOW, 100)));
    const first = leases.find((lease) => lease != null)!;
    assert.equal(leases.filter(Boolean).length, 1);
    await store.save(first, NOW + 10, 100, [observation()], { page: 4, ids: ["github-1"] });
    assert.equal(await store.acquire(NOW + 109, 100), null);
    const next = await store.acquire(NOW + 110, 100);
    assert.ok(next);
    assert.equal(next.runId, first.runId);
    assert.notEqual(next.token, first.token);
    assert.deepEqual(next.checkpoint, { page: 4, ids: ["github-1"] });
    await assert.rejects(
      store.save(first, NOW + 111, 100, [observation({ id: "loser" })], null),
      DiscoveryLeaseLostError,
    );
    await assert.rejects(
      store.release(first, NOW + 111, "loser", NOW + 10000),
      DiscoveryLeaseLostError,
    );
    await assert.rejects(
      store.publish(first, NOW + 111, snapshot(NOW + 111)),
      DiscoveryLeaseLostError,
    );
    assert.deepEqual(
      (await store.repositories()).map((repo) => repo.id),
      ["github-1"],
    );
    assert.equal(await store.snapshot(), null);
    await store.publish(next, NOW + 112, snapshot(NOW + 112));
    assert.deepEqual(await store.snapshot(), snapshot(NOW + 112));
    await assert.rejects(
      store.publish(next, NOW + 113, snapshot(NOW + 113)),
      DiscoveryLeaseLostError,
    );
  },
);

parity("expiry rejects writes without needing another worker to acquire", async (store) => {
  const lease = await store.acquire(NOW, 100);
  assert.ok(lease);
  await assert.rejects(
    store.save(lease, NOW + 100, 100, [observation()], null),
    DiscoveryLeaseLostError,
  );
  await assert.rejects(store.release(lease, NOW + 100, "expired"), DiscoveryLeaseLostError);
  await assert.rejects(store.publish(lease, NOW + 100, snapshot(NOW)), DiscoveryLeaseLostError);
  assert.deepEqual(await store.repositories(), []);
  assert.equal(await store.snapshot(), null);
});

parity(
  "partial failure and shared pause preserve the last completed snapshot and checkpoint",
  async (store) => {
    const first = await store.acquire(NOW, 100);
    assert.ok(first);
    await store.publish(first, NOW + 1, snapshot(NOW + 1));
    const second = await store.acquire(NOW + 2, 100);
    assert.ok(second);
    assert.notEqual(second.runId, first.runId);
    await store.save(second, NOW + 3, 100, [observation()], { page: 7 });
    assert.deepEqual(await store.snapshot(), snapshot(NOW + 1));
    await store.release(second, NOW + 4, "provider unavailable", NOW + 1000);
    assert.equal(await store.acquire(NOW + 999, 100), null);
    assert.deepEqual(await store.snapshot(), snapshot(NOW + 1));
    const resumed = await store.acquire(NOW + 1000, 100);
    assert.ok(resumed);
    assert.equal(resumed.runId, second.runId);
    assert.deepEqual(resumed.checkpoint, { page: 7 });
    await store.save(resumed, NOW + 1001, 100, [observation({ id: "github-2" })], { done: true });
    assert.equal((await store.repositories()).length, 2);
    await store.publish(resumed, NOW + 1002, snapshot(NOW + 1002));
    assert.deepEqual(await store.snapshot(), snapshot(NOW + 1002));
  },
);

parity("saved inputs and returned checkpoint/snapshot are independent copies", async (store) => {
  const lease = await store.acquire(NOW, 1000);
  assert.ok(lease);
  const input = observation();
  const checkpoint = { page: 1, ids: ["one"] };
  await store.save(lease, NOW + 1, 1000, [input], checkpoint);
  input.topics.push("mutated");
  checkpoint.ids.push("mutated");
  (await store.repositories())[0]!.topics.push("returned mutation");
  await store.release(lease, NOW + 2, "resume");
  const resumed = await store.acquire(NOW + 3, 1000);
  assert.ok(resumed);
  assert.deepEqual(resumed.checkpoint, { page: 1, ids: ["one"] });
  assert.deepEqual((await store.repositories())[0]?.topics, ["gamedev"]);
  const value = snapshot(NOW + 4);
  await store.publish(resumed, NOW + 4, value);
  value.generatedAt = 0;
  (await store.snapshot())!.generatedAt = 1;
  assert.equal((await store.snapshot())?.generatedAt, NOW + 4);
});

parity("a failed batch rolls back rows, checkpoint, metrics, and lease renewal", async (store) => {
  const lease = await store.acquire(NOW, 100);
  assert.ok(lease);
  await store.save(lease, NOW + 1, 100, [observation()], { page: 1 });
  await assert.rejects(
    store.save(
      lease,
      NOW + 50,
      1000,
      [observation({ id: "partial" }), observation({ id: "bad", observedAt: NaN })],
      { page: 2 },
    ),
    /Invalid discovery timestamp/,
  );
  assert.deepEqual(
    (await store.repositories()).map((repo) => repo.id),
    ["github-1"],
  );
  assert.equal((await store.metrics(0)).length, 1);
  const resumed = await store.acquire(NOW + 101, 100);
  assert.ok(resumed);
  assert.deepEqual(resumed.checkpoint, { page: 1 });
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  await assert.rejects(
    store.save(resumed, NOW + 102, 100, [observation({ id: "cyclic" })], cyclic),
    /circular/i,
  );
  assert.deepEqual(
    (await store.repositories()).map((repo) => repo.id),
    ["github-1"],
  );
});

parity(
  "metric retention keeps exactly 90 UTC days and ignores late ancient samples",
  async (store) => {
    const today = NOW + 99 * DAY;
    const lease = await store.acquire(today, DURATION);
    assert.ok(lease);
    await store.save(
      lease,
      today,
      DURATION,
      Array.from({ length: 100 }, (_, i) =>
        observation({ observedAt: NOW + i * DAY, stars: 100 + i }),
      ),
      null,
    );
    const metrics = await store.metrics(0);
    assert.equal(metrics.length, 90);
    assert.equal(metrics[0]?.observedAt, NOW + 10 * DAY);
    await store.save(
      lease,
      today + 1,
      DURATION,
      [observation({ observedAt: NOW, stars: 1 })],
      null,
    );
    assert.equal((await store.metrics(0)).length, 90);
    assert.equal((await store.repositories())[0]?.stars, 199);
  },
);

postgresTest(
  "postgres: two store instances share pause, fencing and immutable publication",
  async (pool) => {
    const a = createPostgresDiscovery(pool),
      b = createPostgresDiscovery(pool);
    const lease = await a.acquire(NOW, 100);
    assert.ok(lease);
    assert.equal(await b.acquire(NOW, 100), null);
    await a.save(lease, NOW + 1, 100, [observation()], { page: 3 });
    await a.release(lease, NOW + 2, "rate limit", NOW + 200);
    assert.equal(await b.acquire(NOW + 199, 100), null);
    const resumed = await b.acquire(NOW + 200, 100);
    assert.ok(resumed);
    assert.deepEqual(resumed.checkpoint, { page: 3 });
    await b.publish(resumed, NOW + 201, snapshot(NOW + 201));
    assert.deepEqual(await a.snapshot(), snapshot(NOW + 201));
    assert.equal((await a.repositories()).length, 1);
    assert.equal((await pool.query("SELECT count(*) AS n FROM discovery_sync_state")).rows[0].n, 1);
    for (let i = 0; i < 35; i++) {
      const at = NOW + 300 + i;
      const current = await a.acquire(at, 100);
      assert.ok(current);
      await a.publish(current, at, snapshot(at));
    }
    assert.equal((await pool.query("SELECT count(*) AS n FROM discovery_runs")).rows[0].n, 30);
    assert.deepEqual(await b.snapshot(), snapshot(NOW + 334));
  },
);

postgresTest(
  "postgres: fresh 002 schema and repeated migrator are ready without HTTP DDL",
  async (pool) => {
    const tables = (
      await pool.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name LIKE 'discovery_%' ORDER BY table_name`)
    ).rows.map((row) => row.table_name);
    assert.deepEqual(tables, [
      "discovery_daily_metrics",
      "discovery_repositories",
      "discovery_runs",
      "discovery_sync_state",
    ]);
    await Promise.all([migrate(pool), migrate(pool)]);
    assert.equal((await pool.query("SELECT count(*) AS n FROM schema_migrations")).rows[0].n, 2);
    assert.equal(await createPostgresDiscovery(pool).snapshot(), null);
  },
);

postgresTest(
  "postgres: upgrade from 001 preserves existing user, journal, usage and grant data",
  async (pool) => {
    // Reconstruct exactly the 001 state inside this test's isolated schema.
    await pool.query(`DROP TABLE discovery_sync_state, discovery_daily_metrics;
    DROP TABLE discovery_runs, discovery_repositories;
    DELETE FROM schema_migrations WHERE version = '002_discovery.sql'`);
    await pool.query("INSERT INTO users (id,login,created_at) VALUES ('existing','Existing',1)");
    await createPostgresJournal(pool).take("existing", {
      id: "owner/repo#1",
      owner: "owner",
      repo: "repo",
      number: 1,
      title: "Existing journal",
      kind: "blinding",
      url: "https://github.com/owner/repo/issues/1",
      isPr: false,
      status: "taken",
      takenAt: 1,
    });
    await pool.query(`INSERT INTO usage_events (user_id,at,harness,model,input_tokens,output_tokens)
    VALUES ('existing',1,'fixture','fixture',3,4)`);
    await pool.query(`INSERT INTO connector_grants (id,user_id,token_hash,created_at)
    VALUES ('grant','existing','existing-hash',1)`);
    const names = ["users", "journal", "usage_events", "connector_grants"];
    const before = await Promise.all(
      names.map(async (name) => (await pool.query(`SELECT * FROM ${name}`)).rows),
    );
    await migrate(pool);
    const after = await Promise.all(
      names.map(async (name) => (await pool.query(`SELECT * FROM ${name}`)).rows),
    );
    assert.deepEqual(after, before);
    assert.equal((await pool.query("SELECT count(*) AS n FROM schema_migrations")).rows[0].n, 2);
    assert.ok(await createPostgresDiscovery(pool).acquire(NOW, 100));
  },
);

postgresTest(
  "postgres: failed publication rolls back run completion and the published pointer",
  async (pool) => {
    const store = createPostgresDiscovery(pool);
    const first = await store.acquire(NOW, 100);
    assert.ok(first);
    await store.publish(first, NOW + 1, snapshot(NOW + 1));
    const pending = await store.acquire(NOW + 2, 100);
    assert.ok(pending);
    // Reject the pointer update after the candidate run's completion UPDATE has executed.
    await pool.query(`ALTER TABLE discovery_sync_state ADD CONSTRAINT reject_publication_fixture
    CHECK (published_run_id <> '${pending.runId}')`);
    await assert.rejects(
      store.publish(pending, NOW + 3, snapshot(NOW + 3)),
      /reject_publication_fixture/,
    );
    assert.deepEqual(await store.snapshot(), snapshot(NOW + 1));
    const run = (
      await pool.query("SELECT status, snapshot FROM discovery_runs WHERE id = $1", [pending.runId])
    ).rows[0];
    assert.equal(run.status, "running");
    assert.equal(run.snapshot, null);
    await pool.query("ALTER TABLE discovery_sync_state DROP CONSTRAINT reject_publication_fixture");
    await store.publish(pending, NOW + 4, snapshot(NOW + 4));
    assert.deepEqual(await store.snapshot(), snapshot(NOW + 4));
  },
);

parity(
  "availability-only updates preserve measurement time without inserting daily metrics",
  async (store) => {
    const lease = await store.acquire(NOW, DURATION);
    assert.ok(lease);
    await store.save(lease, NOW, DURATION, [observation({ countsObservedAt: NOW })], { page: 1 });
    for (let day = 1; day <= 7; day++) {
      await store.save(
        lease,
        NOW + day * DAY,
        DURATION,
        [
          observation({
            observedAt: NOW + day * DAY,
            countsObservedAt: NOW,
            disabled: true,
          }),
        ],
        { page: day + 1 },
      );
    }
    assert.deepEqual(await store.metrics(0), [
      { repoId: "github-1", observedAt: NOW, stars: 100, forks: 10 },
    ]);
    const current = (await store.repositories())[0];
    assert.equal(current.observedAt, NOW + 7 * DAY);
    assert.equal(current.countsObservedAt, NOW);
    assert.equal(current.disabled, true);
    await store.save(
      lease,
      NOW + 8 * DAY,
      DURATION,
      [observation({ observedAt: NOW + 8 * DAY, countsObservedAt: NOW + 8 * DAY, stars: 150 })],
      { done: true },
    );
    assert.equal((await store.metrics(0)).length, 2);
    assert.equal((await store.repositories())[0].disabled, false);
  },
);

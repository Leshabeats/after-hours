import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("collector fixture CLI never opens the supplied database and does not echo credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "after-hours-catalog-cli-"));
  const marker = "must-not-be-logged-secret";
  try {
    const fixture = join(dir, "repos.json");
    await writeFile(
      fixture,
      JSON.stringify([
        {
          id: 1,
          name: "sprites",
          owner: { login: "fixture" },
          description: "Game assets",
          language: null,
          topics: ["game-assets"],
          stargazers_count: 2,
          forks_count: 0,
          created_at: "2026-01-01T00:00:00Z",
          pushed_at: null,
          archived: false,
          fork: false,
          size: 10,
        },
      ]),
    );
    const env = {
      ...process.env,
      CATALOG_DATABASE_URL: `postgresql://bad:${marker}@not-a-server.invalid/db`,
      GITHUB_TOKEN: marker,
    };
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "scripts/catalog-sync.mjs", "--fixture", fixture],
      { encoding: "utf8", env, timeout: 15_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes(marker), false);
    const [receipt, snapshot] = result.stdout.trim().split("\n").map(JSON.parse);
    assert.equal(receipt.mode, "dry-run");
    assert.equal(receipt.status, "published");
    assert.equal(snapshot.cards[0].repo, "sprites");
    const invalid = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "scripts/catalog-sync.mjs", "--write", "--fixture", fixture],
      { encoding: "utf8", env, timeout: 15_000 },
    );
    assert.notEqual(invalid.status, 0);
    assert.equal(`${invalid.stdout}${invalid.stderr}`.includes(marker), false);
    const unknown = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "scripts/catalog-sync.mjs", "--unknown"],
      { encoding: "utf8", env, timeout: 15_000 },
    );
    assert.notEqual(unknown.status, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

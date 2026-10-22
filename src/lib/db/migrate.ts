import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { transaction } from "./postgres.ts";

export async function migrate(pool: Pool) {
  await transaction(pool, "after-hours:migrations", async (client) => {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at BIGINT NOT NULL
    )`);
    const directory = new URL("../../../migrations/", import.meta.url);
    const files = (await readdir(directory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
      .sort();
    for (const version of files) {
      const sql = await readFile(new URL(version, directory), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const applied = await client.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE version = $1",
        [version],
      );
      if (applied.rows[0]) {
        if (applied.rows[0].checksum !== checksum)
          throw new Error(`Applied migration changed: ${version}`);
        continue;
      }
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations VALUES ($1, $2, $3)", [
        version,
        checksum,
        Date.now(),
      ]);
    }
  });
}

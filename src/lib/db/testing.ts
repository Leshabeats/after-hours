import { randomBytes } from "node:crypto";
import { it } from "node:test";
import type { Pool } from "pg";
import { createPool } from "./postgres.ts";
import { migrate } from "./migrate.ts";

export async function isolatedDatabase() {
  // Never fall back to DATABASE_URL or load .env.local in tests.
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error("TEST_DATABASE_URL is required; tests never use DATABASE_URL.");
  const url = new URL(value);
  if (
    !url.pathname.endsWith("_test") ||
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("TEST_DATABASE_URL must point to a local ephemeral database named *_test.");
  }
  const admin = createPool(value, 1);
  const schema = `test_${randomBytes(12).toString("hex")}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const pool = createPool(url.toString());
  async function close() {
    await pool.end();
    try {
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await admin.end();
    }
  }
  try {
    await migrate(pool);
  } catch (error) {
    await close();
    throw error;
  }
  return { pool, connectionString: url.toString(), close };
}

export function postgresTest(name: string, run: (pool: Pool) => Promise<void>) {
  it(name, { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const db = await isolatedDatabase();
    try {
      await run(db.pool);
    } finally {
      await db.close();
    }
  });
}

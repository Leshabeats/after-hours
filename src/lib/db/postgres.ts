import pg, { type Pool, type PoolClient } from "pg";
import { attachDatabasePool } from "@vercel/functions";

export type Database = Pick<Pool, "query">;

// Domain timestamps and counters are JS numbers. Reject values outside their safe range.
pg.types.setTypeParser(20, (value) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new RangeError("Database integer exceeds JS safe range.");
  return number;
});

export function createPool(connectionString: string, max = 5): Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
  });
  // Pool errors occur on idle clients; active query failures still reject their caller.
  pool.on("error", (error) => console.error("PostgreSQL idle connection error", error.message));
  return pool;
}

let runtimePool: Pool | undefined;

export function getPool(): Pool {
  if (!runtimePool) {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) throw new Error("DATABASE_URL is required.");
    runtimePool = createPool(url);
    if (process.env.VERCEL) attachDatabasePool(runtimePool);
  }
  return runtimePool;
}

export async function transaction<T>(
  pool: Pool,
  lock: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let discard: Error | undefined;
  try {
    await client.query("BEGIN");
    // Transaction-scoped locks cover absent rows too, including concurrent first writes.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lock]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      discard =
        rollbackError instanceof Error ? rollbackError : new Error("PostgreSQL rollback failed.");
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

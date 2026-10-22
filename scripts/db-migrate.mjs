import { createPool } from "../src/lib/db/postgres.ts";
import { migrate } from "../src/lib/db/migrate.ts";

const url = process.env.DATABASE_URL_UNPOOLED?.trim();
if (!url) throw new Error("DATABASE_URL_UNPOOLED is required for migrations (direct connection).");
const pool = createPool(url, 1);
try {
  await migrate(pool);
  console.log("Database migrations applied.");
} finally {
  await pool.end();
}

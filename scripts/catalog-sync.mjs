import { readFile } from "node:fs/promises";
import { collectDiscovery } from "../src/lib/discovery/collector.ts";
import { createMemoryDiscovery, createPostgresDiscovery } from "../src/lib/discovery/store.ts";
import { createPool } from "../src/lib/db/postgres.ts";

const args = process.argv.slice(2);
const write = args.includes("--write");
const fixtureAt = args.indexOf("--fixture");
const fixture = fixtureAt >= 0 ? args[fixtureAt + 1] : null;
if (
  args.some(
    (arg, i) =>
      arg !== "--write" && arg !== "--fixture" && !(fixtureAt >= 0 && i === fixtureAt + 1),
  ) ||
  (fixtureAt >= 0 && !fixture)
)
  throw new Error("Usage: catalog-sync.mjs [--write | --fixture file.json]");
if (write && fixture) throw new Error("Fixtures cannot write to a database");
if (write && (!process.env.CATALOG_DATABASE_URL || !process.env.GITHUB_TOKEN))
  throw new Error("Explicit CATALOG_DATABASE_URL and GITHUB_TOKEN are required for --write");
let pool;
try {
  pool = write ? createPool(process.env.CATALOG_DATABASE_URL, 2) : undefined;
  const store = pool ? createPostgresDiscovery(pool) : createMemoryDiscovery();
  let fetchImpl;
  if (fixture) {
    const rows = JSON.parse(await readFile(fixture, "utf8"));
    if (!Array.isArray(rows) || rows.length > 300)
      throw new Error("Fixture must be an array of at most 300 GitHub repository objects");
    fetchImpl = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/repositories")
        return Response.json({
          items: rows.slice(0, 30),
          total_count: Math.min(rows.length, 30),
          incomplete_results: false,
        });
      if (url.pathname.endsWith("/pulls")) return Response.json([]);
      const row = rows.find(
        (r) =>
          url.pathname === `/repositories/${r.id}` ||
          url.pathname === `/repos/${r.owner?.login}/${r.name}`,
      );
      return row ? Response.json(row) : Response.json({ message: "Not Found" }, { status: 404 });
    };
  }
  const result = await collectDiscovery({
    store,
    token: fixture ? undefined : process.env.GITHUB_TOKEN,
    fetchImpl,
    ...(fixture ? { sleep: async () => {} } : {}),
  });
  console.log(JSON.stringify({ mode: write ? "write" : "dry-run", ...result }));
  if (!write) console.log(JSON.stringify(await store.snapshot()));
  if (result.status !== "published" && result.status !== "busy") process.exitCode = 2;
} catch {
  // No connection strings, upstream response bodies, or arbitrary error causes in CI output.
  console.error(
    "Catalog sync failed. Check configuration and persisted run status; credentials are never logged.",
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}

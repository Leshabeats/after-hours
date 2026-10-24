import assert from "node:assert/strict";
import { it } from "node:test";
import { isolatedDatabase } from "./testing.ts";

it("database tests reject missing, remote, and working database URLs before connecting", async (t) => {
  const saved = process.env.TEST_DATABASE_URL;
  t.after(() => {
    if (saved == null) delete process.env.TEST_DATABASE_URL;
    else process.env.TEST_DATABASE_URL = saved;
  });
  delete process.env.TEST_DATABASE_URL;
  await assert.rejects(isolatedDatabase(), /TEST_DATABASE_URL is required/);
  process.env.TEST_DATABASE_URL = "postgresql://fixture@localhost/production";
  await assert.rejects(isolatedDatabase(), /local ephemeral database/);
  process.env.TEST_DATABASE_URL = "postgresql://fixture@remote.invalid/app_test";
  await assert.rejects(isolatedDatabase(), /local ephemeral database/);
});

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { dataDirectory } from "./data-dir.ts";
import { readAuthSecret } from "./secret.ts";

it("keeps the development signing secret in DATA_DIR across release directories", (t) => {
  const root = mkdtempSync(join(tmpdir(), "ah-data-dir-"));
  const saved = {
    DATA_DIR: process.env.DATA_DIR,
    AUTH_SECRET: process.env.AUTH_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  };
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  process.env.NODE_ENV = "development";
  delete process.env.AUTH_SECRET;
  process.env.DATA_DIR = join(root, "persistent");
  const first = join(root, "release-one");
  const second = join(root, "release-two");
  mkdirSync(first);
  mkdirSync(second);
  const cwd = t.mock.method(process, "cwd", () => first);
  const secret = readAuthSecret();
  cwd.mock.mockImplementation(() => second);
  assert.equal(readAuthSecret(), secret);
  assert.equal(dataDirectory(), join(root, "persistent"));
  delete process.env.DATA_DIR;
  assert.equal(dataDirectory(), join(second, "data"));
  process.env.NODE_ENV = "production";
  assert.throws(() => readAuthSecret(), /AUTH_SECRET is required/);
});

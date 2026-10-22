import assert from "node:assert/strict";
import { it } from "node:test";
import { githubOAuthConfigured } from "./flags.ts";

it("disables GitHub OAuth in Preview even if credentials were inherited", (t) => {
  const keys = ["VERCEL_ENV", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"] as const;
  const saved = keys.map((key) => process.env[key]);
  t.after(() =>
    keys.forEach((key, index) => {
      if (saved[index] == null) delete process.env[key];
      else process.env[key] = saved[index];
    }),
  );
  process.env.GITHUB_CLIENT_ID = "fixture";
  process.env.GITHUB_CLIENT_SECRET = "fixture";
  process.env.VERCEL_ENV = "preview";
  assert.equal(githubOAuthConfigured(), false);
  process.env.VERCEL_ENV = "production";
  assert.equal(githubOAuthConfigured(), true);
});

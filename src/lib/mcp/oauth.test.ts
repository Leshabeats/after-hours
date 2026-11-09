import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryResearch, createPostgresResearch } from "../research/store.ts";
import { postgresTest } from "../db/testing.ts";
import { handleOAuth, postgresCodes, safeRedirect } from "./oauth.ts";
import type { Code, CodeStore, OAuthDeps } from "./oauth.ts";

const origin = "https://after-hours.test";
const secret = "test-only-secret-".repeat(4);
const verifier = "a".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");
function codes(): CodeStore {
  const rows = new Map<string, Code>();
  return {
    async put(k, v) {
      rows.set(k, v);
    },
    async take(k) {
      const value = rows.get(k);
      rows.delete(k);
      return value ?? null;
    },
  };
}
async function authorize(deps: OAuthDeps) {
  const registered = await handleOAuth(
    new Request(origin + "/mcp/register", {
      method: "POST",
      body: JSON.stringify({
        redirect_uris: ["http://127.0.0.1:9999/callback"],
        client_name: "<script>bad</script>",
      }),
    }),
    deps,
  );
  assert.equal(registered.status, 201);
  const { client_id } = await registered.json();
  const q = new URLSearchParams({
    client_id,
    redirect_uri: "http://127.0.0.1:9999/callback",
    response_type: "code",
    scope: "research",
    resource: origin + "/mcp",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "client-state",
  });
  const request = new Request(origin + "/mcp/authorize?" + q);
  const consent = await handleOAuth(request, deps);
  assert.equal(consent.headers.get("referrer-policy"), "same-origin");
  assert.match(
    consent.headers.get("content-security-policy")!,
    /form-action 'self' http:\/\/127\.0\.0\.1:9999;/,
  );
  const html = await consent.text();
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  const signed = /name="consent" value="([^"]+)"/.exec(html)![1];
  const post = (decision: string, reqOrigin = origin) =>
    new Request(origin + "/mcp/authorize", {
      method: "POST",
      headers: { Origin: reqOrigin },
      body: new URLSearchParams({ consent: signed, decision }),
    });
  assert.equal((await handleOAuth(post("allow", "https://evil.test"), deps)).status, 403);
  const deny = await handleOAuth(post("deny"), deps);
  assert.equal(new URL(deny.headers.get("location")!).searchParams.get("error"), "access_denied");
  const accepted = await handleOAuth(post("allow"), deps);
  const url = new URL(accepted.headers.get("location")!);
  assert.equal(url.searchParams.get("state"), "client-state");
  const code = url.searchParams.get("code")!;
  return { client_id, code };
}
function exchange(client_id: string, code: string, proof = verifier, resource = origin + "/mcp") {
  return new Request(origin + "/mcp/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id,
      code,
      redirect_uri: "http://127.0.0.1:9999/callback",
      code_verifier: proof,
      resource,
    }),
  });
}
it("OAuth: consent, PKCE, audience, single-use codes, revocation and expiry", async () => {
  const repo = createMemoryResearch();
  const deps = { origin, secret, repo, codes: codes(), user: { id: "owner", login: "owner" } };
  const { client_id, code } = await authorize(deps);
  const response = await handleOAuth(exchange(client_id, code), deps);
  assert.equal(response.status, 200);
  const { access_token } = await response.json();
  const grant = await repo.authenticate(access_token);
  assert.equal(grant?.userId, "owner");
  assert.equal((await handleOAuth(exchange(client_id, code), deps)).status, 400);
  await repo.revokeGrant("owner", grant!.grantId, Date.now());
  assert.equal(await repo.authenticate(access_token), null);
  const expired = await repo.createGrant("owner", Date.now(), Date.now() - 1);
  assert.equal(await repo.authenticate(expired.token), null);
  for (const [proof, resource] of [
    ["wrong", origin + "/mcp"],
    [verifier, "https://evil.test/mcp"],
  ]) {
    const fresh = await authorize(deps);
    assert.equal(
      (await handleOAuth(exchange(fresh.client_id, fresh.code, proof, resource), deps)).status,
      400,
    );
  }
});
postgresTest(
  "OAuth: concurrent authorization-code exchange succeeds once in PostgreSQL",
  async (pool) => {
    const repo = createPostgresResearch(pool);
    await repo.upsertAuthor({ id: "owner", login: "owner", name: "Owner", avatarUrl: "" });
    const deps = {
      origin,
      secret,
      repo,
      codes: postgresCodes(pool),
      user: { id: "owner", login: "owner" },
    };
    const { client_id, code } = await authorize(deps);
    const responses = await Promise.all([
      handleOAuth(exchange(client_id, code), deps),
      handleOAuth(exchange(client_id, code), deps),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
  },
);
it("OAuth: restricts callback URLs", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://evil.test/callback",
    "https://u:p@evil.test/callback",
    "https://app.test/#token",
  ])
    assert.equal(safeRedirect(url), false);
  assert.equal(safeRedirect("http://127.0.0.1:1234/callback"), true);
});

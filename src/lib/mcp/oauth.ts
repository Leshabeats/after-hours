import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { signPayload, verifyPayload } from "../auth/secret.ts";
import type { Database } from "../db/postgres.ts";
import type { ResearchRepo } from "../research/store.ts";

export type Code = {
  userId: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  resource: string;
  expiresAt: number;
};
export type CodeStore = {
  put(code: string, value: Code): Promise<void>;
  take(code: string): Promise<Code | null>;
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function postgresCodes(db: Database): CodeStore {
  return {
    async put(code, value) {
      await db.query("DELETE FROM mcp_authorization_codes WHERE expires_at <= $1", [Date.now()]);
      await db.query("INSERT INTO mcp_authorization_codes VALUES ($1,$2::jsonb,$3)", [
        hash(code),
        JSON.stringify(value),
        value.expiresAt,
      ]);
    },
    async take(code) {
      const result = await db.query<{ payload: Code }>(
        "DELETE FROM mcp_authorization_codes WHERE code_hash=$1 RETURNING payload",
        [hash(code)],
      );
      return result.rows[0]?.payload ?? null;
    },
  };
}

export function safeRedirect(value: string) {
  try {
    const url = new URL(value);
    return (
      /^(?:[a-z0-9.-]+|\[[0-9a-f:]+\])$/i.test(url.hostname) &&
      !url.hash &&
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}
const registration = z.object({
  redirect_uris: z
    .array(z.string().max(500).refine(safeRedirect))
    .min(1)
    .max(4)
    .refine((uris) => uris.join("").length <= 800),
  client_name: z.string().trim().min(1).max(100).default("MCP client"),
  token_endpoint_auth_method: z.literal("none").default("none"),
  // Native clients also request refresh; the response registers only the supported code flow.
  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .refine((grants) => grants.includes("authorization_code"))
    .optional(),
  response_types: z.array(z.literal("code")).optional(),
});
type Client = { purpose: "mcp_client"; name: string; redirects: string[] };
type Consent = { purpose: "mcp_consent"; userId: string; query: string; exp: number };
export type OAuthDeps = {
  origin: string;
  secret: string;
  codes: CodeStore;
  repo: ResearchRepo;
  user: { id: string; login: string } | null;
};
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
function page(body: string, callbackOrigin = "") {
  return new Response(
    `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Подключить After Hours</title><body><main><h1>Подключить After Hours</h1>${body}</main></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": `default-src 'none'; form-action 'self' ${callbackOrigin}; frame-ancestors 'none'; base-uri 'none'`,
        "Referrer-Policy": "same-origin",
        "X-Frame-Options": "DENY",
      },
    },
  );
}
export async function handleOAuth(request: Request, deps: OAuthDeps): Promise<Response> {
  const { origin, secret, codes, repo, user } = deps;
  const endpoint = new URL(request.url);
  const resource = origin + "/mcp";
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  if (endpoint.pathname.startsWith("/.well-known/oauth-protected-resource"))
    return json({
      resource,
      authorization_servers: [origin],
      scopes_supported: ["research"],
      bearer_methods_supported: ["header"],
    });
  if (endpoint.pathname === "/.well-known/oauth-authorization-server")
    return json({
      issuer: origin,
      authorization_endpoint: origin + "/mcp/authorize",
      token_endpoint: origin + "/mcp/token",
      registration_endpoint: origin + "/mcp/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["research"],
    });
  if (request.method === "POST" && endpoint.pathname === "/mcp/register") {
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return json({ error: "invalid_client_metadata" }, 400);
    }
    const parsed = registration.safeParse(input);
    if (!parsed.success) return json({ error: "invalid_client_metadata" }, 400);
    const data = parsed.data;
    // Signed, immutable registration avoids an unauthenticated database write.
    const clientId = signPayload(
      { purpose: "mcp_client", name: data.client_name, redirects: data.redirect_uris },
      secret,
    );
    return json(
      {
        ...data,
        client_id: clientId,
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      201,
    );
  }
  if (request.method === "POST" && endpoint.pathname === "/mcp/token") {
    const form = await request.formData();
    const code = String(form.get("code") ?? "");
    if (code.length > 200 || form.get("grant_type") !== "authorization_code")
      return json({ error: "invalid_request" }, 400);
    const value = await codes.take(code);
    const verifier = String(form.get("code_verifier") ?? "");
    if (
      !value ||
      value.expiresAt <= Date.now() ||
      value.clientId !== form.get("client_id") ||
      value.redirectUri !== form.get("redirect_uri") ||
      value.resource !== form.get("resource") ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
      createHash("sha256").update(verifier).digest("base64url") !== value.challenge
    )
      return json({ error: "invalid_grant" }, 400);
    const now = Date.now();
    const { token } = await repo.createGrant(value.userId, now, now + 30 * 86400_000);
    return json({
      access_token: token,
      token_type: "Bearer",
      expires_in: 30 * 86400,
      scope: "research",
    });
  }
  if (endpoint.pathname !== "/mcp/authorize") return json({ error: "not_found" }, 404);
  if (request.method === "POST") {
    if (!user || request.headers.get("origin") !== origin)
      return json({ error: "access_denied" }, 403);
    const form = await request.formData();
    const consent = verifyPayload<Consent>(String(form.get("consent") ?? ""), secret);
    if (
      !consent ||
      consent.purpose !== "mcp_consent" ||
      consent.userId !== user.id ||
      consent.exp <= Date.now()
    )
      return json({ error: "access_denied" }, 403);
    endpoint.search = consent.query;
    if (form.get("decision") !== "allow") {
      const target = new URL(endpoint.searchParams.get("redirect_uri")!);
      target.searchParams.set("error", "access_denied");
      if (endpoint.searchParams.has("state"))
        target.searchParams.set("state", endpoint.searchParams.get("state")!);
      return Response.redirect(target, 303);
    }
  } else if (request.method !== "GET") return json({ error: "invalid_request" }, 405);
  if (endpoint.search.length > 2400) return json({ error: "invalid_request" }, 400);
  const q = endpoint.searchParams;
  const clientId = q.get("client_id") ?? "";
  const client = verifyPayload<Client>(clientId, secret);
  const redirectUri = q.get("redirect_uri") ?? "";
  const challenge = q.get("code_challenge") ?? "";
  if (
    !client ||
    client.purpose !== "mcp_client" ||
    !client.redirects.includes(redirectUri) ||
    !safeRedirect(redirectUri) ||
    q.get("response_type") !== "code" ||
    q.get("resource") !== resource ||
    q.get("code_challenge_method") !== "S256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
    (q.get("scope") ?? "research") !== "research"
  )
    return json({ error: "invalid_request" }, 400);
  if (!user)
    return page(
      `<p>Сначала войди через GitHub, затем подтверди подключение.</p><a href="/api/auth/github?returnTo=${encodeURIComponent(endpoint.pathname + endpoint.search)}">Войти через GitHub</a>`,
    );
  if (request.method === "GET") {
    const consent = signPayload(
      {
        purpose: "mcp_consent",
        userId: user.id,
        query: endpoint.search,
        exp: Date.now() + 600_000,
      },
      secret,
    );
    return page(
      `<p>Аккаунт: ${escape(user.login)}. Приложение: ${escape(client.name)} (${escape(new URL(redirectUri).origin)}).</p><p>Разрешить подбор задач и отправку публичных отчётов от твоего имени? Отчёт публикуется после submit_report. Доступ можно отозвать в журнале.</p><form method="post"><input type="hidden" name="consent" value="${escape(consent)}"><button name="decision" value="allow">Подключить</button><button name="decision" value="deny">Отмена</button></form>`,
      new URL(redirectUri).origin,
    );
  }
  const code = randomBytes(32).toString("base64url");
  await codes.put(code, {
    userId: user.id,
    clientId,
    redirectUri,
    challenge,
    resource,
    expiresAt: Date.now() + 300_000,
  });
  const target = new URL(redirectUri);
  target.searchParams.set("code", code);
  if (q.has("state")) target.searchParams.set("state", q.get("state")!);
  return Response.redirect(target, 303);
}

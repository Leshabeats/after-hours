import { handleMcp } from "./server.ts";
import { handleOAuth, postgresCodes } from "./oauth.ts";
import { getPool } from "../db/postgres.ts";
import { getResearchRepo } from "../auth/db.ts";
import { readAuthSecret } from "../auth/secret.ts";
import { readSessionFromRequest } from "../auth/session";

export async function handleMcpRoute(request: Request) {
  // APP_ORIGIN is the OAuth issuer; never derive production redirects from Host.
  const origin =
    process.env.APP_ORIGIN?.replace(/\/$/, "") ||
    (process.env.NODE_ENV !== "production" ? new URL(request.url).origin : "");
  if (!origin) return new Response("APP_ORIGIN is required.", { status: 503 });
  try {
    // Bound memory use before parsing OAuth forms or JSON-RPC payloads.
    if (request.body) {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 131072) {
          await reader.cancel();
          return new Response("Request too large", { status: 413 });
        }
        chunks.push(value);
      }
      request = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: Buffer.concat(chunks),
      });
    }
    const repo = getResearchRepo();
    if (new URL(request.url).pathname === "/mcp") return await handleMcp(request, { repo, origin });
    return await handleOAuth(request, {
      origin,
      secret: readAuthSecret(),
      codes: postgresCodes(getPool()),
      repo,
      user: readSessionFromRequest(request),
    });
  } catch {
    return Response.json(
      { error: "temporarily_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

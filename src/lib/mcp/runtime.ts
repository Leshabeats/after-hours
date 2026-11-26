import { handleMcp } from "./server.ts";
import { handleOAuth, postgresCodes } from "./oauth.ts";
import { getPool } from "../db/postgres.ts";
import { getResearchRepo } from "../auth/db.ts";
import { readAuthSecret } from "../auth/secret.ts";
import { readSessionFromRequest } from "../auth/session";
import { appOrigin } from "../auth/app-origin.ts";

export async function handleMcpRoute(request: Request) {
  const origin = appOrigin(request);
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

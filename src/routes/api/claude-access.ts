import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/claude-access")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const response = (body: object, status: number) =>
          Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
        const { appOrigin } = await import("@/lib/auth/app-origin");
        const origin = appOrigin(request);
        if (!origin) return response({ error: "temporarily_unavailable" }, 503);
        if (request.headers.get("origin") !== origin) return response({ error: "forbidden" }, 403);
        const { readSessionFromRequest } = await import("@/lib/auth/session");
        const user = readSessionFromRequest(request);
        if (!user) return response({ error: "unauthorized" }, 401);
        const { getResearchRepo } = await import("@/lib/auth/db");
        const { mcp, telemetry } = await getResearchRepo().createClaudeGrants(
          user.id,
          Date.now(),
          origin,
        );
        return response(
          {
            config: { origin, mcpToken: mcp.token, usageToken: telemetry.token },
            grants: [mcp.grant, telemetry.grant],
          },
          201,
        );
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/research-usage")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { appOrigin } = await import("@/lib/auth/app-origin");
        const origin = appOrigin(request);
        if (!origin) return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
        const { getResearchRepo } = await import("@/lib/auth/db");
        const { handleClaudeUsagePost } = await import("@/lib/research/http");
        return handleClaudeUsagePost(request, getResearchRepo(), origin);
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/research")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getResearchRepo } = await import("@/lib/auth/db");
        const { handleResearchPost } = await import("@/lib/research/http");
        return handleResearchPost(request, getResearchRepo());
      },
    },
  },
});

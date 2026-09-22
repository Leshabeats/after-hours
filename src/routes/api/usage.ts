import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/usage")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { readSessionFromRequest } = await import("@/lib/auth/session");
        const user = readSessionFromRequest(request);
        if (!user) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
        }

        const { usageInputSchema } = await import("@/lib/usage/schema");
        const parsed = usageInputSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ ok: false, error: "invalid" }, { status: 400 });
        }

        const { getUsageRepo } = await import("@/lib/auth/db");
        const { clampUsageAt, summarizeUsage } = await import("@/lib/usage/stats");
        const repo = getUsageRepo();
        const data = parsed.data;
        repo.record(user.id, {
          at: clampUsageAt(data.at),
          harness: data.harness,
          model: data.model,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          missionId: data.missionId,
        });
        return Response.json({
          ok: true,
          usage: summarizeUsage(repo.list(user.id)),
        });
      },
    },
  },
});

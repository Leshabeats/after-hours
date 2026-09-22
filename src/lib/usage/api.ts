import { createServerFn } from "@tanstack/react-start";
import { usageInputSchema } from "./schema";
import { clampUsageAt, summarizeUsage } from "./stats";
import type { UsageSummary } from "./types";

export type UsageLoad =
  | { status: "anonymous" }
  | { status: "ready"; usage: UsageSummary }
  | { status: "error" };

async function loadSession() {
  const { readSession } = await import("@/lib/auth/session");
  return readSession();
}

async function loadUsage() {
  const { getUsageRepo } = await import("@/lib/auth/db");
  return getUsageRepo();
}

export const getUsageSummary = createServerFn({ method: "GET" }).handler(
  async (): Promise<UsageLoad> => {
    try {
      const user = await loadSession();
      if (!user) return { status: "anonymous" };
      return {
        status: "ready",
        usage: summarizeUsage((await loadUsage()).list(user.id)),
      };
    } catch {
      return { status: "error" };
    }
  },
);

export const reportUsage = createServerFn({ method: "POST" })
  .validator(usageInputSchema)
  .handler(
    async ({
      data,
    }): Promise<
      { ok: "anonymous" } | { ok: "account"; usage: UsageSummary }
    > => {
      const user = await loadSession();
      if (!user) return { ok: "anonymous" };
      const repo = await loadUsage();
      repo.record(user.id, {
        at: clampUsageAt(data.at),
        harness: data.harness,
        model: data.model,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        missionId: data.missionId,
      });
      return { ok: "account", usage: summarizeUsage(repo.list(user.id)) };
    },
  );

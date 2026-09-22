import type { UsageEvent, UsageSummary } from "./types.ts";

/** Rolling 7 days, inclusive of `now`. */
export const USAGE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function clampUsageAt(at: number | undefined, now = Date.now()) {
  if (at == null || !Number.isFinite(at) || at > now) return now;
  return at;
}

export function summarizeUsage(
  events: readonly UsageEvent[],
  now = Date.now(),
): UsageSummary {
  const weekStart = now - USAGE_WEEK_MS;
  let weekTokens = 0;
  let allTimeTokens = 0;
  let lastAt = Number.NEGATIVE_INFINITY;
  let lastHarness: string | null = null;

  for (const event of events) {
    const tokens = event.inputTokens + event.outputTokens;
    allTimeTokens += tokens;
    if (event.at > now) continue;
    if (event.at >= weekStart) weekTokens += tokens;
    if (event.at > lastAt) {
      lastAt = event.at;
      lastHarness = event.harness;
    }
  }

  return { weekTokens, allTimeTokens, lastHarness };
}

import type { ResearchTurn, TurnUsage } from "./types.ts";

export type TurnSpend = {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningOutputTokens: number | null;
  totalTokens: number | null;
  unknownTurns: number;
};

function sumField(
  turns: readonly ResearchTurn[],
  field: keyof TurnUsage,
): number | null {
  if (turns.length === 0) return null;
  let sum = 0;
  for (const turn of turns) {
    const value = turn.usage[field];
    if (value == null) return null;
    sum += value;
  }
  return sum;
}

/**
 * Sum of per-turn snapshots. Cached input is reported on its own and is not
 * added into `totalTokens`. A turn with no usage event leaves the sums unknown.
 */
export function sumTurnSnapshots(turns: readonly ResearchTurn[]): TurnSpend {
  const known = turns.filter((turn) => turn.usageKnown);
  if (known.length === 0) {
    return {
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningOutputTokens: null,
      totalTokens: null,
      unknownTurns: turns.length,
    };
  }
  return {
    inputTokens: sumField(known, "inputTokens"),
    cachedInputTokens: sumField(known, "cachedInputTokens"),
    outputTokens: sumField(known, "outputTokens"),
    reasoningOutputTokens: sumField(known, "reasoningOutputTokens"),
    totalTokens: sumField(known, "totalTokens"),
    unknownTurns: turns.length - known.length,
  };
}

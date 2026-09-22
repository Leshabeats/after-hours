export type UsageEvent = {
  at: number;
  harness: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  missionId?: string;
};

export type UsageSummary = {
  weekTokens: number;
  allTimeTokens: number;
  lastHarness: string | null;
};

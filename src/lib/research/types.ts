export const RUN_STATUSES = [
  "in_progress",
  "waiting",
  "interrupted",
  "failed",
  "completed",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TURN_STATUSES = [
  "inProgress",
  "completed",
  "interrupted",
  "failed",
] as const;
export type TurnStatus = (typeof TURN_STATUSES)[number];

export type TurnUsage = {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningOutputTokens: number | null;
  totalTokens: number | null;
};

export type ResearchTurn = {
  turnId: string;
  status: TurnStatus;
  usageKnown: boolean;
  usage: TurnUsage;
  updatedAt: number;
};

export type ReportLink = {
  url: string;
  kind: string;
};

export type ResearchReport = {
  schemaVersion: 1;
  findings: string;
  work: string;
  evidence: string[];
  unknowns: string[];
  nextSteps: string[];
  links: ReportLink[];
};

export type LimitWindow = {
  usedPercent: number | null;
  windowDurationMins: number | null;
  resetsAt: number | null;
};

/** Private subscription snapshot. Null fields mean the window was absent. */
export type LimitSnapshot = {
  readAt: number;
  primary: LimitWindow | null;
  secondary: LimitWindow | null;
  spendControlReached: boolean | null;
  individualRemainingPercent: number | null;
};

export type ResearchRun = {
  id: string;
  userId: string;
  missionId: string;
  owner: string;
  repo: string;
  number: number;
  isPr: boolean;
  threadId: string;
  status: RunStatus;
  model: string | null;
  report: ResearchReport | null;
  publishedAt: number | null;
  createdAt: number;
  updatedAt: number;
  turns: ResearchTurn[];
};

export type ConnectorGrant = {
  id: string;
  createdAt: number;
  revokedAt: number | null;
  lastUsedAt: number | null;
};

/** `model` and `report` stay undefined when the request left them out. */
export type ResearchDelivery = {
  threadId: string;
  missionId: string;
  owner: string;
  repo: string;
  number: number;
  isPr: boolean;
  status: RunStatus;
  model?: string;
  report?: ResearchReport;
  turns: ResearchTurn[];
  limit: LimitSnapshot | null;
  at: number;
};

export function emptyUsage(): TurnUsage {
  return {
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    reasoningOutputTokens: null,
    totalTokens: null,
  };
}

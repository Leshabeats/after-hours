import { parseResearchReport, researchDeliverySchema, type ResearchDeliveryInput } from "./schema.ts";
import {
  emptyUsage,
  TURN_STATUSES,
  type LimitSnapshot,
  type LimitWindow,
  type RunStatus,
  type TurnStatus,
  type TurnUsage,
} from "./types.ts";

const TURN_STATUS_LIST: readonly string[] = TURN_STATUSES;

export type SessionTurn = {
  turnId: string;
  status: TurnStatus;
  usage: TurnUsage | null;
};

export type ResearchSession = {
  threadId: string;
  missionId: string;
  isPr: boolean;
  model: string | null;
  waiting: boolean;
  /** Set when the local process stops before Codex has a turn id. */
  localInterrupt: boolean;
  turns: SessionTurn[];
  textByTurn: Record<string, string>;
  limit: LimitSnapshot | null;
};

export type CodexEvent =
  | { type: "model"; model: string }
  | { type: "usage"; threadId: string; turnId: string; last: unknown }
  | { type: "turn"; threadId: string; turnId: string; status: string; text?: string }
  | { type: "thread-status"; threadId: string; status: unknown }
  | { type: "limit"; limit: LimitSnapshot };

const USAGE_FIELDS = [
  "inputTokens",
  "cachedInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "totalTokens",
] as const;

export function createSession(input: {
  threadId: string;
  missionId: string;
  isPr: boolean;
  model?: string | null;
}): ResearchSession {
  return {
    threadId: input.threadId,
    missionId: input.missionId,
    isPr: input.isPr,
    model: cleanModel(input.model ?? null),
    waiting: false,
    localInterrupt: false,
    turns: [],
    textByTurn: {},
    limit: null,
  };
}

/** Copy the five stored fields from one turn's `last`. `total` and `cacheWrite` are ignored. */
export function usageFromLast(last: unknown): TurnUsage | null {
  if (!last || typeof last !== "object" || Array.isArray(last)) return null;
  const record = last as Record<string, unknown>;
  const usage = emptyUsage();
  for (const field of USAGE_FIELDS) {
    const value = record[field];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000_000) {
      return null;
    }
    usage[field] = value;
  }
  return usage;
}

export function limitFromRateLimits(result: unknown, readAt: number): LimitSnapshot | null {
  if (!Number.isInteger(readAt) || readAt <= 0) return null;
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const root = result as Record<string, unknown>;
  const limits =
    root.rateLimits && typeof root.rateLimits === "object" && !Array.isArray(root.rateLimits)
      ? (root.rateLimits as Record<string, unknown>)
      : root;
  const individual = limits.individualLimit;
  const remaining =
    individual && typeof individual === "object" && !Array.isArray(individual)
      ? (individual as Record<string, unknown>).remainingPercent
      : null;
  return {
    readAt,
    primary: windowOf(limits.primary),
    secondary: windowOf(limits.secondary),
    spendControlReached: typeof limits.spendControlReached === "boolean" ? limits.spendControlReached : null,
    individualRemainingPercent: percentOrNull(remaining),
  };
}

export function eventFromNotification(message: unknown, threadId: string): CodexEvent | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const record = message as Record<string, unknown>;
  if (typeof record.method !== "string") return null;
  if (!record.params || typeof record.params !== "object" || Array.isArray(record.params)) return null;
  const params = record.params as Record<string, unknown>;
  if (params.threadId !== threadId) return null;

  if (record.method === "thread/tokenUsage/updated") {
    if (typeof params.turnId !== "string") return null;
    const tokenUsage = params.tokenUsage;
    if (!tokenUsage || typeof tokenUsage !== "object" || Array.isArray(tokenUsage)) return null;
    return {
      type: "usage",
      threadId,
      turnId: params.turnId,
      last: (tokenUsage as Record<string, unknown>).last,
    };
  }

  if (record.method === "turn/completed" || record.method === "turn/started") {
    const turn = params.turn;
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) return null;
    const turnRecord = turn as Record<string, unknown>;
    if (typeof turnRecord.id !== "string" || typeof turnRecord.status !== "string") return null;
    return {
      type: "turn",
      threadId,
      turnId: turnRecord.id,
      status: turnRecord.status,
      text: record.method === "turn/completed" ? agentText(turnRecord.items) : undefined,
    };
  }

  if (record.method === "thread/status/changed") {
    return { type: "thread-status", threadId, status: params.status };
  }
  return null;
}

export function applyCodexEvent(session: ResearchSession, event: CodexEvent): ResearchSession {
  if (event.type === "model") {
    return { ...session, model: cleanModel(event.model) };
  }
  if (event.type === "limit") return { ...session, limit: event.limit };
  if ("threadId" in event && event.threadId !== session.threadId) return session;

  if (event.type === "usage") {
    const usage = usageFromLast(event.last);
    if (!usage) return session;
    return upsertTurn(session, event.turnId, "inProgress", usage, undefined);
  }

  if (event.type === "turn") {
    if (!isTurnStatus(event.status)) return session;
    return upsertTurn(session, event.turnId, event.status, undefined, event.text);
  }

  const waiting = readWaiting(event.status);
  if (waiting == null) return session;
  return { ...session, waiting };
}

export function interruptSession(session: ResearchSession): ResearchSession {
  if (session.turns.length === 0) {
    return { ...session, waiting: false, localInterrupt: true };
  }
  const last = session.turns.length - 1;
  return {
    ...session,
    waiting: false,
    localInterrupt: false,
    turns: session.turns.map((turn, index) =>
      index === last && turn.status === "inProgress" ? { ...turn, status: "interrupted" } : turn,
    ),
  };
}

export function buildDelivery(session: ResearchSession): ResearchDeliveryInput {
  const latest = session.turns.at(-1) ?? null;
  let status: RunStatus = "in_progress";
  if (session.waiting) status = "waiting";
  else if (session.localInterrupt && !latest) status = "interrupted";
  else if (latest?.status === "interrupted") status = "interrupted";
  else if (latest?.status === "failed") status = "failed";
  else if (latest?.status === "completed") status = "completed";

  const parsed = latest ? parseResearchReport(session.textByTurn[latest.turnId] ?? "") : null;
  const draft: ResearchDeliveryInput = {
    threadId: session.threadId,
    missionId: session.missionId,
    isPr: session.isPr,
    status,
    turns: session.turns.map((turn) => ({
      turnId: turn.turnId,
      status: turn.status,
      usage: turn.usage,
    })),
  };
  if (session.model) draft.model = session.model;
  if (status === "completed" && parsed) draft.report = parsed;
  else if (status === "completed") draft.status = "failed";
  if (session.limit) draft.limit = session.limit;
  return draft;
}

/** Null when the snapshot cannot be accepted by POST /api/research. A bad limit is dropped once. */
export function deliveryForWire(session: ResearchSession): ResearchDeliveryInput | null {
  const draft = buildDelivery(session);
  const parsed = researchDeliverySchema.safeParse(draft);
  if (parsed.success) return parsed.data;
  if (!draft.limit) return null;
  const { limit: _limit, ...withoutLimit } = draft;
  const retry = researchDeliverySchema.safeParse(withoutLimit);
  return retry.success ? retry.data : null;
}

function upsertTurn(
  session: ResearchSession,
  turnId: string,
  status: TurnStatus,
  usage: TurnUsage | undefined,
  text: string | undefined,
): ResearchSession {
  const turns = session.turns.map((turn) => ({ ...turn }));
  const found = turns.find((turn) => turn.turnId === turnId);
  if (found) {
    if (usage !== undefined) found.usage = usage;
    else found.status = status;
  } else {
    turns.push({ turnId, status, usage: usage ?? null });
  }
  const textByTurn = { ...session.textByTurn };
  if (text !== undefined) textByTurn[turnId] = text;
  return { ...session, turns, textByTurn };
}

function agentText(items: unknown) {
  if (!Array.isArray(items)) return "";
  return items
    .filter(
      (item): item is { text: string } =>
        Boolean(item) &&
        typeof item === "object" &&
        (item as { type?: unknown }).type === "agentMessage" &&
        typeof (item as { text?: unknown }).text === "string",
    )
    .map((item) => item.text)
    .join("\n");
}

function readWaiting(status: unknown) {
  if (!status || typeof status !== "object" || Array.isArray(status)) return null;
  const record = status as Record<string, unknown>;
  if (record.type === "active") {
    const flags = Array.isArray(record.activeFlags) ? record.activeFlags : [];
    return flags.includes("waitingOnApproval") || flags.includes("waitingOnUserInput");
  }
  if (record.type === "idle" || record.type === "notLoaded" || record.type === "systemError") {
    return false;
  }
  return null;
}

function windowOf(value: unknown): LimitWindow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const window = value as Record<string, unknown>;
  const usedPercent = percentOrNull(window.usedPercent);
  if (usedPercent == null) return null;
  return {
    usedPercent,
    windowDurationMins: countOrNull(window.windowDurationMins),
    resetsAt: countOrNull(window.resetsAt),
  };
}

function percentOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function countOrNull(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function cleanModel(model: string | null) {
  if (!model) return null;
  const trimmed = model.trim();
  if (!trimmed || trimmed.length > 80) return null;
  return trimmed;
}

function isTurnStatus(status: string): status is TurnStatus {
  return TURN_STATUS_LIST.includes(status);
}

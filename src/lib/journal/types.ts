import { KINDS, type Kind, type Mission } from "../kinds.ts";

export const LOG_STATUSES = ["taken", "shipping", "shipped"] as const;
export type LogStatus = (typeof LOG_STATUSES)[number];

export type LogEntry = {
  id: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  kind: Kind;
  url: string;
  isPr: boolean;
  status: LogStatus;
  takenAt: number;
};

export type SessionUser = {
  id: string;
  login: string;
  name: string;
  avatarUrl: string;
};

export type AuthSnapshot = {
  configured: boolean;
  user: SessionUser | null;
  entries: LogEntry[] | null;
};

export function isLogStatus(value: string): value is LogStatus {
  return (LOG_STATUSES as readonly string[]).includes(value);
}

export function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

export function entryFromMission(mission: Mission, takenAt = Date.now()): LogEntry {
  return {
    id: mission.id,
    owner: mission.owner,
    repo: mission.repo,
    number: mission.number,
    title: mission.title,
    kind: mission.kind,
    url: mission.url,
    isPr: mission.isPr,
    status: "taken",
    takenAt,
  };
}

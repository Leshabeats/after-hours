import { KINDS, type Kind } from "../kinds.ts";
import { type LogEntry, type LogStatus } from "./types.ts";

export type NightStats = {
  total: number;
  taken: number;
  shipping: number;
  shipped: number;
  byKind: Record<Kind, number>;
  topKind: Kind | null;
};

const emptyByKind = (): Record<Kind, number> =>
  Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<Kind, number>;

export function summarizeJournal(entries: readonly LogEntry[]): NightStats {
  const byStatus: Record<LogStatus, number> = {
    taken: 0,
    shipping: 0,
    shipped: 0,
  };
  const byKind = emptyByKind();

  for (const entry of entries) {
    byStatus[entry.status] += 1;
    byKind[entry.kind] += 1;
  }

  let topKind: Kind | null = null;
  let topCount = 0;
  for (const kind of KINDS) {
    if (byKind[kind] > topCount) {
      topKind = kind;
      topCount = byKind[kind];
    }
  }

  return {
    total: entries.length,
    taken: byStatus.taken,
    shipping: byStatus.shipping,
    shipped: byStatus.shipped,
    byKind,
    topKind: topCount > 0 ? topKind : null,
  };
}
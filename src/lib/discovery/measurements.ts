import type { Observation, StoredRepository } from "./types.ts";

export function retainCounts(next: Observation, previous: Observation): Observation {
  return {
    ...next,
    stars: previous.stars,
    forks: previous.forks,
    countsObservedAt: previous.countsObservedAt ?? previous.observedAt,
    countsSource: previous.countsSource,
    countsScanId: previous.countsScanId,
    countsMeasured: false,
  };
}

// A search document can update metadata but cannot replace this scan's ID sample.
// Persisted provenance makes this precedence survive pauses and equal timestamps.
export function protectCounts(
  previous: StoredRepository | undefined,
  next: Observation,
): Observation {
  const protectedSample =
    previous?.isPublic === true &&
    next.isPublic === true &&
    previous.countsScanId !== undefined &&
    previous.countsScanId === next.countsScanId &&
    previous.countsSource === "repository" &&
    next.countsSource !== "repository";
  if (!protectedSample) return next;
  // merge() ignores older metadata. Do not copy a newer sample into an earlier
  // observation timestamp, and do not let its lower-authority metric backfill.
  if (previous.observedAt > next.observedAt) return { ...next, countsMeasured: false };
  return retainCounts(next, previous);
}

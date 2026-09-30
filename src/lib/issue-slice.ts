export const FRESH_LIMIT = 40;

export function emptySliceMessage(
  sliceCount: number,
  shownCount: number,
  filtered: boolean,
  untouched: string,
) {
  if (filtered && sliceCount > 0 && shownCount === 0) return "В этом треке пусто.";
  return untouched;
}

export type TimelineEvent = {
  event?: string;
  source?: {
    issue?: {
      pull_request?: { merged_at?: string | null } | null;
    } | null;
  } | null;
};

/** A cross-reference counts only when the pull request was merged. */
export function issueClosedByMergedPull(events: readonly TimelineEvent[]) {
  return events.some((event) => {
    if (event.event !== "cross-referenced") return false;
    const mergedAt = event.source?.issue?.pull_request?.merged_at;
    return typeof mergedAt === "string" && mergedAt.length > 0;
  });
}

export function freshSliceCaption(
  shown: number,
  total: number | null | undefined,
): string | null {
  if (total == null || !Number.isFinite(total) || total <= shown) return null;
  return `${shown} свежих из ${total}`;
}

export function splitWork<T extends { isPr: boolean }>(items: readonly T[]) {
  return {
    issues: items.filter((item) => !item.isPr),
    pullRequests: items.filter((item) => item.isPr),
  };
}

export type ClosingPr = { merged?: boolean | null };

export function withoutMergedFixes<
  T extends { isPr: boolean; closingPrs?: ClosingPr[] | null },
>(items: readonly T[], lookupFailed: boolean) {
  if (lookupFailed) return { items: [...items], filterSkipped: true };
  return {
    filterSkipped: false,
    items: items.filter(
      (item) => item.isPr || !item.closingPrs?.some((pr) => pr.merged),
    ),
  };
}

export function mergedIssueNumbers(
  repository: Record<
    string,
    {
      number?: number | null;
      closedByPullRequestsReferences?: {
        nodes?: ({ merged?: boolean | null } | null)[] | null;
      } | null;
    } | null
  > | null,
) {
  const merged = new Set<number>();
  if (!repository) return merged;
  for (const node of Object.values(repository)) {
    if (!node?.number) continue;
    const fixed = node.closedByPullRequestsReferences?.nodes?.some(
      (pr) => pr?.merged,
    );
    if (fixed) merged.add(node.number);
  }
  return merged;
}

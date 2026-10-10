import type { ResearchReport } from "./types.ts";

export const FRESH_OPEN_MS = 15 * 60 * 1000;
export const FRESH_TERMINAL_MS = 6 * 60 * 60 * 1000;
export const FRESH_RETRY_MS = 2 * 60 * 1000;
export const WATCH_CALL_BUDGET = 6;
export const WATCH_FETCH_MS = 4_000;

export type GithubKind = "issue" | "pull";
export type GithubState = "unknown" | "open" | "closed" | "merged";
export type GithubReview = "changes_requested" | "approved" | "unknown" | null;
export type GithubError = "unavailable" | "rate" | "private" | null;
export type FactKind =
  | "comments"
  | "changes_requested"
  | "approved"
  | "merged"
  | "closed"
  | "reopened";

export type GithubCoord = {
  kind: GithubKind;
  owner: string;
  repo: string;
  number: number;
};

export type SubjectRow = GithubCoord & {
  id: string;
  nodeId: string | null;
  authorLogin: string | null;
  title: string | null;
  htmlUrl: string | null;
  isPublic: boolean | null;
  state: GithubState;
  draft: boolean;
  review: GithubReview;
  commentCount: number | null;
  checkedAt: number | null;
  error: GithubError;
  closingKnown: boolean;
  closingPrs: { number: number; merged: boolean }[];
};

export type FactDraft = { kind: FactKind; detail: string; at: number };

export type ObservedSubject = GithubCoord & {
  nodeId: string;
  authorLogin: string | null;
  title: string | null;
  htmlUrl: string | null;
  state: Exclude<GithubState, "unknown">;
  draft: boolean;
  review: GithubReview;
  commentCount: number | null;
  closingPrs?: { number: number; merged: boolean }[];
};

export type FetchResult =
  | { type: "ok"; observed: ObservedSubject }
  | { type: "private" }
  | { type: "unavailable" }
  | { type: "rate" };

export type GithubCard = {
  kind: GithubKind;
  owner: string;
  repo: string;
  number: number;
  title: string | null;
  href: string | null;
  visibility: "public" | "hidden" | "unknown";
  state: GithubState;
  draft: boolean;
  review: GithubReview;
  byResearcher: boolean;
  fixedByResearcher: boolean;
  checkedAt: number | null;
  stale: boolean;
  facts: { kind: FactKind; at: number }[];
};

export type GithubHistory = {
  source: GithubCard | null;
  links: GithubCard[];
};

export type WatchRun = {
  id: string;
  owner: string;
  repo: string;
  number: number;
  isPr: boolean;
  publishedAt: number | null;
  status: string;
  report: ResearchReport | null;
};

export type PlannedLink = GithubCoord & {
  relation: "source" | "linked";
  url: string;
};

const EMPTY_CLOSING: SubjectRow["closingPrs"] = [];

export function emptySubject(id: string, coord: GithubCoord): SubjectRow {
  return {
    id,
    nodeId: null,
    ...coord,
    authorLogin: null,
    title: null,
    htmlUrl: null,
    isPublic: null,
    state: "unknown",
    draft: false,
    review: null,
    commentCount: null,
    checkedAt: null,
    error: null,
    closingKnown: false,
    closingPrs: EMPTY_CLOSING,
  };
}

export function parseGithubLink(raw: string): GithubCoord | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 4) return null;
  const [owner, repo, section, num] = parts;
  if (!owner || !repo || !section || !num) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
  if (section !== "pull" && section !== "issues") return null;
  if (!/^[1-9]\d*$/.test(num)) return null;
  return {
    kind: section === "pull" ? "pull" : "issue",
    owner,
    repo,
    number: Number(num),
  };
}

export function coordKey(coord: GithubCoord) {
  return `${coord.kind}:${coord.owner.toLowerCase()}/${coord.repo.toLowerCase()}#${coord.number}`;
}

export function loginsMatch(left: string | null, right: string | null) {
  if (!left?.trim() || !right?.trim()) return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function canonicalUrl(coord: GithubCoord) {
  const section = coord.kind === "pull" ? "pull" : "issues";
  return `https://github.com/${coord.owner}/${coord.repo}/${section}/${coord.number}`;
}

export function planBindings(run: WatchRun): PlannedLink[] {
  if (run.publishedAt == null || run.status !== "completed" || run.report == null) return [];
  const source: PlannedLink = {
    relation: "source",
    kind: run.isPr ? "pull" : "issue",
    owner: run.owner,
    repo: run.repo,
    number: run.number,
    url: canonicalUrl({
      kind: run.isPr ? "pull" : "issue",
      owner: run.owner,
      repo: run.repo,
      number: run.number,
    }),
  };
  const seen = new Set([coordKey(source)]);
  const linked: PlannedLink[] = [];
  for (const link of run.report.links) {
    const parsed = parseGithubLink(link.url);
    if (!parsed) continue;
    const key = coordKey(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    linked.push({ relation: "linked", url: link.url, ...parsed });
  }
  return [source, ...linked];
}

export type ReviewInput = { login: string; state: string; submittedAt: string };

export function foldReviews(reviews: readonly ReviewInput[], truncated: boolean): GithubReview {
  if (truncated) return "unknown";
  const latest = new Map<string, string>();
  const ordered = [...reviews].sort((a, b) =>
    a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : 0,
  );
  for (const review of ordered) {
    const login = review.login.trim().toLowerCase();
    if (!login) continue;
    if (review.state === "DISMISSED") {
      latest.delete(login);
      continue;
    }
    if (
      review.state === "APPROVED" ||
      review.state === "CHANGES_REQUESTED" ||
      review.state === "COMMENTED"
    ) {
      latest.set(login, review.state);
    }
  }
  const states = [...latest.values()];
  if (states.includes("CHANGES_REQUESTED")) return "changes_requested";
  if (states.includes("APPROVED")) return "approved";
  return null;
}

export function shouldRefresh(row: SubjectRow, now: number, pausedUntil: number) {
  if (pausedUntil > now) return false;
  if (row.checkedAt == null) return true;
  const age = now - row.checkedAt;
  if (row.error) return age >= FRESH_RETRY_MS;
  if (row.isPublic === false) return age >= FRESH_TERMINAL_MS;
  if (row.state === "merged" || row.state === "closed") return age >= FRESH_TERMINAL_MS;
  return age >= FRESH_OPEN_MS;
}

export function fixedByResearcher(input: {
  kind: GithubKind;
  explicitlyLinked: boolean;
  byResearcher: boolean;
  state: GithubState;
  prNumber: number;
  closing: readonly { number: number; merged: boolean }[] | null;
}) {
  if (input.kind !== "pull" || !input.explicitlyLinked || !input.byResearcher) return false;
  if (input.state !== "merged" || input.closing == null) return false;
  return input.closing.some((pr) => pr.number === input.prNumber && pr.merged);
}

export function mergeObservation(
  prev: SubjectRow,
  result: FetchResult,
  at: number,
): { row: SubjectRow; facts: FactDraft[] } {
  if (result.type === "rate") {
    return { row: { ...prev, checkedAt: at, error: "rate" }, facts: [] };
  }
  if (result.type === "unavailable") {
    return { row: { ...prev, checkedAt: at, error: "unavailable" }, facts: [] };
  }
  if (result.type === "private") {
    return {
      row: {
        ...prev,
        title: null,
        htmlUrl: null,
        isPublic: false,
        checkedAt: at,
        error: "private",
        authorLogin: null,
      },
      facts: [],
    };
  }

  const observed = result.observed;
  let state: GithubState = observed.state;
  if (prev.state === "merged" && state !== "merged") state = "merged";
  const closingKnown = observed.closingPrs != null ? true : prev.closingKnown;
  const closingPrs = observed.closingPrs ?? prev.closingPrs;
  const row: SubjectRow = {
    ...prev,
    nodeId: observed.nodeId || prev.nodeId,
    kind: observed.kind,
    owner: observed.owner,
    repo: observed.repo,
    number: observed.number,
    authorLogin: observed.authorLogin,
    title: observed.title,
    htmlUrl: observed.htmlUrl,
    isPublic: true,
    state,
    draft: observed.draft,
    review: observed.review,
    commentCount: observed.commentCount,
    checkedAt: at,
    error: null,
    closingKnown,
    closingPrs,
  };
  return { row, facts: transitionFacts(prev, row, observed.review, at) };
}

function transitionFacts(
  prev: SubjectRow,
  next: SubjectRow,
  observedReview: GithubReview,
  at: number,
): FactDraft[] {
  const facts: FactDraft[] = [];
  const first = prev.checkedAt == null || prev.isPublic !== true;
  if (
    next.commentCount != null &&
    prev.commentCount != null &&
    prev.isPublic === true &&
    next.commentCount > prev.commentCount
  ) {
    facts.push({ kind: "comments", detail: String(next.commentCount), at });
  }
  if (observedReview === "changes_requested" && (first || prev.review !== "changes_requested")) {
    facts.push({ kind: "changes_requested", detail: `changes:${at}`, at });
  }
  if (observedReview === "approved" && (first || prev.review !== "approved")) {
    facts.push({ kind: "approved", detail: `approved:${at}`, at });
  }
  if (next.state === "merged" && (first || prev.state !== "merged")) {
    facts.push({ kind: "merged", detail: "merged", at });
  }
  if (next.state === "closed" && (first || (prev.state !== "closed" && prev.state !== "merged"))) {
    facts.push({ kind: "closed", detail: `closed:${at}`, at });
  }
  if (next.state === "open" && prev.isPublic === true && prev.state === "closed") {
    facts.push({ kind: "reopened", detail: `reopened:${at}`, at });
  }
  return facts;
}

export function githubStateLabel(
  card: Pick<GithubCard, "kind" | "state" | "draft" | "review" | "visibility" | "facts">,
): string | null {
  if (card.visibility !== "public" || card.state === "unknown") return null;
  if (card.kind === "issue") {
    if (card.state === "closed" || card.state === "merged") return "закрыта";
    return card.state === "open" ? "открыта" : null;
  }
  if (card.state === "merged") return "влит";
  if (card.state === "closed") return "закрыт без merge";
  if (card.review === "changes_requested") return "запрошены правки";
  if (card.review === "approved") return "одобрен";
  if (card.draft) return "черновик";
  if (card.state === "open" && card.facts.some((fact) => fact.kind === "reopened")) {
    return "открыт снова";
  }
  return card.state === "open" ? "открыт" : null;
}

export function subjectCard(
  subject: SubjectRow,
  input: {
    researcherLogin: string;
    explicitlyLinked: boolean;
    closing: readonly { number: number; merged: boolean }[] | null;
    facts: readonly { kind: FactKind; at: number }[];
  },
): GithubCard {
  const hidden = subject.isPublic === false;
  const byResearcher = loginsMatch(subject.authorLogin, input.researcherLogin);
  return {
    kind: subject.kind,
    owner: subject.owner,
    repo: subject.repo,
    number: subject.number,
    title: hidden ? null : subject.title,
    href: hidden ? null : subject.htmlUrl,
    visibility: hidden ? "hidden" : subject.isPublic ? "public" : "unknown",
    state: hidden ? "unknown" : subject.state,
    draft: hidden ? false : subject.draft,
    review: hidden ? null : subject.review,
    byResearcher,
    fixedByResearcher: hidden
      ? false
      : fixedByResearcher({
          kind: subject.kind,
          explicitlyLinked: input.explicitlyLinked,
          byResearcher,
          state: subject.state,
          prNumber: subject.number,
          closing: input.closing,
        }),
    checkedAt: subject.checkedAt,
    stale: !hidden && (subject.error === "unavailable" || subject.error === "rate"),
    facts: hidden ? [] : input.facts.map((fact) => ({ kind: fact.kind, at: fact.at })),
  };
}

export function emptyHistory(): GithubHistory {
  return { source: null, links: [] };
}

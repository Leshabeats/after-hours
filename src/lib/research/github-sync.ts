import {
  foldReviews,
  mergeObservation,
  parseGithubLink,
  WATCH_CALL_BUDGET,
  WATCH_FETCH_MS,
  type FetchResult,
  type GithubCoord,
  type GithubReview,
  type ObservedSubject,
  type ReviewInput,
  type SubjectRow,
} from "./github-watch.ts";
import type { WatchRun } from "./github-watch.ts";
import type { WatchBook } from "./watch-book.ts";

export type WatchReader = {
  book: WatchBook;
  runs(runIds: readonly string[]): { run: WatchRun; researcherLogin: string }[];
};

let pausedUntil = 0;

export function githubPausedUntil() {
  return pausedUntil;
}

export function resetGithubPause() {
  pausedUntil = 0;
}

function headers() {
  const value: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "after-hours-oss",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) value.Authorization = `Bearer ${token}`;
  return value;
}

function pause(until: number) {
  if (until > pausedUntil) pausedUntil = until;
}

async function request(
  url: string,
  fetchImpl: typeof fetch,
  now: number,
): Promise<{ res: Response } | { result: FetchResult; until?: number }> {
  try {
    const res = await fetchImpl(url, {
      headers: headers(),
      redirect: "follow",
      signal: AbortSignal.timeout(WATCH_FETCH_MS),
    });
    if (res.status === 404 || res.status === 401) return { result: { type: "private" } };
    if (res.status === 403) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      const body = await res.text();
      if (remaining === "0" || /rate limit/i.test(body)) {
        const reset = res.headers.get("x-ratelimit-reset");
        const until = reset && /^\d+$/.test(reset) ? Number(reset) * 1000 : now + 60_000;
        return { result: { type: "rate" }, until };
      }
      return { result: { type: "unavailable" } };
    }
    if (!res.ok) return { result: { type: "unavailable" } };
    return { res };
  } catch {
    return { result: { type: "unavailable" } };
  }
}

function parseApiCoord(raw: string): GithubCoord | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.hostname !== "api.github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 5 || parts[0] !== "repos") return null;
  const owner = parts[1];
  const repo = parts[2];
  const section = parts[3];
  const num = parts[4];
  if (!owner || !repo || !section || !num) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
  if (section !== "issues" && section !== "pulls") return null;
  if (!/^[1-9]\d*$/.test(num)) return null;
  return {
    kind: section === "pulls" ? "pull" : "issue",
    owner,
    repo,
    number: Number(num),
  };
}

function coordFrom(finalUrl: string, htmlUrl: unknown, fallback: GithubCoord): GithubCoord {
  const fromHtml = typeof htmlUrl === "string" ? parseGithubLink(htmlUrl) : null;
  const parsed = fromHtml ?? parseApiCoord(finalUrl);
  if (!parsed) return fallback;
  const kind = fallback.kind === "pull" || parsed.kind === "pull" ? "pull" : "issue";
  return { kind, owner: parsed.owner, repo: parsed.repo, number: parsed.number };
}

function asState(value: unknown, merged: boolean): ObservedSubject["state"] {
  if (merged) return "merged";
  return value === "closed" ? "closed" : "open";
}

export async function refreshWatch(
  reader: WatchReader,
  runIds: readonly string[],
  now = Date.now(),
  fetchImpl: typeof fetch = fetch,
) {
  const runs = reader.runs(runIds);
  for (const item of runs) reader.book.bind(item.run);
  let calls = 0;
  const due = reader.book.due(runIds, now, pausedUntil);
  const refreshed = new Set<string>();
  const take = () => {
    if (calls >= WATCH_CALL_BUDGET) return false;
    calls += 1;
    return true;
  };
  for (const subject of due) {
    if (calls >= WATCH_CALL_BUDGET || pausedUntil > now) break;
    let outcome: ReadOutcome;
    try {
      outcome = await readSubject(subject, fetchImpl, now, take);
    } catch {
      outcome = { result: { type: "unavailable" } };
    }
    if ("skipped" in outcome) continue;
    if (outcome.until) pause(outcome.until);
    const prev = reader.book.read(subject.id);
    if (!prev) continue;
    const merged = mergeObservation(prev, outcome.result, now);
    reader.book.apply(subject.id, merged.row, merged.facts);
    if (outcome.result.type === "ok") refreshed.add(merged.row.id);
    if (outcome.result.type === "rate") break;
  }
  if (!process.env.GITHUB_TOKEN?.trim() || calls >= WATCH_CALL_BUDGET || pausedUntil > now) return;
  const logins = runs.map((item) => ({ id: item.run.id, researcherLogin: item.researcherLogin }));
  const seenSources = new Set<string>();
  for (const source of reader.book.closingSources(logins)) {
    if (seenSources.has(source.id)) continue;
    seenSources.add(source.id);
    if (calls >= WATCH_CALL_BUDGET || pausedUntil > now) break;
    if (source.closingKnown && !refreshed.has(source.id)) continue;
    if (!take()) break;
    const closing = await readClosing(source, fetchImpl, now);
    if (closing.until) pause(closing.until);
    if (closing.prs) reader.book.saveClosing(source.id, closing.prs);
  }
}

type ReadOutcome = { result: FetchResult; until?: number } | { skipped: true };

async function readSubject(
  subject: SubjectRow,
  fetchImpl: typeof fetch,
  now: number,
  take: () => boolean,
): Promise<ReadOutcome> {
  const root = `https://api.github.com/repos/${encodeURIComponent(subject.owner)}/${encodeURIComponent(subject.repo)}`;
  if (subject.kind === "issue") {
    if (!take()) return { skipped: true };
    const got = await request(`${root}/issues/${subject.number}`, fetchImpl, now);
    if ("result" in got) return got;
    const json = (await got.res.json()) as Record<string, unknown>;
    if (json.pull_request) {
      const upgraded = await readPull(root, subject, fetchImpl, now, take);
      if ("skipped" in upgraded) return { result: observedIssue(json, got.res.url, subject, true) };
      return upgraded;
    }
    return { result: observedIssue(json, got.res.url, subject, false) };
  }
  return readPull(root, subject, fetchImpl, now, take);
}

async function readPull(
  root: string,
  subject: SubjectRow,
  fetchImpl: typeof fetch,
  now: number,
  take: () => boolean,
): Promise<ReadOutcome> {
  if (!take()) return { skipped: true };
  const got = await request(`${root}/pulls/${subject.number}`, fetchImpl, now);
  if ("result" in got) return got;
  const json = (await got.res.json()) as Record<string, unknown>;
  let review: GithubReview = null;
  if (take()) {
    const reviews = await request(
      `${root}/pulls/${subject.number}/reviews?per_page=100`,
      fetchImpl,
      now,
    );
    if ("result" in reviews) {
      if (reviews.until) pause(reviews.until);
      if (reviews.result.type === "rate") {
        return { result: observedPull(json, got.res.url, subject, null), until: reviews.until };
      }
    } else {
      const list = (await reviews.res.json()) as {
        user?: { login?: string };
        state?: string;
        submitted_at?: string;
      }[];
      const truncated = reviews.res.headers.get("link")?.includes('rel="next"') ?? false;
      const input: ReviewInput[] = list.flatMap((item) =>
        item.user?.login && item.state
          ? [{ login: item.user.login, state: item.state, submittedAt: item.submitted_at ?? "" }]
          : [],
      );
      review = foldReviews(input, truncated);
    }
  }
  return { result: observedPull(json, got.res.url, subject, review) };
}

function observedIssue(
  json: Record<string, unknown>,
  finalUrl: string,
  fallback: GithubCoord,
  asPull: boolean,
): FetchResult {
  const nodeId = typeof json.node_id === "string" ? json.node_id : "";
  if (!nodeId) return { type: "unavailable" };
  const user = json.user as { login?: string } | null;
  const pull = json.pull_request as { merged_at?: string | null } | undefined;
  const coord = coordFrom(finalUrl, json.html_url, asPull ? { ...fallback, kind: "pull" } : fallback);
  const merged = Boolean(pull?.merged_at);
  return {
    type: "ok",
    observed: {
      nodeId,
      kind: asPull ? "pull" : "issue",
      owner: coord.owner,
      repo: coord.repo,
      number: coord.number,
      authorLogin: user?.login ?? null,
      title: typeof json.title === "string" ? json.title : null,
      htmlUrl: typeof json.html_url === "string" ? json.html_url : null,
      state: asPull ? asState(json.state, merged) : json.state === "closed" ? "closed" : "open",
      draft: false,
      review: null,
      commentCount: typeof json.comments === "number" ? json.comments : null,
    },
  };
}

function observedPull(
  json: Record<string, unknown>,
  finalUrl: string,
  fallback: GithubCoord,
  review: GithubReview,
): FetchResult {
  const nodeId = typeof json.node_id === "string" ? json.node_id : "";
  if (!nodeId) return { type: "unavailable" };
  const user = json.user as { login?: string } | null;
  const coord = coordFrom(finalUrl, json.html_url, { ...fallback, kind: "pull" });
  return {
    type: "ok",
    observed: {
      nodeId,
      kind: "pull",
      owner: coord.owner,
      repo: coord.repo,
      number: coord.number,
      authorLogin: user?.login ?? null,
      title: typeof json.title === "string" ? json.title : null,
      htmlUrl: typeof json.html_url === "string" ? json.html_url : null,
      state: asState(json.state, json.merged === true),
      draft: json.draft === true,
      review,
      commentCount: typeof json.comments === "number" ? json.comments : null,
    },
  };
}

async function readClosing(
  source: { owner: string; repo: string; number: number },
  fetchImpl: typeof fetch,
  now: number,
): Promise<{ prs?: { number: number; merged: boolean }[]; until?: number }> {
  const query = `query($owner:String!,$repo:String!,$number:Int!){
    repository(owner:$owner, name:$repo) {
      issue(number:$number) {
        closedByPullRequestsReferences(first:100, includeClosedPrs:true) {
          nodes { number merged }
        }
      }
    }
  }`;
  try {
    const res = await fetchImpl("https://api.github.com/graphql", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { owner: source.owner, repo: source.repo, number: source.number },
      }),
      signal: AbortSignal.timeout(WATCH_FETCH_MS),
    });
    if (res.status === 403) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining === "0") {
        const reset = res.headers.get("x-ratelimit-reset");
        const until = reset && /^\d+$/.test(reset) ? Number(reset) * 1000 : now + 60_000;
        return { until };
      }
    }
    if (!res.ok) return {};
    const json = (await res.json()) as {
      data?: {
        repository?: {
          issue?: {
            closedByPullRequestsReferences?: {
              nodes?: ({ number?: number | null; merged?: boolean | null } | null)[] | null;
            } | null;
          } | null;
        } | null;
      };
      errors?: unknown[];
    };
    if (json.errors?.length || !json.data?.repository?.issue) return {};
    const nodes = json.data.repository.issue.closedByPullRequestsReferences?.nodes ?? [];
    return {
      prs: nodes.flatMap((node) =>
        typeof node?.number === "number" ? [{ number: node.number, merged: Boolean(node.merged) }] : [],
      ),
    };
  } catch {
    return {};
  }
}

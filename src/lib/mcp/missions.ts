import { z } from "zod";
import { parseGithubRef, missionId } from "../kinds.ts";
import { worldProjects, parseCategoryId, type CategoryId } from "../catalog.ts";
import { describeResearchIssue } from "../discovery/issues.ts";
import { readOssLicense } from "../discovery/license.ts";
import { indexedIssues } from "../discovery/presentation.ts";
import { readWorldDiscovery } from "../discovery/read.ts";
import { FORK_EXCEPTIONS } from "../discovery/ranking.ts";
import {
  DISCOVERY_WORLD_IDS,
  isDiscoveryWorld,
  type DiscoveryMode,
  type DiscoveryWorld,
} from "../discovery/types.ts";

export const missionRef = z
  .string()
  .trim()
  .max(160)
  .refine((value) => !!parseGithubRef(value), "Expected owner/repo#number");
export type PublicMission = {
  missionId: string;
  owner: string;
  repo: string;
  number: number;
  isPr: boolean;
  title: string;
  body: string;
  url: string;
};
class GitHubRateLimitError extends Error {}
class GitHubUnavailableError extends Error {
  constructor() {
    super("Public GitHub data is unavailable. Retry later.");
  }
}
type RepositoryMetadata = {
  private?: boolean;
  visibility?: string;
  id?: number;
  archived?: boolean;
  disabled?: boolean;
  fork?: boolean;
  mirror_url?: string | null;
  size?: number;
  license?: unknown;
};

async function github(path: string, fetchImpl: typeof fetch) {
  // Deliberately anonymous: site credentials must never broaden public MCP reads.
  let response: Response;
  try {
    response = await fetchImpl("https://api.github.com" + path, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "after-hours-mcp" },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
  } catch {
    throw new GitHubUnavailableError();
  }
  const retry = response.headers.get("retry-after");
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (response.status === 429 || (response.status === 403 && (retry || remaining === "0"))) {
    const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
    const wait = retry && /^\d+$/.test(retry) ? Number(retry) : 0;
    const seconds = Math.max(wait, remaining === "0" ? Math.ceil((reset - Date.now()) / 1000) : 0);
    throw new GitHubRateLimitError(
      seconds > 0
        ? `Public GitHub rate limit. Retry in ${seconds} seconds.`
        : "Public GitHub rate limit. Retry in a minute.",
    );
  }
  if (response.status >= 500 || response.status === 403 || response.status === 401)
    throw new GitHubUnavailableError();
  if (!response.ok) throw new Error("Public GitHub data is unavailable. Retry later.");
  try {
    return await response.json();
  } catch {
    throw new GitHubUnavailableError();
  }
}

async function verifyPublicRepo(root: string, fetchImpl: typeof fetch) {
  const metadata: RepositoryMetadata = await github(root, fetchImpl);
  if (
    metadata.private !== false ||
    (metadata.visibility !== undefined && metadata.visibility !== "public")
  )
    throw new Error("Only explicitly public repositories are supported.");
  return metadata;
}

async function loadPublicMission(
  raw: string,
  fetchImpl: typeof fetch,
  verify: (root: string, fetchImpl: typeof fetch) => Promise<RepositoryMetadata>,
  selection?: { repoId?: string },
): Promise<PublicMission> {
  const ref = parseGithubRef(raw);
  if (!ref) throw new Error("Invalid mission.");
  const root = "/repos/" + encodeURIComponent(ref.owner) + "/" + encodeURIComponent(ref.repo);
  const metadata = await verify(root, fetchImpl);
  if (
    selection &&
    (metadata.archived !== false ||
      metadata.disabled === true ||
      metadata.mirror_url ||
      metadata.size === 0 ||
      (metadata.fork === true && !FORK_EXCEPTIONS.has(`${ref.owner}/${ref.repo}`.toLowerCase())) ||
      !readOssLicense(metadata.license) ||
      (selection.repoId !== undefined && String(metadata.id) !== selection.repoId))
  )
    throw new Error("Repository does not qualify for discovery.");
  const item = await github(root + "/issues/" + ref.number, fetchImpl);
  // Reject transfers or inconsistent payloads rather than expose another repository's body.
  if (
    String(item.repository_url).toLowerCase() !== ("https://api.github.com" + root).toLowerCase() ||
    item.number !== ref.number ||
    typeof item.title !== "string"
  )
    throw new Error("Mission identity changed. Open the canonical GitHub URL.");
  if (selection) {
    const labels = Array.isArray(item.labels)
      ? item.labels.flatMap((label: unknown) => {
          const parsed = z.object({ name: z.string() }).safeParse(label);
          return parsed.success ? [parsed.data.name] : [];
        })
      : [];
    if (
      item.state !== "open" ||
      item.pull_request ||
      item.assignee ||
      (Array.isArray(item.assignees) && item.assignees.length > 0) ||
      !describeResearchIssue(item.title, typeof item.body === "string" ? item.body : "", labels)
    )
      throw new Error("Issue no longer qualifies for discovery.");
  }
  return {
    missionId: missionId(ref.owner, ref.repo, ref.number),
    ...ref,
    isPr: !!item.pull_request,
    title: item.title,
    body: String(item.body ?? "").slice(0, 8000),
    url: `https://github.com/${ref.owner}/${ref.repo}/${item.pull_request ? "pull" : "issues"}/${ref.number}`,
  };
}

// Writes always verify visibility against GitHub, independently of read traffic.
export function publicMission(raw: string, fetchImpl: typeof fetch = fetch) {
  return loadPublicMission(raw, fetchImpl, verifyPublicRepo);
}

// Cache only successful repository checks for read tools. Issue bodies and identities
// are always fetched anonymously and redirects are still rejected.
export function createPublicMissionReader(fetchImpl: typeof fetch, now = Date.now) {
  const checks = new Map<string, { expires: number; pending: Promise<RepositoryMetadata> }>();
  return (raw: string, selection?: { repoId?: string }) =>
    loadPublicMission(
      raw,
      fetchImpl,
      (root) => {
        const key = root.toLowerCase();
        const cached = checks.get(key);
        if (cached && cached.expires > now()) return cached.pending;
        checks.delete(key);
        if (checks.size >= 128) checks.delete(checks.keys().next().value!);
        const entry = { expires: now() + 30_000, pending: verifyPublicRepo(root, fetchImpl) };
        checks.set(key, entry);
        void entry.pending.catch(() => {
          if (checks.get(key) === entry) checks.delete(key);
        });
        return entry.pending;
      },
      selection,
    );
}

export const readPublicMission = createPublicMissionReader((input, init) => fetch(input, init));

export const findInput = {
  category: z.enum(["web", "stars", "linux", "ai", "games", "data"]).optional(),
  language: z
    .string()
    .regex(/^[A-Za-z0-9#+.-]{1,30}$/)
    .optional(),
  limit: z.number().int().min(1).max(10).default(5),
  tag: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/)
    .optional(),
  view: z.enum(["all", "new", "discovered", "active", "growing"]).optional(),
};

type FindMissionsInput = {
  category?: string;
  language?: string;
  limit: number;
  tag?: string;
  view?: DiscoveryMode;
};

async function getIndexedOptions(
  input: FindMissionsInput,
  category: CategoryId | undefined,
  load: typeof readWorldDiscovery,
) {
  const worlds =
    category && isDiscoveryWorld(category)
      ? [category]
      : (Object.keys(DISCOVERY_WORLD_IDS) as DiscoveryWorld[]);
  const snapshots = await Promise.all(worlds.map(load));
  const now = Date.now();
  const stars =
    category === "stars"
      ? new Set(worldProjects("stars").map((r) => `${r.owner}/${r.repo}`.toLowerCase()))
      : null;
  const options = snapshots
    .flatMap((snapshot, index) =>
      snapshot.issuesIndexed
        ? indexedIssues(
            snapshot.cards,
            { cat: worlds[index], lang: input.language, tag: input.tag, view: input.view },
            now,
          )
        : [],
    )
    .filter((issue) => !stars || stars.has(`${issue.owner}/${issue.repo}`.toLowerCase()));
  options.sort((a, b) => a.rank - b.rank || b.checkedAt - a.checkedAt);
  const seen = new Set<string>();
  const candidates = options.flatMap((issue) => {
    const ref = missionId(issue.owner, issue.repo, issue.number);
    const key = ref.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ref, repoId: issue.repoId }];
  });
  // Stars also keeps its current curated GitHub fallback when its projects
  // have no indexed issues. A published-empty discovery world stays empty.
  return { candidates, indexed: !stars && snapshots.some((snapshot) => snapshot.issuesIndexed) };
}

export async function findMissions(
  input: FindMissionsInput,
  fetchImpl?: typeof fetch,
  load = fetchImpl ? undefined : readWorldDiscovery,
) {
  const category = input.category ? parseCategoryId(input.category) : undefined;
  const indexed = load ? await getIndexedOptions(input, category, load) : null;
  let candidates: { ref: string; repoId?: string }[] = indexed?.candidates ?? [];
  if (
    !candidates.length &&
    !indexed?.indexed &&
    !input.tag &&
    (!input.view || input.view === "all")
  ) {
    const repositories = category ? worldProjects(category) : [];
    const query = [
      "is:public",
      "is:issue",
      "is:open",
      "archived:false",
      ...repositories.map((r) => `repo:${r.owner}/${r.repo}`),
      ...(input.language ? ["language:" + input.language] : []),
    ].join(" ");
    const result = await github(
      "/search/issues?per_page=" +
        input.limit +
        "&sort=updated&order=desc&q=" +
        encodeURIComponent(query),
      fetchImpl ?? fetch,
    );
    candidates = (Array.isArray(result.items) ? result.items : []).flatMap(
      (item: { html_url?: unknown }) =>
        typeof item.html_url === "string" ? [{ ref: item.html_url }] : [],
    );
  }
  // Search and snapshot references both need a current public repository and an open issue.
  const read = createPublicMissionReader(fetchImpl ?? fetch);
  const check = (start: number, count: number) =>
    Promise.allSettled(
      candidates.slice(start, start + count).map(({ ref, repoId }) => read(ref, { repoId })),
    );
  const missions: PublicMission[] = [];
  // Allow one bounded replacement batch for candidates that changed since publication.
  for (const start of [0, input.limit]) {
    const missing = input.limit - missions.length;
    if (!missing || start >= candidates.length) break;
    const settled = await check(start, missing);
    for (const result of settled) {
      if (result.status === "fulfilled") missions.push(result.value);
    }
    const errors = settled.flatMap((result) =>
      result.status === "rejected" ? [result.reason as unknown] : [],
    );
    const upstream =
      errors.find((error) => error instanceof GitHubRateLimitError) ??
      errors.find((error) => error instanceof GitHubUnavailableError);
    if (upstream) {
      if (missions.length === 0) throw upstream;
      break;
    }
  }
  return missions;
}

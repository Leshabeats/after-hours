import { z } from "zod";
import { parseGithubRef, missionId } from "../kinds.ts";
import { worldProjects, parseCategoryId } from "../catalog.ts";

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

async function github(path: string, fetchImpl: typeof fetch) {
  // Deliberately anonymous: site credentials must never broaden public MCP reads.
  const response = await fetchImpl("https://api.github.com" + path, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "after-hours-mcp" },
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
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
  if (!response.ok) throw new Error("Public GitHub data is unavailable. Retry later.");
  return response.json();
}

async function verifyPublicRepo(root: string, fetchImpl: typeof fetch) {
  const metadata = await github(root, fetchImpl);
  if (
    metadata.private !== false ||
    (metadata.visibility !== undefined && metadata.visibility !== "public")
  )
    throw new Error("Only explicitly public repositories are supported.");
}

async function loadPublicMission(
  raw: string,
  fetchImpl: typeof fetch,
  verify: (root: string, fetchImpl: typeof fetch) => Promise<void>,
): Promise<PublicMission> {
  const ref = parseGithubRef(raw);
  if (!ref) throw new Error("Invalid mission.");
  const root = "/repos/" + encodeURIComponent(ref.owner) + "/" + encodeURIComponent(ref.repo);
  await verify(root, fetchImpl);
  const item = await github(root + "/issues/" + ref.number, fetchImpl);
  // Reject transfers or inconsistent payloads rather than expose another repository's body.
  if (
    String(item.repository_url).toLowerCase() !== ("https://api.github.com" + root).toLowerCase() ||
    item.number !== ref.number ||
    typeof item.title !== "string"
  )
    throw new Error("Mission identity changed. Open the canonical GitHub URL.");
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
  const checks = new Map<string, { expires: number; pending: Promise<void> }>();
  return (raw: string) =>
    loadPublicMission(raw, fetchImpl, (root) => {
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
    });
}

export const readPublicMission = createPublicMissionReader((input, init) => fetch(input, init));

export const findInput = {
  category: z.enum(["web", "stars", "linux", "ai", "games", "data"]).optional(),
  language: z
    .string()
    .regex(/^[A-Za-z0-9#+.-]{1,30}$/)
    .optional(),
  limit: z.number().int().min(1).max(10).default(5),
};
export async function findMissions(
  input: { category?: string; language?: string; limit: number },
  fetchImpl?: typeof fetch,
) {
  const repositories = input.category ? worldProjects(parseCategoryId(input.category)) : [];
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
  // Recheck every returned repository and canonical identity; search is not a visibility receipt.
  const read = fetchImpl ? createPublicMissionReader(fetchImpl) : readPublicMission;
  const settled = await Promise.allSettled(
    (result.items ?? [])
      .slice(0, input.limit)
      .map((item: { html_url: string }) => read(item.html_url)),
  );
  const missions = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (missions.length === 0) {
    const rateLimited = settled.find(
      (r) => r.status === "rejected" && r.reason instanceof GitHubRateLimitError,
    );
    if (rateLimited?.status === "rejected") throw rateLimited.reason;
  }
  return missions;
}

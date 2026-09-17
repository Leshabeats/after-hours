import { SEED_MISSIONS, findSeed } from "@/lib/seed";
import {
  CATALOG_REPO_LIMIT,
  curatedRepos,
  hintLanguage,
  issueSearchQuery,
  repoSearchQuery,
  seedFits,
  type CategoryId,
  type LanguageId,
} from "@/lib/catalog";
import {
  classifyKind,
  decodeEntities,
  excerptOf,
  missionId,
  type Mission,
} from "@/lib/kinds";

const CACHE_MS = 12 * 60 * 1000;
const cache = new Map<
  string,
  { at: number; missions: Mission[]; live: boolean }
>();

type GhUser = { login?: string } | null;
type GhLabel = string | { name?: string };
type GhItem = {
  title?: string;
  number?: number;
  html_url?: string;
  body?: string | null;
  comments?: number;
  created_at?: string;
  updated_at?: string;
  pull_request?: unknown;
  labels?: GhLabel[];
  user?: GhUser;
  repository_url?: string;
};

export type CatalogQuery = {
  category: CategoryId;
  language?: LanguageId;
};

function cacheKey(query: CatalogQuery) {
  return `${query.category}|${query.language ?? ""}`;
}

function headers(): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "after-hours-oss",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function labelNames(labels: GhLabel[] | undefined): string[] {
  if (!labels) return [];
  return labels
    .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
    .filter(Boolean);
}

function isNoise(item: GhItem): boolean {
  const title = (item.title ?? "").toLowerCase();
  const user = (item.user?.login ?? "").toLowerCase();
  if (!item.title || !item.number) return true;
  if (user.includes("[bot]") || user.endsWith("bot")) return true;
  if (
    /dependency dashboard|version packages|chore\(deps\)|renovate/.test(title)
  ) {
    return true;
  }
  return false;
}

function parseRepo(
  item: GhItem,
  fallbackUrl: string,
): { owner: string; repo: string } {
  const fromApi = item.repository_url?.match(/repos\/([^/]+)\/([^/]+)$/);
  if (fromApi) return { owner: fromApi[1], repo: fromApi[2] };
  const fromHtml = fallbackUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (fromHtml) return { owner: fromHtml[1], repo: fromHtml[2] };
  return { owner: "unknown", repo: "unknown" };
}

function toMission(
  item: GhItem,
  live: boolean,
  language: string,
): Mission | null {
  if (isNoise(item) || !item.number || !item.title) return null;
  const isPr =
    Boolean(item.pull_request) || (item.html_url ?? "").includes("/pull/");
  const url =
    item.html_url ??
    `https://github.com/unknown/unknown/${isPr ? "pull" : "issues"}/${item.number}`;
  const { owner, repo } = parseRepo(item, url);
  const body = decodeEntities(item.body ?? "").slice(0, 8000);
  const labels = labelNames(item.labels);
  const createdAt = item.created_at ?? new Date().toISOString();
  return {
    id: missionId(owner, repo, item.number),
    owner,
    repo,
    number: item.number,
    title: decodeEntities(item.title),
    body,
    excerpt: excerptOf(body),
    url,
    labels,
    comments: item.comments ?? 0,
    updatedAt: item.updated_at ?? createdAt,
    createdAt,
    isPr,
    author: item.user?.login ?? "unknown",
    kind: classifyKind({ title: item.title, labels, isPr, createdAt }),
    language,
    live,
  };
}

async function searchIssues(q: string, perPage: number): Promise<GhItem[]> {
  const url = `https://api.github.com/search/issues?per_page=${perPage}&sort=updated&order=desc&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(`GitHub issue search ${res.status}`);
  }
  const json = (await res.json()) as { items?: GhItem[] };
  return json.items ?? [];
}

async function searchStarredRepos(q: string): Promise<string[]> {
  const url = `https://api.github.com/search/repositories?per_page=${CATALOG_REPO_LIMIT}&sort=stars&order=desc&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(`GitHub repo search ${res.status}`);
  }
  const json = (await res.json()) as { items?: { full_name?: string }[] };
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of json.items ?? []) {
    const name = item.full_name ?? "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

async function fetchLive(query: CatalogQuery): Promise<Mission[]> {
  const curated = curatedRepos(query.category);
  const repos = curated
    ? [...curated]
    : await searchStarredRepos(repoSearchQuery(query.category, query.language));
  if (repos.length === 0) return [];

  const issueLang = curated ? query.language : undefined;
  const items = await searchIssues(issueSearchQuery(repos, issueLang), 40);
  const language = hintLanguage(query.category, query.language);
  const mapped = items
    .map((item) => toMission(item, true, language))
    .filter((m): m is Mission => Boolean(m));

  const seen = new Set<string>();
  const unique: Mission[] = [];
  for (const m of mapped) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    unique.push(m);
  }
  unique.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return unique;
}

function fallback(query: CatalogQuery): {
  missions: Mission[];
  live: boolean;
} {
  if (seedFits(query.category, query.language)) {
    return { missions: SEED_MISSIONS, live: false };
  }
  return { missions: [], live: false };
}

export async function loadMissions(query: CatalogQuery): Promise<{
  missions: Mission[];
  live: boolean;
}> {
  const key = cacheKey(query);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return { missions: hit.missions, live: hit.live };
  }
  try {
    const live = await fetchLive(query);
    if (live.length >= 4) {
      const packed = { at: Date.now(), missions: live, live: true };
      cache.set(key, packed);
      return { missions: live, live: true };
    }
  } catch {
    // fall through
  }
  const packed = { at: Date.now(), ...fallback(query) };
  cache.set(key, packed);
  return packed;
}

export async function loadMission(
  owner: string,
  repo: string,
  number: number,
): Promise<Mission> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${number}`,
      { headers: headers() },
    );
    if (res.ok) {
      const item = (await res.json()) as GhItem;
      const mapped = toMission(item, true, "");
      if (mapped) return mapped;
    }
  } catch {
    // fall through
  }

  const seeded = findSeed(owner, repo, number);
  if (seeded) return seeded;

  return {
    id: missionId(owner, repo, number),
    owner,
    repo,
    number,
    title: `${owner}/${repo}#${number}`,
    body: "",
    excerpt: "Не удалось загрузить тело ишью. Открой на GitHub.",
    url: `https://github.com/${owner}/${repo}/issues/${number}`,
    labels: [],
    comments: 0,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    isPr: false,
    author: "",
    kind: "blinding",
    language: "",
    live: false,
  };
}

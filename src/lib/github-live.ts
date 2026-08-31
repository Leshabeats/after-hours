import { SEED_MISSIONS, findSeed } from "@/lib/seed";
import {
  classifyKind,
  decodeEntities,
  excerptOf,
  missionId,
  type Mission,
} from "@/lib/kinds";

const STACK = [
  "vitejs/vite",
  "TanStack/query",
  "TanStack/router",
  "tailwindlabs/tailwindcss",
  "facebook/react",
  "colinhacks/zod",
] as const;

const CACHE_MS = 12 * 60 * 1000;
let cache: { at: number; missions: Mission[]; live: boolean } | null = null;

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

function parseRepo(item: GhItem, fallbackUrl: string): { owner: string; repo: string } {
  const fromApi = item.repository_url?.match(/repos\/([^/]+)\/([^/]+)$/);
  if (fromApi) return { owner: fromApi[1], repo: fromApi[2] };
  const fromHtml = fallbackUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (fromHtml) return { owner: fromHtml[1], repo: fromHtml[2] };
  return { owner: "unknown", repo: "unknown" };
}

function toMission(item: GhItem, live: boolean): Mission | null {
  if (isNoise(item) || !item.number || !item.title) return null;
  const isPr = Boolean(item.pull_request) || (item.html_url ?? "").includes("/pull/");
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
    live,
  };
}

async function search(q: string, perPage: number): Promise<GhItem[]> {
  const url = `https://api.github.com/search/issues?per_page=${perPage}&sort=updated&order=desc&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(`GitHub search ${res.status}`);
  }
  const json = (await res.json()) as { items?: GhItem[] };
  return json.items ?? [];
}

function repoQuery(): string {
  return STACK.map((r) => `repo:${r}`).join(" ");
}

async function fetchLive(): Promise<Mission[]> {
  const base = repoQuery();
  const [issues, prs] = await Promise.all([
    search(`${base} is:open is:issue`, 30),
    search(`${base} is:open is:pr -is:draft`, 16),
  ]);
  const mapped = [...issues, ...prs]
    .map((item) => toMission(item, true))
    .filter((m): m is Mission => Boolean(m));

  const seen = new Set<string>();
  const unique: Mission[] = [];
  for (const m of mapped) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    unique.push(m);
  }
  unique.sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
  return unique;
}

export async function loadMissions(): Promise<{
  missions: Mission[];
  live: boolean;
}> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return { missions: cache.missions, live: cache.live };
  }
  try {
    const live = await fetchLive();
    if (live.length >= 8) {
      cache = { at: Date.now(), missions: live, live: true };
      return { missions: live, live: true };
    }
  } catch {
    // fall through to seed
  }
  cache = { at: Date.now(), missions: SEED_MISSIONS, live: false };
  return { missions: SEED_MISSIONS, live: false };
}

export async function loadMission(
  owner: string,
  repo: string,
  number: number,
): Promise<Mission> {
  const catalog = await loadMissions();
  const fromCatalog = catalog.missions.find(
    (m) =>
      m.owner.toLowerCase() === owner.toLowerCase() &&
      m.repo.toLowerCase() === repo.toLowerCase() &&
      m.number === number,
  );

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${number}`,
      { headers: headers() },
    );
    if (res.ok) {
      const item = (await res.json()) as GhItem;
      const mapped = toMission(item, true);
      if (mapped) return mapped;
    }
  } catch {
    // fall through
  }

  if (fromCatalog) return fromCatalog;
  const seeded = findSeed(owner, repo, number);
  if (seeded) return seeded;

  const isPrGuess = false;
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
    isPr: isPrGuess,
    author: "",
    kind: "blinding",
    live: false,
  };
}

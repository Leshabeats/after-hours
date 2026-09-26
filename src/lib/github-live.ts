import { SEED_MISSIONS, findSeed } from "@/lib/seed";
import {
  ecosystemProjects,
  findCatalogRepo,
  libraryPicks,
  worldProjects,
  MIN_STARS,
  type CatalogRepo,
  type CategoryId,
  type LanguageId,
} from "@/lib/catalog";
import { hasLibraryManifest, isLibraryCatalogNoise } from "@/lib/library-filter";
import {
  FRESH_LIMIT,
  mergedIssueNumbers,
  withoutMergedFixes,
} from "@/lib/issue-slice";
import {
  classifyKind,
  decodeEntities,
  excerptOf,
  missionId,
  type Mission,
} from "@/lib/kinds";

const CACHE_MS = 12 * 60 * 1000;
const PROJECT_CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map<
  string,
  {
    at: number;
    missions: Mission[];
    live: boolean;
    issueTotal: number | null;
    prTotal: number | null;
    filterSkipped: boolean;
  }
>();
const projectCache = new Map<string, { at: number; card: ProjectCard }>();

export type ProjectCard = CatalogRepo & {
  description: string;
  logoUrl: string;
  stars: number | null;
  language: string | null;
  url: string;
  live: boolean;
};

export type ProjectShelf = {
  ecosystem: ProjectCard[];
  direction: ProjectCard[];
  libraries: ProjectCard[];
  live: boolean;
};

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

async function searchIssues(
  q: string,
  perPage: number,
): Promise<{ items: GhItem[]; total: number | null }> {
  const url = `https://api.github.com/search/issues?per_page=${perPage}&sort=updated&order=desc&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(`GitHub issue search ${res.status}`);
  }
  const json = (await res.json()) as { items?: GhItem[]; total_count?: number };
  return {
    items: json.items ?? [],
    total: typeof json.total_count === "number" ? json.total_count : null,
  };
}

function staticCard(spec: CatalogRepo): ProjectCard {
  return {
    ...spec,
    description: spec.blurb,
    logoUrl: `https://github.com/${spec.owner}.png`,
    stars: null,
    language: null,
    url: `https://github.com/${spec.owner}/${spec.repo}`,
    live: false,
  };
}

function projectKey(owner: string, repo: string) {
  return `${owner}/${repo}`.toLowerCase();
}

async function fetchProject(spec: CatalogRepo): Promise<ProjectCard> {
  const key = `${spec.owner}/${spec.repo}`;
  const hit = projectCache.get(key);
  if (hit && Date.now() - hit.at < PROJECT_CACHE_MS) return hit.card;
  try {
    const res = await fetch(`https://api.github.com/repos/${spec.owner}/${spec.repo}`, {
      headers: headers(),
    });
    if (!res.ok) return staticCard(spec);
    const json = (await res.json()) as {
      description?: string | null;
      stargazers_count?: number;
      language?: string | null;
      owner?: { avatar_url?: string };
      html_url?: string;
    };
    const card: ProjectCard = {
      ...spec,
      description: json.description?.trim() || spec.blurb,
      logoUrl: json.owner?.avatar_url || `https://github.com/${spec.owner}.png`,
      stars: json.stargazers_count ?? null,
      language: json.language ?? null,
      url: json.html_url || `https://github.com/${spec.owner}/${spec.repo}`,
      live: true,
    };
    projectCache.set(key, { at: Date.now(), card });
    return card;
  } catch {
    return staticCard(spec);
  }
}

const libraryCache = new Map<
  string,
  { at: number; cards: ProjectCard[] }
>();

async function rootFileNames(owner: string, repo: string): Promise<string[] | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { name?: string }[];
    if (!Array.isArray(json)) return null;
    return json.map((entry) => entry.name ?? "").filter(Boolean);
  } catch {
    return null;
  }
}

async function searchLibraries(language: string): Promise<ProjectCard[]> {
  const hit = libraryCache.get(language);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.cards;
  const q = [
    `language:${language}`,
    `stars:>=${MIN_STARS}`,
    "fork:false",
    "archived:false",
    "-topic:awesome",
    "-topic:algorithm",
    "-topic:algorithms",
    "-topic:leetcode",
    "-topic:interview",
    "-topic:tutorial",
    "-topic:learning",
    "-topic:cheatsheet",
    "-topic:roadmap",
  ].join(" ");
  const url = `https://api.github.com/search/repositories?per_page=30&sort=stars&order=desc&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`GitHub repo search ${res.status}`);
  const json = (await res.json()) as {
    items?: {
      name?: string;
      description?: string | null;
      stargazers_count?: number;
      language?: string | null;
      html_url?: string;
      topics?: string[];
      owner?: { login?: string; avatar_url?: string };
    }[];
  };
  const candidates = (json.items ?? []).flatMap((item) => {
    const owner = item.owner?.login;
    const repo = item.name;
    if (!owner || !repo) return [];
    if (
      isLibraryCatalogNoise({
        name: repo,
        description: item.description,
        topics: item.topics,
      })
    ) {
      return [];
    }
    const card: ProjectCard = {
      owner,
      repo,
      blurb: item.description?.trim() || repo,
      description: item.description?.trim() || repo,
      logoUrl: item.owner?.avatar_url || `https://github.com/${owner}.png`,
      stars: item.stargazers_count ?? null,
      language: item.language ?? language,
      url: item.html_url || `https://github.com/${owner}/${repo}`,
      live: true,
    };
    return [card];
  });
  const checked = await Promise.all(
    candidates.slice(0, 16).map(async (card) => {
      const files = await rootFileNames(card.owner, card.repo);
      if (files && !hasLibraryManifest(files)) return null;
      return card;
    }),
  );
  const cards = checked.filter((card): card is ProjectCard => Boolean(card)).slice(0, 12);
  libraryCache.set(language, { at: Date.now(), cards });
  return cards;
}

function sameLanguage(card: ProjectCard, language: string) {
  return card.language?.toLowerCase() === language.toLowerCase();
}

export async function loadProjects(query: CatalogQuery): Promise<ProjectShelf> {
  const world = await Promise.all(
    worldProjects(query.category).map((spec) => fetchProject(spec)),
  );
  if (!query.language) {
    return {
      ecosystem: [],
      direction: world,
      libraries: [],
      live: world.some((project) => project.live),
    };
  }

  const ecosystem = await Promise.all(
    ecosystemProjects(query.language).map((spec) => fetchProject(spec)),
  );
  const picks = await Promise.all(
    libraryPicks(query.language).map((spec) => fetchProject(spec)),
  );
  const seen = new Set(
    [...ecosystem, ...world, ...picks].map((project) =>
      projectKey(project.owner, project.repo),
    ),
  );
  const direction = world.filter((project) => sameLanguage(project, query.language!));
  let libraries = picks;
  try {
    const found = (await searchLibraries(query.language)).filter(
      (project) => !seen.has(projectKey(project.owner, project.repo)),
    );
    libraries = [...picks, ...found];
  } catch {
    libraries = picks;
  }
  const all = [...ecosystem, ...direction, ...libraries];
  return {
    ecosystem,
    direction,
    libraries,
    live: all.some((project) => project.live),
  };
}

async function closingPrsByIssue(owner: string, repo: string, numbers: number[]) {
  if (numbers.length === 0) return { failed: false, merged: new Set<number>() };
  const fields = numbers
    .map(
      (number, index) =>
        `i${index}: issue(number: ${number}) { number closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { nodes { merged } } }`,
    )
    .join("\n");
  const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) { ${fields} } }`;
  try {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return { failed: true, merged: new Set<number>() };
    const json = (await res.json()) as {
      errors?: unknown[];
      data?: { repository?: Parameters<typeof mergedIssueNumbers>[0] };
    };
    if (json.errors?.length || !json.data?.repository) {
      return { failed: true, merged: new Set<number>() };
    }
    return { failed: false, merged: mergedIssueNumbers(json.data.repository) };
  } catch {
    return { failed: true, merged: new Set<number>() };
  }
}

export type RepoMissions = {
  issues: Mission[];
  pullRequests: Mission[];
  issueTotal: number | null;
  prTotal: number | null;
  filterSkipped: boolean;
  live: boolean;
  profile: ProjectCard;
};

export async function loadRepoMissions(owner: string, repo: string): Promise<RepoMissions> {
  const profile = await fetchProject({
    owner,
    repo,
    blurb: findCatalogRepo(owner, repo)?.blurb ?? "",
  });
  const key = `repo|${owner}/${repo}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return {
      issues: hit.missions.filter((mission) => !mission.isPr),
      pullRequests: hit.missions.filter((mission) => mission.isPr),
      issueTotal: hit.issueTotal,
      prTotal: hit.prTotal,
      filterSkipped: hit.filterSkipped,
      live: hit.live,
      profile,
    };
  }
  try {
    const [issueSearch, prSearch] = await Promise.all([
      searchIssues(`is:issue is:open archived:false repo:${owner}/${repo}`, FRESH_LIMIT),
      searchIssues(`is:pr is:open archived:false repo:${owner}/${repo}`, FRESH_LIMIT),
    ]);
    const issues = issueSearch.items
      .map((item) => toMission(item, true, ""))
      .filter((mission): mission is Mission => Boolean(mission));
    const pullRequests = prSearch.items
      .map((item) => toMission({ ...item, pull_request: item.pull_request ?? {} }, true, ""))
      .filter((mission): mission is Mission => Boolean(mission));
    const closing = await closingPrsByIssue(
      owner,
      repo,
      issues.map((mission) => mission.number),
    );
    const filtered = withoutMergedFixes(
      issues.map((mission) => ({
        ...mission,
        closingPrs: closing.merged.has(mission.number) ? [{ merged: true }] : [],
      })),
      closing.failed,
    );
    const keptIssues = filtered.items;
    const missions = [...keptIssues, ...pullRequests];
    if (missions.length > 0 || (issueSearch.total ?? 0) + (prSearch.total ?? 0) > 0) {
      cache.set(key, {
        at: Date.now(),
        missions,
        live: true,
        issueTotal: issueSearch.total,
        prTotal: prSearch.total,
        filterSkipped: filtered.filterSkipped,
      });
      return {
        issues: keptIssues,
        pullRequests,
        issueTotal: issueSearch.total,
        prTotal: prSearch.total,
        filterSkipped: filtered.filterSkipped,
        live: true,
        profile,
      };
    }
  } catch {
    // fall through
  }
  const seeded = SEED_MISSIONS.filter(
    (mission) => mission.owner === owner && mission.repo === repo,
  );
  return {
    issues: seeded.filter((mission) => !mission.isPr),
    pullRequests: seeded.filter((mission) => mission.isPr),
    issueTotal: null,
    prTotal: null,
    filterSkipped: false,
    live: false,
    profile,
  };
}

function rememberMissions(owner: string, repo: string, missions: Mission[]) {
  const key = `repo|${owner}/${repo}`;
  const hit = cache.get(key);
  const merged = new Map<number, Mission>();
  for (const mission of hit?.missions ?? []) merged.set(mission.number, mission);
  for (const mission of missions) merged.set(mission.number, mission);
  cache.set(key, {
    at: hit?.at ?? Date.now(),
    missions: [...merged.values()],
    live: true,
    issueTotal: hit?.issueTotal ?? null,
    prTotal: hit?.prTotal ?? null,
    filterSkipped: hit?.filterSkipped ?? false,
  });
}

function cachedMission(owner: string, repo: string, number: number) {
  return cache
    .get(`repo|${owner}/${repo}`)
    ?.missions.find((mission) => mission.number === number);
}

export async function loadMission(
  owner: string,
  repo: string,
  number: number,
): Promise<Mission> {
  const known = cachedMission(owner, repo, number);
  if (known?.body) return known;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${number}`,
      { headers: headers() },
    );
    if (res.ok) {
      const item = (await res.json()) as GhItem;
      const mapped = toMission(item, true, "");
      if (mapped) {
        rememberMissions(owner, repo, [mapped]);
        return mapped;
      }
    }
  } catch {
    // fall through to search
  }
  try {
    const found = await searchIssues(`repo:${owner}/${repo} ${number}`, 10);
    const item = found.items.find((entry) => entry.number === number);
    const mapped = item ? toMission(item, true, "") : null;
    if (mapped) {
      rememberMissions(owner, repo, [mapped]);
      return mapped;
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

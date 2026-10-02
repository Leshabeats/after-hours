import { SEED_MISSIONS, findSeed } from "./seed.ts";
import {
  ecosystemProjects,
  findCatalogRepo,
  libraryPicks,
  worldProjects,
  MIN_STARS,
  type CatalogRepo,
  type CategoryId,
  type LanguageId,
} from "./catalog.ts";
import { hasLibraryManifest, isLibraryCatalogNoise } from "./library-filter.ts";
import { repoSearchQualifier } from "./github-slug.ts";
import {
  FRESH_LIMIT,
  mergedIssueNumbers,
  withoutMergedFixes,
} from "./issue-slice.ts";
import {
  classifyKind,
  decodeEntities,
  excerptOf,
  missionId,
  type Mission,
} from "./kinds.ts";

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
/** Bodies opened one at a time. They must not satisfy the repository list cache. */
const openedMissions = new Map<string, { at: number; mission: Mission }>();
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
type GhRepo = {
  private: boolean;
  description?: string | null;
  stargazers_count?: number;
  language?: string | null;
  owner?: { avatar_url?: string };
  html_url?: string;
};
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
  const url = `https://api.github.com/search/issues?per_page=${perPage}&sort=updated&order=desc&q=${encodeURIComponent(`${q} is:public`)}`;
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

/** Check visibility afresh before exposing issue data, including cached data. */
async function publicRepository(owner: string, repo: string): Promise<GhRepo | null> {
  if (!repoSearchQualifier(owner, repo)) return null;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const json = await res.json() as GhRepo | null;
    return json?.private === false ? json : null;
  } catch {
    return null;
  }
}

async function fetchProject(spec: CatalogRepo, verified?: GhRepo): Promise<ProjectCard> {
  const key = `${spec.owner}/${spec.repo}`;
  const hit = projectCache.get(key);
  if (!verified && hit && Date.now() - hit.at < PROJECT_CACHE_MS) return hit.card;
  try {
    const json = verified ?? await publicRepository(spec.owner, spec.repo);
    if (!json) return staticCard(spec);
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
    "is:public",
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
      private?: boolean;
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
    if (item.private !== false) return [];
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
  const picks = libraryPicks(query.language).map((spec) => staticCard(spec));
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

type ClosingLookup = { failed: boolean; merged: Set<number> };

async function closingPrsByIssue(owner: string, repo: string, numbers: number[]) {
  if (numbers.length === 0) return { failed: false, merged: new Set<number>() };
  if (process.env.GITHUB_TOKEN) return closingPrsGraphql(owner, repo, numbers);
  // REST cross-references prove a mention, not a closing relationship.
  return { failed: true, merged: new Set<number>() };
}

async function closingPrsGraphql(
  owner: string,
  repo: string,
  numbers: number[],
): Promise<ClosingLookup> {
  const merged = new Set<number>();
  let pending = numbers.map((number) => ({ number, cursor: null as string | null }));
  try {
    for (let page = 0; page < 4 && pending.length > 0; page += 1) {
      const fields = pending
        .map((item, index) => {
          const after = item.cursor ? `, after: ${JSON.stringify(item.cursor)}` : "";
          return `i${index}: issue(number: ${item.number}) { number closedByPullRequestsReferences(first: 100, includeClosedPrs: true${after}) { nodes { merged } pageInfo { hasNextPage endCursor } } }`;
        })
        .join("\n");
      const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) { ${fields} } }`;
      const res = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) return { failed: true, merged: new Set() };
      const json = (await res.json()) as {
        errors?: unknown[];
        data?: {
          repository?: Record<
            string,
            {
              number?: number | null;
              closedByPullRequestsReferences?: {
                nodes?: ({ merged?: boolean | null } | null)[] | null;
                pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
              } | null;
            } | null
          >;
        };
      };
      const repository = json.data?.repository;
      if (json.errors?.length || !repository) return { failed: true, merged: new Set() };
      mergedIssueNumbers(repository).forEach((number) => merged.add(number));
      const next = [];
      for (const [index, item] of pending.entries()) {
        if (merged.has(item.number)) continue;
        const pageInfo = repository[`i${index}`]?.closedByPullRequestsReferences?.pageInfo;
        if (pageInfo?.hasNextPage && pageInfo.endCursor) {
          next.push({ number: item.number, cursor: pageInfo.endCursor });
        }
      }
      pending = next;
    }
  } catch {
    return { failed: true, merged: new Set() };
  }
  if (pending.length > 0) return { failed: true, merged: new Set() };
  return { failed: false, merged };
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

function blankMissions(owner: string, repo: string): RepoMissions {
  return {
    issues: [],
    pullRequests: [],
    issueTotal: null,
    prTotal: null,
    filterSkipped: false,
    live: false,
    profile: staticCard({ owner, repo, blurb: findCatalogRepo(owner, repo)?.blurb ?? "" }),
  };
}

async function settledSearch(query: string) {
  try {
    return { ok: true as const, result: await searchIssues(query, FRESH_LIMIT) };
  } catch {
    return { ok: false as const };
  }
}

export async function loadRepoMissions(owner: string, repo: string): Promise<RepoMissions> {
  const qualifier = repoSearchQualifier(owner, repo);
  if (!qualifier) return blankMissions(owner, repo);
  const repository = await publicRepository(owner, repo);
  if (!repository) {
    // Only the baked, already-public seed is safe when visibility is unknown.
    const seeded = SEED_MISSIONS.filter((item) => item.owner === owner && item.repo === repo);
    return {
      ...blankMissions(owner, repo),
      issues: seeded.filter((item) => !item.isPr),
      pullRequests: seeded.filter((item) => item.isPr),
    };
  }
  const profile = await fetchProject({
    owner,
    repo,
    blurb: findCatalogRepo(owner, repo)?.blurb ?? "",
  }, repository);
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
  const [issueOutcome, prOutcome] = await Promise.all([
    settledSearch(`is:issue is:open archived:false ${qualifier}`),
    settledSearch(`is:pr is:open archived:false ${qualifier}`),
  ]);
  if (issueOutcome.ok || prOutcome.ok) {
    const issueSearch = issueOutcome.ok ? issueOutcome.result : { items: [], total: null };
    const prSearch = prOutcome.ok ? prOutcome.result : { items: [], total: null };
    const issues = issueSearch.items
      .map((item) => toMission(item, true, ""))
      .filter((mission): mission is Mission => Boolean(mission));
    const pullRequests = prSearch.items
      .map((item) => toMission({ ...item, pull_request: item.pull_request ?? {} }, true, ""))
      .filter((mission): mission is Mission => Boolean(mission));
    const closing = issueOutcome.ok
      ? await closingPrsByIssue(
          owner,
          repo,
          issues.map((mission) => mission.number),
        )
      : { failed: false, merged: new Set<number>() };
    const filtered = withoutMergedFixes(
      issues.map((mission) => ({
        ...mission,
        closingPrs: closing.merged.has(mission.number) ? [{ merged: true }] : [],
      })),
      closing.failed,
    );
    const keptIssues = filtered.items;
    cache.set(key, {
      at: Date.now(),
      missions: [...keptIssues, ...pullRequests],
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

function openedKey(owner: string, repo: string, number: number) {
  return `${owner}/${repo}#${number}`;
}

function rememberOpenedMission(mission: Mission) {
  openedMissions.set(openedKey(mission.owner, mission.repo, mission.number), {
    at: Date.now(),
    mission,
  });
}

function cachedMission(owner: string, repo: string, number: number) {
  const hit = cache.get(`repo|${owner}/${repo}`);
  const listed =
    hit && Date.now() - hit.at < CACHE_MS
      ? hit.missions.find((mission) => mission.number === number)
      : undefined;
  if (listed?.body) return listed;
  const key = openedKey(owner, repo, number);
  const opened = openedMissions.get(key);
  if (!opened) return listed;
  if (Date.now() - opened.at >= CACHE_MS) {
    openedMissions.delete(key);
    return listed;
  }
  return opened.mission.body ? opened.mission : listed;
}

export async function loadMission(
  owner: string,
  repo: string,
  number: number,
): Promise<Mission> {
  if (!await publicRepository(owner, repo)) return fallbackMission(owner, repo, number);
  const known = cachedMission(owner, repo, number);
  if (known?.body) return known;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`,
      { headers: headers() },
    );
    if (res.ok) {
      const item = (await res.json()) as GhItem;
      // GitHub can redirect a transferred issue into another repository.
      // Verify the payload destination before exposing or caching its body.
      const destination = item.repository_url?.match(/^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)$/);
      if (!destination || !await publicRepository(destination[1], destination[2])) {
        return fallbackMission(owner, repo, number);
      }
      const mapped = toMission(item, true, "");
      if (mapped) {
        rememberOpenedMission(mapped);
        return mapped;
      }
    }
  } catch {
    // fall through to search
  }
  const qualifier = repoSearchQualifier(owner, repo);
  try {
    if (!qualifier) throw new Error("unsafe repo");
    const found = await searchIssues(`${qualifier} ${number}`, 10);
    const item = found.items.find((entry) => entry.number === number);
    const mapped = item ? toMission(item, true, "") : null;
    if (mapped) {
      rememberOpenedMission(mapped);
      return mapped;
    }
  } catch {
    // fall through
  }

  return fallbackMission(owner, repo, number);
}

function fallbackMission(owner: string, repo: string, number: number): Mission {
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

export const DEFAULT_CATEGORY = "web";

/** Repo star floor for contribution targets. Issue-search `stars:` is reactions, not this. */
export const MIN_STARS = 1000;
export const CATALOG_REPO_LIMIT = 20;

export const CATEGORIES = [
  {
    id: "web",
    label: "Web",
    hint: "Браузер, фронт, HTTP",
    qualifier: "language:TypeScript",
  },
  {
    id: "stars",
    label: "Stars",
    hint: "VS Code, Godot, OBS, Kubernetes",
    repos: [
      "microsoft/vscode",
      "godotengine/godot",
      "obsproject/obs-studio",
      "kubernetes/kubernetes",
      "neovim/neovim",
      "mpv-player/mpv",
      "home-assistant/core",
      "nodejs/node",
      "golang/go",
      "rust-lang/rust",
      "python/cpython",
      "llvm/llvm-project",
      "redis/redis",
      "flutter/flutter",
      "pytorch/pytorch",
      "jellyfin/jellyfin",
      "ollama/ollama",
      "microsoft/terminal",
      "git/git",
      "moby/moby",
    ],
  },
  {
    id: "go",
    label: "Go",
    hint: "Язык и рантайм",
    qualifier: "language:Go",
  },
  {
    id: "rust",
    label: "Rust",
    hint: "Язык и экосистема",
    qualifier: "language:Rust",
  },
  {
    id: "cpp",
    label: "C++",
    hint: "Язык и экосистема",
    qualifier: "language:C++",
  },
  {
    id: "python",
    label: "Python",
    hint: "Язык и экосистема",
    qualifier: "language:Python",
  },
  {
    id: "linux",
    label: "Linux",
    hint: "Ядро и низкий уровень",
    qualifier: "linux kernel",
  },
  {
    id: "c",
    label: "C",
    hint: "Системный код",
    qualifier: "language:C",
  },
  {
    id: "typescript",
    label: "TypeScript",
    hint: "Язык",
    qualifier: "language:TypeScript",
  },
  {
    id: "zig",
    label: "Zig",
    hint: "Язык и тулинг",
    qualifier: "language:Zig",
  },
  {
    id: "java",
    label: "Java",
    hint: "Язык и экосистема",
    qualifier: "language:Java",
  },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export const LANGUAGES = [
  { id: "TypeScript", label: "TypeScript" },
  { id: "JavaScript", label: "JavaScript" },
  { id: "Go", label: "Go" },
  { id: "Rust", label: "Rust" },
  { id: "C++", label: "C++" },
  { id: "C", label: "C" },
  { id: "Python", label: "Python" },
  { id: "Zig", label: "Zig" },
  { id: "Java", label: "Java" },
  { id: "Ruby", label: "Ruby" },
  { id: "PHP", label: "PHP" },
  { id: "Swift", label: "Swift" },
  { id: "Kotlin", label: "Kotlin" },
] as const;

export type LanguageId = (typeof LANGUAGES)[number]["id"];

export type CatalogSearch = {
  cat?: CategoryId;
  lang?: LanguageId;
};

const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));
const LANGUAGE_IDS = new Set<string>(LANGUAGES.map((l) => l.id));

export function parseCategoryId(raw: unknown): CategoryId {
  if (typeof raw === "string" && CATEGORY_IDS.has(raw)) {
    return raw as CategoryId;
  }
  return DEFAULT_CATEGORY;
}

export function parseLanguageId(raw: unknown): LanguageId | undefined {
  if (typeof raw === "string" && LANGUAGE_IDS.has(raw)) {
    return raw as LanguageId;
  }
  return undefined;
}

export function keepCatalogSearch(search: Record<string, unknown>): CatalogSearch {
  return parseCatalogSearch(search);
}

export function parseCatalogSearch(
  search: Record<string, unknown>,
): CatalogSearch {
  const out: CatalogSearch = {};
  if (typeof search.cat === "string" && CATEGORY_IDS.has(search.cat)) {
    out.cat = search.cat as CategoryId;
  }
  const lang = parseLanguageId(search.lang);
  if (lang) out.lang = lang;
  return out;
}

export function getCategory(id: CategoryId) {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];
}

export function hintLanguage(cat: CategoryId, lang?: LanguageId): string {
  if (lang) return lang;
  const category = getCategory(cat);
  const qualifier = "qualifier" in category ? category.qualifier : undefined;
  if (qualifier?.startsWith("language:")) {
    return qualifier.slice("language:".length);
  }
  return "";
}

export function curatedRepos(cat: CategoryId): readonly string[] | undefined {
  const category = getCategory(cat);
  return "repos" in category ? category.repos : undefined;
}

export function repoSearchQuery(cat: CategoryId, lang?: LanguageId) {
  const category = getCategory(cat);
  const parts = [`stars:>=${MIN_STARS}`, "fork:false", "archived:false"];
  if (lang) parts.push(`language:${lang}`);
  const qualifier = "qualifier" in category ? category.qualifier : undefined;
  if (qualifier && (!lang || !qualifier.startsWith("language:"))) {
    parts.push(qualifier);
  }
  return parts.join(" ");
}

export function issueSearchQuery(repos: readonly string[], lang?: LanguageId) {
  const parts = ["is:open", "archived:false"];
  if (lang) parts.push(`language:${lang}`);
  for (const repo of repos) parts.push(`repo:${repo}`);
  return parts.join(" ");
}

export function seedFits(cat: CategoryId, lang?: LanguageId) {
  if (cat !== "web" && cat !== "typescript") return false;
  if (lang && lang !== "TypeScript" && lang !== "JavaScript") return false;
  return true;
}

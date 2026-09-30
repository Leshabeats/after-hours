export const DEFAULT_CATEGORY = "web";

/** Repo star floor kept for copy. Lists themselves are curated, not a language dump. */
export const MIN_STARS = 1000;

export type CatalogRepo = {
  owner: string;
  repo: string;
  blurb: string;
};

export const WORLDS = [
  {
    id: "web",
    label: "Web",
    hint: "Платформа, не приложения",
    projects: [
      { owner: "whatwg", repo: "html", blurb: "Спека HTML" },
      { owner: "whatwg", repo: "dom", blurb: "Спека DOM" },
      { owner: "w3c", repo: "csswg-drafts", blurb: "Спеки CSS" },
      { owner: "tc39", repo: "ecma262", blurb: "Спека JavaScript" },
      { owner: "web-platform-tests", repo: "wpt", blurb: "Тесты веб-платформы" },
      { owner: "mdn", repo: "content", blurb: "Документация веба" },
    ],
  },
  {
    id: "stars",
    label: "Stars",
    hint: "Чем пользуются все",
    projects: [
      { owner: "microsoft", repo: "vscode", blurb: "Редактор" },
      { owner: "godotengine", repo: "godot", blurb: "Игровой движок" },
      { owner: "obsproject", repo: "obs-studio", blurb: "Запись и стрим" },
      { owner: "kubernetes", repo: "kubernetes", blurb: "Оркестратор" },
      { owner: "neovim", repo: "neovim", blurb: "Редактор" },
      { owner: "mpv-player", repo: "mpv", blurb: "Плеер" },
      { owner: "home-assistant", repo: "core", blurb: "Дом" },
      { owner: "jellyfin", repo: "jellyfin", blurb: "Медиасервер" },
      { owner: "ollama", repo: "ollama", blurb: "Локальные модели" },
    ],
  },
  {
    id: "linux",
    label: "Linux",
    hint: "База системы, не ядро",
    projects: [
      { owner: "systemd", repo: "systemd", blurb: "Инит и сервисы" },
      { owner: "util-linux", repo: "util-linux", blurb: "Базовые утилиты" },
      { owner: "uutils", repo: "coreutils", blurb: "coreutils" },
      { owner: "shadow-maint", repo: "shadow", blurb: "Пользователи и пароли" },
      { owner: "linux-pam", repo: "linux-pam", blurb: "Вход в систему" },
      { owner: "sudo-project", repo: "sudo", blurb: "sudo" },
      { owner: "polkit-org", repo: "polkit", blurb: "Права процессов" },
      { owner: "dracut-ng", repo: "dracut-ng", blurb: "Initramfs" },
      { owner: "fwupd", repo: "fwupd", blurb: "Прошивки" },
      { owner: "storaged-project", repo: "udisks", blurb: "Диски" },
      { owner: "bluez", repo: "bluez", blurb: "Bluetooth" },
      { owner: "systemd", repo: "mkosi", blurb: "Сборка образов ОС" },
      { owner: "ostreedev", repo: "ostree", blurb: "Неизменяемые образы системы" },
      { owner: "flatpak", repo: "flatpak", blurb: "Приложения" },
    ],
  },
] as const;

export type CategoryId = (typeof WORLDS)[number]["id"];

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
] as const;

export type LanguageId = (typeof LANGUAGES)[number]["id"];

const JS_TS_LIBRARIES: readonly CatalogRepo[] = [
  { owner: "npm", repo: "cli", blurb: "Клиент npm" },
  { owner: "colinhacks", repo: "zod", blurb: "Схемы и валидация" },
  { owner: "prisma", repo: "prisma", blurb: "ORM" },
  { owner: "drizzle-team", repo: "drizzle-orm", blurb: "ORM" },
  { owner: "TanStack", repo: "router", blurb: "Роутер" },
  { owner: "TanStack", repo: "query", blurb: "Кэш запросов" },
  { owner: "vitejs", repo: "vite", blurb: "Сборка" },
  { owner: "facebook", repo: "react", blurb: "UI-фреймворк" },
  { owner: "tailwindlabs", repo: "tailwindcss", blurb: "Стили" },
  { owner: "fastify", repo: "fastify", blurb: "HTTP-фреймворк" },
  { owner: "nestjs", repo: "nest", blurb: "Бэкенд-фреймворк" },
  { owner: "pmndrs", repo: "zustand", blurb: "Состояние" },
  { owner: "vitest-dev", repo: "vitest", blurb: "Тесты" },
  { owner: "jestjs", repo: "jest", blurb: "Тесты" },
  { owner: "microsoft", repo: "playwright", blurb: "Браузерные тесты" },
  { owner: "axios", repo: "axios", blurb: "HTTP-клиент" },
  { owner: "react-hook-form", repo: "react-hook-form", blurb: "Формы" },
  { owner: "pinojs", repo: "pino", blurb: "Логи" },
  { owner: "redis", repo: "ioredis", blurb: "Клиент Redis" },
  { owner: "prettier", repo: "prettier", blurb: "Форматтер" },
  { owner: "eslint", repo: "eslint", blurb: "Линтер" },
  { owner: "privatenumber", repo: "tsx", blurb: "Запуск TypeScript" },
  { owner: "nitrojs", repo: "nitro", blurb: "Серверный движок" },
  { owner: "honojs", repo: "hono", blurb: "HTTP-фреймворк" },
  { owner: "trpc", repo: "trpc", blurb: "Типизированный API" },
  { owner: "TanStack", repo: "table", blurb: "Таблицы" },
  { owner: "remix-run", repo: "react-router", blurb: "Роутер React" },
  { owner: "typeorm", repo: "typeorm", blurb: "ORM" },
  { owner: "kysely-org", repo: "kysely", blurb: "Построитель запросов" },
  { owner: "knex", repo: "knex", blurb: "Построитель запросов" },
  { owner: "sequelize", repo: "sequelize", blurb: "ORM" },
  { owner: "mikro-orm", repo: "mikro-orm", blurb: "ORM" },
  { owner: "pnpm", repo: "pnpm", blurb: "Пакетный менеджер" },
  { owner: "lucide-icons", repo: "lucide", blurb: "Иконки" },
  { owner: "radix-ui", repo: "primitives", blurb: "Примитивы интерфейса" },
  { owner: "emilkowalski", repo: "sonner", blurb: "Тосты" },
  { owner: "dcastil", repo: "tailwind-merge", blurb: "Слияние классов Tailwind" },
  { owner: "joe-bell", repo: "cva", blurb: "Варианты классов" },
];

const ECOSYSTEMS: Record<LanguageId, readonly CatalogRepo[]> = {
  TypeScript: [
    { owner: "microsoft", repo: "TypeScript", blurb: "Компилятор и язык" },
    { owner: "microsoft", repo: "tslib", blurb: "Рантайм-хелперы tsc" },
    { owner: "typescript-eslint", repo: "typescript-eslint", blurb: "Линтер языка" },
    { owner: "microsoft", repo: "TypeScript-Website", blurb: "Сайт и playground" },
  ],
  JavaScript: [
    { owner: "tc39", repo: "ecma262", blurb: "Спека языка" },
    { owner: "tc39", repo: "proposal-temporal", blurb: "Предложение в язык" },
    { owner: "nodejs", repo: "node", blurb: "Основной рантайм" },
    { owner: "denoland", repo: "deno", blurb: "Рантайм" },
    { owner: "oven-sh", repo: "bun", blurb: "Рантайм" },
  ],
  Go: [
    { owner: "golang", repo: "go", blurb: "Компилятор и стандартная библиотека" },
    { owner: "golang", repo: "tools", blurb: "gopls и тулинг" },
    { owner: "golang", repo: "vscode-go", blurb: "Расширение редактора" },
  ],
  Rust: [
    { owner: "rust-lang", repo: "rust", blurb: "Компилятор и язык" },
    { owner: "rust-lang", repo: "cargo", blurb: "Сборщик" },
    { owner: "rust-lang", repo: "rust-analyzer", blurb: "Языковой сервер" },
    { owner: "rust-lang", repo: "rustfmt", blurb: "Форматтер" },
    { owner: "rust-lang", repo: "rust-clippy", blurb: "Линтер" },
  ],
  "C++": [
    { owner: "llvm", repo: "llvm-project", blurb: "Clang и LLVM" },
    { owner: "microsoft", repo: "STL", blurb: "Стандартная библиотека MSVC" },
    { owner: "Kitware", repo: "CMake", blurb: "Сборка" },
    { owner: "boostorg", repo: "boost", blurb: "Базовая библиотека языка" },
  ],
  C: [
    { owner: "llvm", repo: "llvm-project", blurb: "Clang" },
    { owner: "bminor", repo: "glibc", blurb: "Стандартная библиотека GNU" },
    { owner: "bminor", repo: "musl", blurb: "Стандартная библиотека musl" },
    { owner: "gcc-mirror", repo: "gcc", blurb: "Компилятор GCC" },
  ],
  Python: [
    { owner: "python", repo: "cpython", blurb: "Интерпретатор и стандартная библиотека" },
    { owner: "python", repo: "peps", blurb: "Предложения в язык" },
    { owner: "pypa", repo: "pip", blurb: "Установщик" },
    { owner: "astral-sh", repo: "ruff", blurb: "Линтер и форматтер экосистемы" },
  ],
  Zig: [
    { owner: "ziglang", repo: "zig", blurb: "Компилятор и язык" },
    { owner: "ziglang", repo: "zig-bootstrap", blurb: "Сборка компилятора" },
  ],
  Java: [
    { owner: "openjdk", repo: "jdk", blurb: "Эталонный JDK" },
    { owner: "gradle", repo: "gradle", blurb: "Сборка" },
    { owner: "apache", repo: "maven", blurb: "Сборка" },
  ],
};

export type CatalogSearch = {
  cat?: CategoryId;
  lang?: LanguageId;
};

const CATEGORY_IDS = new Set<string>(WORLDS.map((c) => c.id));
const LANGUAGE_IDS = new Set<string>(LANGUAGES.map((l) => l.id));

const LEGACY_LANGUAGE: Record<string, LanguageId> = {
  go: "Go",
  rust: "Rust",
  cpp: "C++",
  python: "Python",
  c: "C",
  typescript: "TypeScript",
  zig: "Zig",
  java: "Java",
};

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

export function parseCatalogSearch(
  search: Record<string, unknown>,
): CatalogSearch {
  const out: CatalogSearch = {};
  if (typeof search.cat === "string" && CATEGORY_IDS.has(search.cat)) {
    out.cat = search.cat as CategoryId;
  }
  const lang =
    parseLanguageId(search.lang) ??
    (typeof search.cat === "string" ? LEGACY_LANGUAGE[search.cat] : undefined);
  if (lang) out.lang = lang;
  return out;
}

export function keepCatalogSearch(search: Record<string, unknown>): CatalogSearch {
  return parseCatalogSearch(search);
}

export function getCategory(id: CategoryId) {
  return WORLDS.find((c) => c.id === id) ?? WORLDS[0];
}

export function findCatalogRepo(owner: string, repo: string): CatalogRepo | undefined {
  const key = `${owner}/${repo}`.toLowerCase();
  const listed: CatalogRepo[] = [
    ...WORLDS.flatMap((world) => [...world.projects]),
    ...Object.values(ECOSYSTEMS).flat(),
    ...JS_TS_LIBRARIES,
  ];
  return listed.find((project) => `${project.owner}/${project.repo}`.toLowerCase() === key);
}

export function worldProjects(cat: CategoryId): readonly CatalogRepo[] {
  return getCategory(cat).projects;
}

export function ecosystemProjects(lang: LanguageId): readonly CatalogRepo[] {
  return ECOSYSTEMS[lang];
}

export function libraryPicks(lang: LanguageId): readonly CatalogRepo[] {
  if (lang === "TypeScript" || lang === "JavaScript") return JS_TS_LIBRARIES;
  return [];
}

export function catalogProjects(
  cat: CategoryId,
  lang?: LanguageId,
): readonly CatalogRepo[] {
  if (lang) return ecosystemProjects(lang);
  return worldProjects(cat);
}

export function hintLanguage(cat: CategoryId, lang?: LanguageId): string {
  return lang ?? "";
}

export const CATEGORIES = WORLDS;

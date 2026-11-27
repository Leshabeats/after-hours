export const GAME_TAGS = [
  { id: "engines", label: "Движки" },
  { id: "tools", label: "Инструменты" },
  { id: "assets", label: "Ассеты" },
  { id: "emulation", label: "Эмуляторы" },
  { id: "linux-gaming", label: "Linux gaming" },
  { id: "steamos", label: "SteamOS / Deck" },
  { id: "proton", label: "Proton" },
] as const;
export type GameTag = (typeof GAME_TAGS)[number]["id"];
export const DISCOVERY_WORLD_IDS = { games: 1, web: 2, linux: 3, ai: 4, data: 5 } as const;
export type DiscoveryWorld = keyof typeof DISCOVERY_WORLD_IDS;

export function isDiscoveryWorld(value: unknown): value is DiscoveryWorld {
  return typeof value === "string" && Object.hasOwn(DISCOVERY_WORLD_IDS, value);
}

export const WORLD_TAGS = {
  games: GAME_TAGS,
  web: [
    { id: "web-standards", label: "Стандарты", topics: ["web-standards"] },
    {
      id: "browser-apis",
      label: "Браузерные API",
      topics: ["web-api", "web-platform", "browser-api"],
    },
    {
      id: "web-tests",
      label: "Совместимость и тесты",
      topics: ["web-platform-tests", "browser-testing"],
    },
    { id: "web-docs", label: "Документация", topics: ["web-documentation", "mdn"] },
  ],
  linux: [
    { id: "system-services", label: "Системные службы", topics: ["systemd", "init-system"] },
    { id: "system-tools", label: "Утилиты и оболочки", topics: ["linux-tools", "linux-utilities"] },
    { id: "packages", label: "Пакеты и сборка", topics: ["package-manager", "flatpak"] },
    { id: "hardware", label: "Железо и прошивки", topics: ["linux-driver", "fwupd"] },
  ],
  ai: [
    { id: "inference", label: "Локальный инференс", topics: ["llm-inference", "local-llm"] },
    {
      id: "model-serving",
      label: "Серверы моделей",
      topics: ["model-serving", "inference-server"],
    },
    { id: "rag", label: "RAG", topics: ["rag", "retrieval-augmented-generation"] },
    { id: "evals", label: "Оценки и датасеты", topics: ["llm-evaluation", "ai-benchmark"] },
  ],
  data: [
    { id: "databases", label: "СУБД и форматы", topics: ["database-engine", "columnar-database"] },
    {
      id: "streaming",
      label: "Обработка потоков",
      topics: ["stream-processing", "event-streaming"],
    },
    { id: "orchestration", label: "Оркестрация", topics: ["data-orchestration", "data-pipeline"] },
    { id: "database-clients", label: "Клиенты", topics: ["database-client", "sql-client"] },
  ],
} as const;

export type DiscoveryTag = (typeof WORLD_TAGS)[DiscoveryWorld][number]["id"];
export type DiscoveryMode = "all" | "new" | "discovered" | "active" | "growing";
export type Observation = {
  /** Only an explicit public GitHub response grants publication eligibility. */
  isPublic?: boolean;
  /** The observation itself came from a stable-ID metadata response. */
  identityVerified?: boolean;
  id: string;
  owner: string;
  repo: string;
  description: string;
  language: string | null;
  topics: string[];
  stars: number;
  forks: number;
  createdAt: number;
  pushedAt: number | null;
  observedAt: number;
  /** Last actual star/fork measurement; absent only in older persisted observations. */
  countsObservedAt?: number;
  /** Provenance belongs to the count sample, independently of current metadata. */
  countsSource?: "search" | "repository";
  countsScanId?: string;
  /** Only true for an actual new sample in this observation, never copied counts. */
  countsMeasured?: boolean;
  archived: boolean;
  fork: boolean;
  mirror: boolean;
  disabled: boolean;
  tags: DiscoveryTag[];
  /** null means that the current GitHub response did not confirm an accepted license. */
  license?: string | null;
  source: string;
  // null means unmeasured, never zero activity. Details are bounded samples.
  releaseAt: number | null;
  mergedPrs: number | null;
  activityCheckedAt: number | null;
};
export type StoredRepository = Observation & { firstSeenAt: number };
export type DailyMetric = { repoId: string; observedAt: number; stars: number; forks: number };
export const ISSUE_MAX_AGE_MS = 2 * 86_400_000;
export type DiscoveryIssue = {
  number: number;
  title: string;
  excerpt: string;
  checkedAt: number;
  evidence: "reproduction" | "file" | "behavior";
};
export type DiscoveryCard = {
  isPublic?: boolean;
  /** Version 1 GameDev snapshots predate the world field. */
  world?: DiscoveryWorld;
  id: string;
  owner: string;
  repo: string;
  description: string;
  blurb: string;
  logoUrl: string;
  url: string;
  language: string | null;
  stars: number;
  live: boolean;
  tags: DiscoveryTag[];
  license?: string;
  createdAt: number;
  firstSeenAt: number;
  observedAt: number;
  badges: Exclude<DiscoveryMode, "all">[];
  reasons: string[];
  growth: { stars: number; days: number } | null;
  issues?: DiscoveryIssue[];
};
export type DiscoverySnapshot = {
  version: 1;
  generatedAt: number;
  cards: DiscoveryCard[];
  issuesIndexed?: boolean;
};
export type DiscoveryLoad = {
  status: "ready" | "empty" | "unavailable";
  updatedAt: number | null;
  stale: boolean;
  cards: DiscoveryCard[];
  issuesIndexed?: boolean;
};
export type Lease = { runId: string; token: string; checkpoint: unknown | null };
export interface DiscoveryStore {
  acquire(now: number, leaseMs: number): Promise<Lease | null>;
  save(
    lease: Lease,
    now: number,
    leaseMs: number,
    observations: Observation[],
    checkpoint: unknown,
  ): Promise<void>;
  release(lease: Lease, now: number, error: string, retryAt?: number): Promise<void>;
  publish(lease: Lease, now: number, snapshot: DiscoverySnapshot): Promise<void>;
  repositories(): Promise<StoredRepository[]>;
  metrics(since: number): Promise<DailyMetric[]>;
  snapshot(): Promise<DiscoverySnapshot | null>;
}

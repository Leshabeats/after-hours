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
export type DiscoveryMode = "all" | "new" | "discovered" | "growing";
export type Observation = {
  /** Only an explicit public GitHub response grants publication eligibility. */
  isPublic?: boolean;
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
  tags: GameTag[];
  source: string;
  // null means unmeasured, never zero activity. Details are bounded samples.
  releaseAt: number | null;
  mergedPrs: number | null;
  activityCheckedAt: number | null;
};
export type StoredRepository = Observation & { firstSeenAt: number };
export type DailyMetric = { repoId: string; observedAt: number; stars: number; forks: number };
export type DiscoveryCard = {
  isPublic?: boolean;
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
  tags: GameTag[];
  createdAt: number;
  firstSeenAt: number;
  observedAt: number;
  badges: Exclude<DiscoveryMode, "all">[];
  reasons: string[];
  growth: { stars: number; days: number } | null;
};
export type DiscoverySnapshot = { version: 1; generatedAt: number; cards: DiscoveryCard[] };
export type DiscoveryLoad = {
  status: "ready" | "empty" | "unavailable";
  updatedAt: number | null;
  stale: boolean;
  cards: DiscoveryCard[];
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

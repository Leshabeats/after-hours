import { z } from "zod";
import { buildSnapshot, classifyRepository, DAY, eligible, FORK_EXCEPTIONS } from "./ranking.ts";
import type { DiscoveryStore, Observation, StoredRepository } from "./types.ts";

const TOPICS = [
  "game-engine",
  "game-development",
  "game-assets",
  "emulator",
  "retrogaming",
  "linux-gaming",
  "steamos",
  "steam-deck",
  "proton",
  "game-tools",
];
const LEASE_MS = 120_000;
const MAX_CANDIDATES = 300;
const MAX_ENRICH = 40;
const slug = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+$/)
  .max(100);
const repoSchema = z.object({
  id: z.number().int().positive().safe(),
  name: slug,
  owner: z.object({ login: slug }),
  description: z.string().max(20_000).nullable(),
  language: z.string().nullable(),
  topics: z.array(z.string()).default([]),
  stargazers_count: z.number().int().nonnegative().safe(),
  forks_count: z.number().int().nonnegative().safe(),
  created_at: z.string(),
  pushed_at: z.string().nullable(),
  archived: z.boolean(),
  fork: z.boolean(),
  disabled: z.boolean().default(false),
  mirror_url: z.string().nullable().optional(),
  size: z.number().nonnegative().optional(),
});

export function parseRepository(raw: unknown, now: number, source: string): Observation | null {
  const parsed = repoSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  const createdAt = Date.parse(r.created_at),
    pushedAt = r.pushed_at ? Date.parse(r.pushed_at) : null;
  if (
    !Number.isFinite(createdAt) ||
    createdAt > now ||
    (pushedAt !== null && !Number.isFinite(pushedAt))
  )
    return null;
  const identity = {
    owner: r.owner.login,
    repo: r.name,
    description: r.description ?? "",
    topics: r.topics,
  };
  return {
    ...identity,
    id: String(r.id),
    language: r.language,
    stars: r.stargazers_count,
    forks: r.forks_count,
    createdAt,
    pushedAt,
    observedAt: now,
    archived: r.archived,
    fork: r.fork,
    mirror: Boolean(r.mirror_url),
    disabled: r.disabled || r.size === 0,
    tags: classifyRepository(identity),
    source,
    releaseAt: null,
    mergedPrs: null,
    activityCheckedAt: null,
  };
}

const taskSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("search"),
    q: z.string().max(500),
    page: z.number().int().min(1).max(2),
  }),
  z.object({ kind: z.literal("repo"), owner: slug, repo: slug }),
  z.object({ kind: z.literal("activity"), id: z.string().regex(/^\d+$/) }),
]);
const checkpointSchema = z.object({
  version: z.literal(1),
  startedAt: z.number(),
  index: z.number().int().nonnegative(),
  phase: z.enum(["metadata", "activity"]),
  tasks: z.array(taskSchema).max(400),
  ids: z.array(z.string()).max(MAX_CANDIDATES),
});
type Checkpoint = z.infer<typeof checkpointSchema>;

class Pause extends Error {
  readonly retryAt: number;
  constructor(message: string, retryAt: number) {
    super(message);
    this.retryAt = retryAt;
  }
}
class Budget extends Error {}
class RepositoryUnavailable extends Error {}
export type CollectorResult = {
  status: "published" | "paused" | "partial" | "busy";
  requests: number;
  searchRequests: number;
  cards?: number;
};
export type CollectorOptions = {
  store: DiscoveryStore;
  token?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxRequests?: number;
  maxSearchRequests?: number;
  maxDurationMs?: number;
};

function initialCheckpoint(repos: StoredRepository[], now: number): Checkpoint {
  const date = new Date(now - 30 * DAY).toISOString().slice(0, 10);
  const tasks: Checkpoint["tasks"] = TOPICS.flatMap((topic) => [
    {
      kind: "search" as const,
      q: `topic:${topic} created:>=${date} fork:false archived:false`,
      page: 1,
    },
    {
      kind: "search" as const,
      q: `topic:${topic} pushed:>=${date} fork:false archived:false`,
      page: 1,
    },
  ]);
  // Oldest observations first ensures the bounded refresh pool rotates.
  const refresh = [...repos]
    .sort((a, b) => a.observedAt - b.observedAt || a.id.localeCompare(b.id))
    .slice(0, 180);
  tasks.push(...refresh.map((r) => ({ kind: "repo" as const, owner: r.owner, repo: r.repo })));
  for (const full of FORK_EXCEPTIONS) {
    const [owner, repo] = full.split("/");
    tasks.push({ kind: "repo", owner, repo });
  }
  return { version: 1, startedAt: now, index: 0, phase: "metadata", tasks, ids: [] };
}

export async function collectDiscovery(options: CollectorOptions): Promise<CollectorResult> {
  const { store } = options;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const fetchImpl = options.fetchImpl ?? fetch;
  const started = now(),
    deadline = started + Math.min(options.maxDurationMs ?? 480_000, 480_000);
  const maxRequests = Math.min(options.maxRequests ?? 500, 500);
  const maxSearch = Math.min(options.maxSearchRequests ?? 40, 40);
  let requests = 0,
    searchRequests = 0,
    nextRequestAt = started,
    nextSearchAt = started;
  const lease = await store.acquire(started, LEASE_MS);
  if (!lease) return { status: "busy", requests, searchRequests };

  async function request(path: string, search = false, redirects = 0): Promise<unknown | null> {
    const wait = Math.max(nextRequestAt, search ? nextSearchAt : 0) - now();
    if (
      requests >= maxRequests ||
      (search && searchRequests >= maxSearch) ||
      now() + Math.max(wait, 0) >= deadline
    )
      throw new Budget();
    if (wait > 0) await sleep(wait);
    const at = now();
    requests++;
    if (search) searchRequests++;
    nextRequestAt = at + 500;
    if (search) nextSearchAt = at + 3100;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "after-hours-discovery",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    let response: Response;
    try {
      response = await fetchImpl(`https://api.github.com${path}`, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(1, Math.min(12_000, deadline - at))),
      });
    } catch {
      throw new Pause("GitHub network unavailable", now() + 60_000);
    }
    if ([301, 302, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      const target = location ? new URL(location, "https://api.github.com") : null;
      const repositoryPath =
        /^\/(?:repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|repositories\/\d+)(?:\/(?:releases\/latest|pulls))?$/;
      if (
        search ||
        redirects >= 3 ||
        !target ||
        target.origin !== "https://api.github.com" ||
        target.username ||
        target.password ||
        !repositoryPath.test(target.pathname)
      )
        throw new Pause("Unsupported GitHub repository redirect", now() + 15 * 60_000);
      // Charge each permitted redirect hop to the same request/time budget.
      return request(`${target.pathname}${target.search}`, false, redirects + 1);
    }
    if (response.status === 404) return null;
    if (response.status === 410 || response.status === 451) throw new RepositoryUnavailable();
    if (
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.get("x-ratelimit-remaining") === "0" ||
          response.headers.has("retry-after")))
    ) {
      const retry = response.headers.get("retry-after");
      const retryAt = retry
        ? /^\d+$/.test(retry)
          ? now() + Number(retry) * 1000
          : Date.parse(retry)
        : 0;
      const reset = Number(response.headers.get("x-ratelimit-reset") ?? 0) * 1000;
      throw new Pause(
        "GitHub rate limited",
        Math.max(
          now() + 60_000,
          Number.isFinite(retryAt) ? retryAt : 0,
          Number.isFinite(reset) ? reset : 0,
        ),
      );
    }
    if (!response.ok)
      throw new Pause(
        `GitHub HTTP ${response.status}`,
        now() + (response.status >= 500 ? 60_000 : 15 * 60_000),
      );
    try {
      return await response.json();
    } catch {
      throw new Pause("Invalid GitHub response", now() + 60_000);
    }
  }

  try {
    const existing = await store.repositories();
    let cp =
      lease.checkpoint === null
        ? initialCheckpoint(existing, started)
        : checkpointSchema.parse(lease.checkpoint);
    if (cp.index > cp.tasks.length) throw new Error("Invalid discovery checkpoint");
    // A multi-day interrupted scan restarts its date windows; prior writes remain idempotent.
    if (now() - cp.startedAt > 2 * DAY) cp = initialCheckpoint(existing, now());
    await store.save(lease, now(), LEASE_MS, [], cp);
    let repos = new Map(existing.map((repo) => [repo.id, repo]));
    while (true) {
      while (cp.index < cp.tasks.length) {
        if (now() >= deadline) throw new Budget();
        const task = cp.tasks[cp.index];
        const observations: Observation[] = [];
        try {
          if (task.kind === "search") {
            const raw = await request(
              `/search/repositories?per_page=30&sort=updated&order=desc&page=${task.page}&q=${encodeURIComponent(task.q)}`,
              true,
            );
            const result = z
              .object({
                items: z.array(z.unknown()).max(100),
                incomplete_results: z.boolean(),
                total_count: z.number().nonnegative(),
              })
              .parse(raw);
            if (result.incomplete_results)
              throw new Pause("GitHub search incomplete; checkpoint retained", now() + 15 * 60_000);
            for (const item of result.items) {
              const repo = parseRepository(item, now(), task.q);
              if (!repo) continue;
              // Preserve exclusion updates for existing IDs, but do not ingest unrelated repositories.
              if (!eligible(repo) && !repos.has(repo.id)) continue;
              if (!cp.ids.includes(repo.id) && cp.ids.length >= MAX_CANDIDATES) continue;
              if (!cp.ids.includes(repo.id)) cp.ids.push(repo.id);
              observations.push(repo);
            }
            if (
              task.page === 1 &&
              result.total_count > 30 &&
              cp.tasks.filter((t) => t.kind === "search").length < 40
            ) {
              cp.tasks.push({ ...task, page: 2 });
            }
          } else if (task.kind === "repo") {
            const raw = await request(`/repos/${task.owner}/${task.repo}`);
            const old = [...repos.values()].find(
              (r) =>
                `${r.owner}/${r.repo}`.toLowerCase() === `${task.owner}/${task.repo}`.toLowerCase(),
            );
            const repo =
              raw === null
                ? old
                  ? { ...old, disabled: true, observedAt: now() }
                  : null
                : parseRepository(raw, now(), "refresh");
            if (raw !== null && !repo) throw new Error("Invalid GitHub repository metadata");
            if (repo) observations.push(repo);
          } else {
            const repo = repos.get(task.id);
            if (repo && eligible(repo)) {
              const release = await request(`/repos/${repo.owner}/${repo.repo}/releases/latest`);
              const pulls = await request(
                `/repos/${repo.owner}/${repo.repo}/pulls?state=closed&sort=updated&direction=desc&per_page=30`,
              );
              const releaseData =
                release === null
                  ? null
                  : z
                      .object({
                        published_at: z.string().nullable(),
                        draft: z.boolean(),
                        prerelease: z.boolean(),
                      })
                      .parse(release);
              const rows =
                pulls === null
                  ? null
                  : z
                      .array(
                        z.object({
                          merged_at: z.string().nullable(),
                          user: z.object({ type: z.string(), login: z.string() }).nullable(),
                        }),
                      )
                      .max(100)
                      .parse(pulls);
              const releaseAt =
                releaseData &&
                !releaseData.draft &&
                !releaseData.prerelease &&
                releaseData.published_at
                  ? Date.parse(releaseData.published_at)
                  : null;
              const mergedPrs =
                rows === null
                  ? null
                  : rows.filter(
                      (pr) =>
                        pr.user?.type === "User" &&
                        !pr.user.login.endsWith("[bot]") &&
                        pr.merged_at &&
                        Date.parse(pr.merged_at) >= now() - 30 * DAY &&
                        Date.parse(pr.merged_at) <= now(),
                    ).length;
              observations.push({
                ...repo,
                releaseAt: releaseAt !== null && Number.isFinite(releaseAt) ? releaseAt : null,
                mergedPrs,
                activityCheckedAt: now(),
              });
            }
          }
        } catch (error) {
          if (!(error instanceof RepositoryUnavailable) || task.kind === "search") throw error;
          const previous =
            task.kind === "activity"
              ? repos.get(task.id)
              : [...repos.values()].find(
                  (repo) =>
                    `${repo.owner}/${repo.repo}`.toLowerCase() ===
                    `${task.owner}/${task.repo}`.toLowerCase(),
                );
          if (previous) observations.push({ ...previous, disabled: true, observedAt: now() });
        }
        cp = { ...cp, index: cp.index + 1 };
        await store.save(lease, now(), LEASE_MS, observations, cp);
        // Track known IDs locally; reload canonical carried activity once per phase.
        // Avoid reading the entire catalog after every individual repository request.
        for (const observation of observations) {
          const previous = repos.get(observation.id);
          if (!previous || previous.observedAt <= observation.observedAt)
            repos.set(observation.id, {
              ...observation,
              firstSeenAt: previous?.firstSeenAt ?? observation.observedAt,
            });
        }
      }
      if (cp.phase === "metadata") {
        repos = new Map((await store.repositories()).map((repo) => [repo.id, repo]));
        const candidates = [...repos.values()]
          .filter((r) => eligible(r) && now() - r.observedAt <= 2 * DAY)
          .sort(
            (a, b) =>
              (a.activityCheckedAt ?? 0) - (b.activityCheckedAt ?? 0) ||
              b.firstSeenAt - a.firstSeenAt ||
              a.id.localeCompare(b.id),
          )
          .slice(0, MAX_ENRICH);
        cp = {
          ...cp,
          phase: "activity",
          index: 0,
          tasks: candidates.map((r) => ({ kind: "activity", id: r.id })),
        };
        await store.save(lease, now(), LEASE_MS, [], cp);
        continue;
      }
      const snapshot = buildSnapshot(
        await store.repositories(),
        await store.metrics(now() - 10 * DAY),
        now(),
      );
      await store.publish(lease, now(), snapshot);
      return { status: "published", requests, searchRequests, cards: snapshot.cards.length };
    }
  } catch (error) {
    const paused = error instanceof Pause;
    // Never include response bodies, credentials, or arbitrary upstream errors in persisted diagnostics.
    const reason =
      error instanceof Budget
        ? "Run budget exhausted"
        : paused
          ? error.message
          : "Discovery scan failed";
    await store.release(lease, now(), reason, paused ? error.retryAt : undefined);
    if (!(error instanceof Budget) && !paused) throw new Error(reason, { cause: error });
    return { status: paused ? "paused" : "partial", requests, searchRequests };
  }
}

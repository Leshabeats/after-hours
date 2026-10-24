import type {
  DailyMetric,
  DiscoveryCard,
  DiscoverySnapshot,
  GameTag,
  Observation,
  StoredRepository,
} from "./types.ts";

export const DAY = 86_400_000;
// Explicit independent distributions may be useful even when GitHub marks them forks.
export const FORK_EXCEPTIONS = new Set(["gloriouseggroll/proton-ge-custom"]);
const MANUAL_TAGS: Record<string, GameTag[]> = {
  "valvesoftware/proton": ["proton", "linux-gaming"],
  "gloriouseggroll/proton-ge-custom": ["proton", "linux-gaming", "steamos"],
  "valvesoftware/gamescope": ["tools", "linux-gaming", "steamos"],
};

export function classifyRepository(
  input: Pick<Observation, "owner" | "repo" | "description" | "topics">,
): GameTag[] {
  const key = `${input.owner}/${input.repo}`.toLowerCase();
  const text = `${input.repo} ${input.description} ${input.topics.join(" ")}`.toLowerCase();
  const topics = new Set(input.topics.map((topic) => topic.toLowerCase()));
  const tags = new Set<GameTag>(MANUAL_TAGS[key] ?? []);
  const game = /\b(game|games|gaming|gamedev|game-development|godot|unity|unreal|bevy)\b/.test(
    text,
  );
  if (topics.has("game-engine") || (game && /\bengine\b/.test(text))) tags.add("engines");
  if (
    topics.has("game-development") ||
    (game && /\b(tool|tools|editor|debugger|level-editor|sdk)\b/.test(text))
  )
    tags.add("tools");
  if (
    topics.has("game-assets") ||
    (game && /\b(assets?|sprites?|tilesets?|textures?|models?|shaders?)\b/.test(text))
  )
    tags.add("assets");
  const console =
    /\b(nes|snes|gameboy|game-boy|gamecube|playstation|ps[123]|nintendo|wii|dreamcast|retro-gaming|retrogaming|console-emulator)\b/.test(
      text,
    );
  if (/\b(emulator|emulation)\b/.test(text) && (game || console) && !/terminal.emulator/.test(text))
    tags.add("emulation");
  if (/\b(steamos|steam-deck|steamdeck)\b|steam deck/.test(text)) {
    tags.add("steamos");
    tags.add("linux-gaming");
  }
  if (/\bproton\b/.test(text) && /\b(steam|wine|gaming|compatibility|linux|dxvk)\b/.test(text)) {
    tags.add("proton");
    tags.add("linux-gaming");
  }
  if (topics.has("linux-gaming") || (game && /\b(linux|wine|dxvk)\b/.test(text)))
    tags.add("linux-gaming");
  return [...tags].sort();
}

export function eligible(repo: Observation): boolean {
  return (
    !repo.archived &&
    !repo.disabled &&
    !repo.mirror &&
    repo.tags.length > 0 &&
    (!repo.fork || FORK_EXCEPTIONS.has(`${repo.owner}/${repo.repo}`.toLowerCase()))
  );
}

export function buildSnapshot(
  repos: StoredRepository[],
  metrics: DailyMetric[],
  now: number,
): DiscoverySnapshot {
  const scored = repos
    .filter((repo) => eligible(repo) && now - repo.observedAt <= 2 * DAY)
    .map((repo) => {
      const history = metrics
        .filter(
          (row) =>
            row.repoId === repo.id &&
            repo.observedAt - row.observedAt >= 6 * DAY &&
            repo.observedAt - row.observedAt <= 9 * DAY,
        )
        .sort(
          (a, b) =>
            Math.abs(repo.observedAt - a.observedAt - 7 * DAY) -
            Math.abs(repo.observedAt - b.observedAt - 7 * DAY),
        );
      const baseline = history[0];
      const delta = baseline ? repo.stars - baseline.stars : null;
      const activityFresh =
        repo.activityCheckedAt !== null && now - repo.activityCheckedAt <= 7 * DAY;
      const releaseFresh =
        activityFresh && repo.releaseAt !== null && now - repo.releaseAt <= 30 * DAY;
      const merged = activityFresh && (repo.mergedPrs ?? 0) > 0;
      const growing =
        delta !== null &&
        delta >= 10 &&
        delta / Math.max(baseline.stars, 20) >= 0.02 &&
        (releaseFresh || merged);
      const badges: DiscoveryCard["badges"] = [];
      const reasons: string[] = [];
      if (now - repo.createdAt <= 30 * DAY) {
        badges.push("new");
        reasons.push("Репозиторий создан за последние 30 дней");
      }
      if (now - repo.firstSeenAt <= 7 * DAY) {
        badges.push("discovered");
        reasons.push("Добавлен в каталог за последние 7 дней");
      }
      const growth =
        baseline && delta !== null
          ? {
              stars: delta,
              days: Math.round(((repo.observedAt - baseline.observedAt) / DAY) * 10) / 10,
            }
          : null;
      if (growing) {
        badges.push("growing");
        reasons.push(`+${delta} звёзд за ${growth!.days} дн. наблюдений`);
      }
      if (releaseFresh) reasons.push("Есть релиз за последние 30 дней");
      if (merged) reasons.push("Есть принятые PR в проверенной выборке за 30 дней");
      if (!reasons.length) reasons.push("Подходит по тематике GameDev");
      const card: DiscoveryCard = {
        id: repo.id,
        owner: repo.owner,
        repo: repo.repo,
        description: repo.description,
        blurb: repo.description,
        logoUrl: `https://github.com/${repo.owner}.png`,
        url: `https://github.com/${repo.owner}/${repo.repo}`,
        language: repo.language,
        stars: repo.stars,
        live: false,
        tags: repo.tags,
        createdAt: repo.createdAt,
        firstSeenAt: repo.firstSeenAt,
        observedAt: repo.observedAt,
        badges,
        reasons,
        growth,
      };
      const score =
        (growing ? 6 : 0) +
        (badges.includes("new") ? 3 : 0) +
        (releaseFresh ? 2 : 0) +
        (merged ? 2 : 0) +
        Math.min(Math.log10(repo.stars + 1), 3) / 3;
      return { card, score };
    });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.card.createdAt - a.card.createdAt ||
      a.card.id.localeCompare(b.card.id),
  );
  // Keep room for every subcategory; UI paginates/filters a bounded snapshot.
  return { version: 1, generatedAt: now, cards: scored.slice(0, 100).map(({ card }) => card) };
}

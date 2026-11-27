import { parseCategoryId, type CatalogSearch } from "../catalog.ts";
import {
  ISSUE_MAX_AGE_MS,
  isDiscoveryWorld,
  type DiscoveryCard,
  type DiscoveryLoad,
} from "./types.ts";

type DiscoveryFilters = Omit<CatalogSearch, "lang" | "tag"> & { lang?: string; tag?: string };

export const DISCOVERY_BADGES = {
  new: "Недавно создан",
  discovered: "Недавно найден",
  active: "Активен",
  growing: "Растёт",
} as const;

export function filterDiscovery(
  cards: DiscoveryCard[] | null | undefined,
  search: DiscoveryFilters,
): DiscoveryCard[] {
  const world = parseCategoryId(search.cat);
  if (!isDiscoveryWorld(world)) return [];
  return (cards ?? []).filter(
    (card) =>
      card.isPublic === true &&
      (card.world ?? "games") === world &&
      (!search.lang || card.language?.toLowerCase() === search.lang.toLowerCase()) &&
      (!search.tag || card.tags.some((tag) => tag === search.tag)) &&
      (!search.view || search.view === "all" || card.badges.includes(search.view)),
  );
}

export function recentDiscoveryIssues(card: DiscoveryCard, now: number) {
  if (card.isPublic !== true) return [];
  return (card.issues ?? []).filter(
    (issue) => issue.checkedAt <= now && now - issue.checkedAt < ISSUE_MAX_AGE_MS,
  );
}

export function indexedIssues(cards: DiscoveryCard[], search: DiscoveryFilters, now: number) {
  return filterDiscovery(cards, search)
    .flatMap((card) =>
      recentDiscoveryIssues(card, now).map((issue, index) => ({
        ...issue,
        rank: index,
        owner: card.owner,
        repo: card.repo,
        repoId: card.id,
      })),
    )
    .sort((a, b) => a.rank - b.rank);
}

export function discoveryDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("ru-RU", { timeZone: "UTC" });
}

function discoveryTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(timestamp);
}

export function discoveryFreshness(discovery: DiscoveryLoad | undefined): string {
  if (!discovery || discovery.status === "unavailable")
    return "Ежедневная подборка сейчас недоступна. Ниже — проекты с полки.";
  if (discovery.updatedAt === null)
    return "Первая ежедневная подборка ещё не опубликована. Ниже — проекты с полки.";
  return `Данные на ${discoveryTimestamp(discovery.updatedAt)} (UTC). ${discovery.stale ? "Обновление задерживается. Показана последняя подборка." : "Последняя опубликованная подборка."}`;
}

export function growthLabel(growth: DiscoveryCard["growth"]): string | null {
  if (!growth || !Number.isFinite(growth.days) || growth.days <= 0) return null;
  return `${growth.stars > 0 ? "+" : ""}${growth.stars.toLocaleString("ru-RU")} ★ за ${growth.days.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} дн.`;
}

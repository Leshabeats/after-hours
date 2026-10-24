import type { CatalogSearch } from "../catalog.ts";
import type { ProjectCard, ProjectShelf } from "../github-live.ts";
import type { DiscoveryCard, DiscoveryLoad } from "./types.ts";

export const DISCOVERY_BADGES = {
  new: "Недавно создан",
  discovered: "Недавно найден",
  growing: "Растёт",
} as const;

export function filterDiscovery(
  cards: DiscoveryCard[] | null | undefined,
  search: CatalogSearch,
): DiscoveryCard[] {
  if (search.cat !== "games") return [];
  return (cards ?? []).filter(
    (card) =>
      card.isPublic === true &&
      (!search.lang || card.language?.toLowerCase() === search.lang.toLowerCase()) &&
      (!search.tag || card.tags.includes(search.tag)) &&
      (!search.view || search.view === "all" || card.badges.includes(search.view)),
  );
}

export function fateProjects(
  shelf: ProjectShelf,
  search: CatalogSearch,
): (ProjectCard | DiscoveryCard)[] {
  const ids = new Set<string>();
  const discovery = filterDiscovery(shelf.discovery?.cards, search).filter((card) => {
    if (ids.has(card.id)) return false;
    ids.add(card.id);
    return true;
  });
  // Curated shelves lack stable IDs. Suppress their URL duplicates without merging
  // distinct discovery identities, even if an older snapshot retained a reused slug.
  const slugs = new Set(discovery.map((card) => `${card.owner}/${card.repo}`.toLowerCase()));
  const curated = [...shelf.ecosystem, ...shelf.direction, ...shelf.libraries].filter((project) => {
    const slug = `${project.owner}/${project.repo}`.toLowerCase();
    if (slugs.has(slug)) return false;
    slugs.add(slug);
    return true;
  });
  return [...discovery, ...curated];
}

export function discoveryDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("ru-RU", { timeZone: "UTC" });
}

export function discoveryFreshness(discovery: DiscoveryLoad | undefined): string {
  if (!discovery || discovery.status === "unavailable")
    return "Ежедневная подборка сейчас недоступна. Ниже — проекты с полки.";
  if (discovery.updatedAt === null)
    return "Первая ежедневная подборка ещё не опубликована. Ниже — проекты с полки.";
  return `Данные на ${discoveryDate(discovery.updatedAt)} (UTC). ${discovery.stale ? "Обновление задерживается; показана последняя подборка." : "Последняя завершённая подборка."}`;
}

export function growthLabel(growth: DiscoveryCard["growth"]): string | null {
  if (!growth || !Number.isFinite(growth.days) || growth.days <= 0) return null;
  return `${growth.stars > 0 ? "+" : ""}${growth.stars.toLocaleString("ru-RU")} ★ за ${growth.days.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} дн.`;
}

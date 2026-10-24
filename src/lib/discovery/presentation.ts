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
      (!search.lang || card.language?.toLowerCase() === search.lang.toLowerCase()) &&
      (!search.tag || card.tags.includes(search.tag)) &&
      (!search.view || search.view === "all" || card.badges.includes(search.view)),
  );
}

export function fateProjects(
  shelf: ProjectShelf,
  search: CatalogSearch,
): (ProjectCard | DiscoveryCard)[] {
  const projects = [
    ...filterDiscovery(shelf.discovery?.cards, search),
    ...shelf.ecosystem,
    ...shelf.direction,
    ...shelf.libraries,
  ];
  const seen = new Set<string>();
  return projects.filter((project) => {
    const key = `${project.owner}/${project.repo}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

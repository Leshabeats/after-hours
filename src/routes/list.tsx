import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { NightShell } from "@/components/night-shell";
import { ProjectCard, DiscoveryStatus } from "@/components/project-card";
import { UrlIntake } from "@/components/url-intake";
import { CatalogFilters } from "@/components/catalog-filters";
import { filterDiscovery } from "@/lib/discovery/presentation";
import type { ProjectCard as Project } from "@/lib/github-live";
import type { DiscoveryCard } from "@/lib/discovery/types";
import { getProjects } from "@/lib/api";
import { LANGUAGES, getCategory, parseCatalogSearch, parseCategoryId } from "@/lib/catalog";

export const Route = createFileRoute("/list")({
  validateSearch: parseCatalogSearch,
  loaderDeps: ({ search }) => ({ cat: search.cat, lang: search.lang }),
  loader: ({ deps }) =>
    getProjects({
      data: {
        category: deps.cat,
        language: deps.lang,
      },
    }),
  pendingComponent: function ListPending() {
    return (
      <NightShell>
        <p className="font-mono text-xs uppercase tracking-caps text-muted">Загрузка эфира</p>
      </NightShell>
    );
  },
  component: ListPage,
});

function matches(
  project: { repo: string; owner: string; description: string; blurb: string },
  query: string,
) {
  return (
    project.repo.toLowerCase().includes(query) ||
    project.owner.toLowerCase().includes(query) ||
    project.description.toLowerCase().includes(query) ||
    project.blurb.toLowerCase().includes(query)
  );
}

function ListPage() {
  const shelf = Route.useLoaderData();
  const search = Route.useSearch();
  const cat = parseCategoryId(search.cat);
  const lang = search.lang;
  const category = getCategory(cat);
  const language = LANGUAGES.find((item) => item.id === lang);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const apply = <T extends { repo: string; owner: string; description: string; blurb: string }>(
      items: T[],
    ) => (query ? items.filter((project) => matches(project, query)) : items);
    return {
      ecosystem: apply(shelf.ecosystem),
      direction: apply(shelf.direction),
      libraries: apply(shelf.libraries),
      discovery: apply(filterDiscovery(shelf.discovery?.cards, search)),
    };
  }, [shelf, q, search]);

  return (
    <NightShell>
      <div className="stagger-in">
        <p className="font-mono text-xs uppercase tracking-caps text-accent">The list</p>
        <h1 className="mt-2 font-display text-5xl italic leading-none sm:text-6xl">
          {language ? language.label : category.label}
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
          {language
            ? `${category.label} и ${language.label} вместе: сверху экосистема языка, ниже проекты этого направления на нём и библиотеки.`
            : `Проекты направления ${category.label}. Язык добавит его экосистему и библиотеки. Ишью открываются внутри.`}
        </p>
        <p className="mt-2 font-mono text-xs text-faint">
          {cat === "games"
            ? shelf.live
              ? "Проекты с полки: данные загружены с GitHub."
              : "Проекты с полки: сохранённые описания."
            : shelf.live
              ? "Эфир GitHub открыт."
              : "Описания с полки. Логотипы подтянутся, когда эфир ответит."}
        </p>
      </div>

      <div className="mt-8 max-w-xl">
        <UrlIntake />
      </div>

      <CatalogFilters to="/list" cat={cat} lang={lang} tag={search.tag} view={search.view} />

      <label className="sr-only" htmlFor="project-search">
        Поиск
      </label>
      <input
        id="project-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Проект"
        suppressHydrationWarning
        className="mt-4 h-12 w-full max-w-md rounded-md bg-surface px-4 text-sm text-fg placeholder:text-faint shadow-border focus:outline-none focus:ring-2 focus:ring-accent/70"
      />

      {cat === "games" ? (
        <section className="mt-10" aria-label="Ежедневные находки GameDev">
          <h2 className="font-mono text-xs uppercase tracking-caps text-muted">
            Ежедневные находки GameDev
          </h2>
          <DiscoveryStatus discovery={shelf.discovery} />
          <p className="mt-2 text-xs leading-relaxed text-faint">
            «Создан» — возраст репозитория. «Найден» — первое обнаружение каталогом. Область и тип
            находки фильтруют эту секцию.
          </p>
          {filtered.discovery.length ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {filtered.discovery.map((project) => (
                <ProjectCard key={`${project.owner}/${project.repo}`} project={project} />
              ))}
            </div>
          ) : shelf.discovery?.status !== "unavailable" && shelf.discovery?.updatedAt != null ? (
            <p className="mt-4 text-sm text-muted">
              {shelf.discovery.cards.length
                ? "По выбранным фильтрам находок пока нет."
                : "В опубликованной подборке пока нет находок."}
            </p>
          ) : null}
        </section>
      ) : null}

      <ProjectSection title="Экосистема" projects={filtered.ecosystem} />
      <ProjectSection
        title={
          cat === "games"
            ? "GameDev · с полки"
            : language
              ? `В направлении ${category.label}`
              : category.label
        }
        projects={filtered.direction}
      />
      <ProjectSection title="Библиотеки" projects={filtered.libraries} />
      {filtered.discovery.length +
        filtered.ecosystem.length +
        filtered.direction.length +
        filtered.libraries.length ===
      0 ? (
        <p className="mt-12 text-sm text-muted">В этой полосе ночь пустая.</p>
      ) : null}
    </NightShell>
  );
}

function ProjectSection({
  title,
  projects,
}: {
  title: string;
  projects: (Project | DiscoveryCard)[];
}) {
  if (projects.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="font-mono text-xs uppercase tracking-caps text-muted">{title}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {projects.map((project) => (
          <ProjectCard key={`${project.owner}/${project.repo}`} project={project} />
        ))}
      </div>
    </section>
  );
}

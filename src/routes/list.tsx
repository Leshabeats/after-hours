import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { NightShell } from "@/components/night-shell";
import { ProjectCard, DiscoveryStatus } from "@/components/project-card";
import { UrlIntake } from "@/components/url-intake";
import { CatalogFilters } from "@/components/catalog-filters";
import { filterDiscovery } from "@/lib/discovery/presentation";
import type { ProjectCard as Project } from "@/lib/github-live";
import { isDiscoveryWorld, type DiscoveryCard } from "@/lib/discovery/types";
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
        {language ? (
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
            {category.label} и {language.label} вместе: экосистема языка, проекты направления и
            библиотеки.
          </p>
        ) : null}
        {isDiscoveryWorld(cat) ? (
          <DiscoveryStatus discovery={shelf.discovery} />
        ) : (
          <p className="mt-2 text-xs text-faint">
            {shelf.live
              ? "Проекты направления с редакционной полки. Данные карточек обновляются из GitHub."
              : "Показаны сохранённые описания проектов."}
          </p>
        )}
      </div>

      <CatalogFilters to="/list" cat={cat} lang={lang} tag={search.tag} view={search.view} />

      <label className="sr-only" htmlFor="project-search">
        Найти проект в каталоге
      </label>
      <input
        id="project-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Найти проект в каталоге"
        suppressHydrationWarning
        className="mt-4 h-12 w-full max-w-md rounded-md bg-surface px-4 text-sm text-fg placeholder:text-faint shadow-border focus:outline-none focus:ring-2 focus:ring-accent/70"
      />

      {shelf.discovery?.updatedAt != null ? (
        <section className="mt-6" aria-label={`Ежедневные находки ${category.label}`}>
          <h2 className="font-mono text-xs uppercase tracking-caps text-muted">
            Ежедневные находки {category.label}
          </h2>
          {filtered.discovery.length ? (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {filtered.discovery.map((project) => (
                <ProjectCard key={`github:${project.id}`} project={project} />
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">
              {shelf.discovery.cards.length
                ? "По выбранным фильтрам находок пока нет."
                : "В опубликованной подборке пока нет находок."}
            </p>
          )}
        </section>
      ) : null}
      <ProjectSection title="Экосистема" projects={filtered.ecosystem} />
      <ProjectSection
        title={
          isDiscoveryWorld(cat)
            ? `${category.label} · с полки`
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
      <details className="mt-8 max-w-xl">
        <summary className="w-fit cursor-pointer rounded-sm py-2 text-sm text-fg">
          Открыть задачу по ссылке
        </summary>
        <div className="mt-3">
          <UrlIntake />
        </div>
      </details>
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
    <section className="mt-6">
      <h2 className="font-mono text-xs uppercase tracking-caps text-muted">{title}</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {projects.map((project) => (
          <ProjectCard
            key={"id" in project ? `github:${project.id}` : `${project.owner}/${project.repo}`}
            project={project}
          />
        ))}
      </div>
    </section>
  );
}

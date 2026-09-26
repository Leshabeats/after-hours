import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { NightShell } from "@/components/night-shell";
import { Button } from "@/components/ui/button";
import { CatalogFilters } from "@/components/catalog-filters";
import { getProjects } from "@/lib/api";
import { getCategory, parseCatalogSearch, parseCategoryId } from "@/lib/catalog";
import type { ProjectCard } from "@/lib/github-live";

export const Route = createFileRoute("/fate")({
  validateSearch: parseCatalogSearch,
  loaderDeps: ({ search }) => ({ cat: search.cat, lang: search.lang }),
  loader: ({ deps }) =>
    getProjects({
      data: {
        category: deps.cat,
        language: deps.lang,
      },
    }),
  pendingComponent: function FatePending() {
    return (
      <NightShell>
        <p className="font-mono text-xs uppercase tracking-caps text-muted">
          Загрузка эфира
        </p>
      </NightShell>
    );
  },
  component: FatePage,
});

function pick(projects: ProjectCard[], avoid?: string) {
  const pool = avoid
    ? projects.filter((project) => `${project.owner}/${project.repo}` !== avoid)
    : projects;
  const list = pool.length ? pool : projects;
  return list[Math.floor(Math.random() * list.length)];
}

function FatePage() {
  const shelf = Route.useLoaderData();
  const projects = useMemo(
    () => [...shelf.ecosystem, ...shelf.direction, ...shelf.libraries],
    [shelf],
  );
  const search = Route.useSearch();
  const cat = parseCategoryId(search.cat);
  const lang = search.lang;
  const category = getCategory(cat);
  const [spinning, setSpinning] = useState(true);
  const [project, setProject] = useState<ProjectCard | null>(null);
  const reduced = usePrefersReducedMotion();

  const strip = useMemo(() => {
    if (projects.length === 0) return [];
    const times = Math.max(8, Math.ceil(24 / projects.length));
    return Array.from({ length: times }, () => projects).flat();
  }, [projects]);

  useEffect(() => {
    setProject(null);
    if (projects.length === 0) {
      setSpinning(false);
      return;
    }
    if (reduced) {
      setProject(pick(projects));
      setSpinning(false);
      return;
    }
    setSpinning(true);
    const chosen = pick(projects);
    const id = window.setTimeout(() => {
      setProject(chosen);
      setSpinning(false);
    }, 2200);
    return () => window.clearTimeout(id);
  }, [projects, reduced]);

  function reroll() {
    const next = pick(projects, project ? `${project.owner}/${project.repo}` : undefined);
    if (reduced) {
      setProject(next);
      return;
    }
    setSpinning(true);
    window.setTimeout(() => {
      setProject(next);
      setSpinning(false);
    }, 1800);
  }

  return (
    <NightShell>
      <p className="font-mono text-xs uppercase tracking-caps text-accent">
        Как повезёт
      </p>
      <h1 className="mt-2 font-display text-5xl italic leading-none sm:text-6xl">
        Ночь решает
      </h1>
      <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted">
        Один проект
        {lang ? ` экосистемы ${lang}` : ` направления ${category.label}`}. Ишью
        уже внутри.
      </p>

      <CatalogFilters to="/fate" cat={cat} lang={lang} />

      {projects.length === 0 ? (
        <p className="mt-10 text-sm text-muted">В этой полосе ночь пустая.</p>
      ) : (
        <div className="relative mt-10 overflow-hidden rounded-xl bg-surface shadow-border">
          {spinning ? (
            <div className="relative h-72 overflow-hidden">
              <ul className="spin-strip py-8">
                {strip.map((item, i) => (
                  <li
                    key={`${item.owner}/${item.repo}-${i}`}
                    className="px-6 py-3 font-display text-2xl italic text-fg/80 sm:text-3xl"
                  >
                    {item.repo}
                  </li>
                ))}
              </ul>
            </div>
          ) : project ? (
            <div className="stagger-in flex gap-5 border-l-2 border-accent px-6 py-10 sm:px-10">
              <img
                src={project.logoUrl}
                alt=""
                width={64}
                height={64}
                className="size-16 shrink-0 rounded-lg bg-bg object-cover"
              />
              <div>
                <p className="font-mono text-xs text-muted">{project.owner}</p>
                <h2 className="mt-2 font-display text-4xl italic leading-none">
                  {project.repo}
                </h2>
                <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
                  {project.description}
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Button asChild size="lg">
                    <Link
                      to="/r/$owner/$repo"
                      params={{ owner: project.owner, repo: project.repo }}
                    >
                      Открыть ишью
                    </Link>
                  </Button>
                  <Button type="button" variant="ghost" size="lg" onClick={reroll}>
                    Ещё раз
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </NightShell>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

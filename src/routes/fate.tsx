import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CatalogFilters } from "@/components/catalog-filters";
import { NightShell } from "@/components/night-shell";
import { Button } from "@/components/ui/button";
import { getFateMissions } from "@/lib/api";
import { getCategory, parseCatalogSearch, parseCategoryId } from "@/lib/catalog";
import { excerptOf } from "@/lib/kinds";
import type { PublicMission } from "@/lib/mcp/missions";

export const Route = createFileRoute("/fate")({
  validateSearch: parseCatalogSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    getFateMissions({
      data: {
        category: parseCategoryId(deps.cat),
        language: deps.lang,
        tag: deps.tag,
        view: deps.view,
      },
    }),
  pendingComponent: function FatePending() {
    return (
      <NightShell>
        <p className="font-mono text-xs uppercase tracking-caps text-muted">
          Проверяем открытые задачи
        </p>
      </NightShell>
    );
  },
  component: FatePage,
});

function FatePage() {
  const { issues, start, unavailable } = Route.useLoaderData();
  const search = Route.useSearch();
  const cat = parseCategoryId(search.cat);
  const category = getCategory(cat);

  return (
    <NightShell>
      <p className="font-mono text-xs uppercase tracking-caps text-accent">Как повезёт</p>
      <h1 className="mt-2 font-display text-5xl italic leading-none sm:text-6xl">Ночь решает</h1>
      <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted">
        Открытая задача для исследования · {category.label}
        {search.lang ? ` · ${search.lang}` : ""}
      </p>
      <CatalogFilters to="/fate" cat={cat} lang={search.lang} tag={search.tag} view={search.view} />
      {issues.length ? (
        <FateChoice
          key={issues.map((issue) => issue.missionId).join("|")}
          issues={issues}
          start={start}
        />
      ) : (
        <div className="mt-8 space-y-4">
          <p role="status" className="text-sm text-muted">
            {unavailable
              ? "GitHub сейчас недоступен. В каталоге сохранена последняя подборка."
              : "Для этих фильтров пока нет подходящих открытых задач."}
          </p>
          <Button asChild variant="ghost">
            <Link to="/list" search={search}>
              Перейти в каталог
            </Link>
          </Button>
        </div>
      )}
    </NightShell>
  );
}

function FateChoice({ issues, start }: { issues: PublicMission[]; start: number }) {
  const [selected, setSelected] = useState(start);
  const issue = issues[selected];

  function reroll() {
    const offset = 1 + Math.floor(Math.random() * (issues.length - 1));
    setSelected((current) => (current + offset) % issues.length);
  }

  return (
    <section
      className="stagger-in mt-8 min-w-0 rounded-xl border-l-2 border-accent bg-surface p-5 wrap-anywhere shadow-border sm:p-8"
    >
      <p className="font-mono text-xs text-muted">
        {issue.owner}/{issue.repo} · #{issue.number}
      </p>
      <h2 className="mt-2 text-xl font-medium leading-snug sm:text-2xl">{issue.title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted">{excerptOf(issue.body)}</p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link
            to="/m/$owner/$repo/$number"
            params={{ owner: issue.owner, repo: issue.repo, number: String(issue.number) }}
          >
            Открыть задачу
          </Link>
        </Button>
        {issues.length > 1 ? (
          <Button type="button" variant="ghost" size="lg" onClick={reroll}>
            Ещё раз
          </Button>
        ) : null}
      </div>
    </section>
  );
}

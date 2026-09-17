import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { NightShell } from "@/components/night-shell";
import { MissionCard } from "@/components/mission-card";
import { UrlIntake } from "@/components/url-intake";
import { FilterChip } from "@/components/filter-chip";
import { CatalogFilters } from "@/components/catalog-filters";
import { getMissions } from "@/lib/api";
import {
  MIN_STARS,
  getCategory,
  parseCatalogSearch,
  parseCategoryId,
} from "@/lib/catalog";
import { KIND_META, KINDS, type Kind } from "@/lib/kinds";

export const Route = createFileRoute("/list")({
  validateSearch: parseCatalogSearch,
  loaderDeps: ({ search }) => ({ cat: search.cat, lang: search.lang }),
  loader: ({ deps }) =>
    getMissions({
      data: {
        category: deps.cat,
        language: deps.lang,
      },
    }),
  pendingComponent: function ListPending() {
    return (
      <NightShell>
        <p className="font-mono text-xs uppercase tracking-caps text-muted">
          Загрузка эфира
        </p>
      </NightShell>
    );
  },
  component: ListPage,
});

function ListPage() {
  const { missions, live } = Route.useLoaderData();
  const search = Route.useSearch();
  const cat = parseCategoryId(search.cat);
  const lang = search.lang;
  const category = getCategory(cat);
  const [kind, setKind] = useState<Kind | "all">("all");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return missions.filter((m) => {
      if (kind !== "all" && m.kind !== kind) return false;
      if (!query) return true;
      return (
        m.title.toLowerCase().includes(query) ||
        m.repo.toLowerCase().includes(query) ||
        m.owner.toLowerCase().includes(query) ||
        m.language.toLowerCase().includes(query)
      );
    });
  }, [missions, kind, q]);

  return (
    <NightShell>
      <div className="stagger-in">
        <p className="font-mono text-xs uppercase tracking-caps text-accent">
          The list
        </p>
        <h1 className="mt-2 font-display text-5xl italic leading-none sm:text-6xl">
          Список ночи
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
          Коммитить есть смысл туда, где уже есть люди. Сейчас {category.label}:
          репозитории от {MIN_STARS} звёзд, не вся свалка языка.
        </p>
        <p className="mt-2 font-mono text-xs text-faint">
          {live ? "Эфир GitHub открыт." : "Эфир молчит. Последняя известная ночь."}{" "}
          {filtered.length}{" "}
          {filtered.length === 1 ? "миссия" : "миссий"}
        </p>
      </div>

      <div className="mt-8 max-w-xl">
        <UrlIntake />
      </div>

      <CatalogFilters to="/list" cat={cat} lang={lang} />

      <div className="mt-6">
        <p className="font-mono text-xs uppercase tracking-caps text-muted">
          Тип
        </p>
        <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1">
          <FilterChip
            type="button"
            active={kind === "all"}
            onClick={() => setKind("all")}
          >
            Все
          </FilterChip>
          {KINDS.map((k) => (
            <FilterChip
              key={k}
              type="button"
              active={kind === k}
              onClick={() => setKind(k)}
            >
              {KIND_META[k].track}
            </FilterChip>
          ))}
        </div>
      </div>

      <label className="sr-only" htmlFor="mission-search">
        Поиск
      </label>
      <input
        id="mission-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Репозиторий или заголовок"
        suppressHydrationWarning
        className="mt-4 h-12 w-full max-w-md rounded-md bg-surface px-4 text-sm text-fg placeholder:text-faint shadow-border focus:outline-none focus:ring-2 focus:ring-accent/70"
      />

      {filtered.length === 0 ? (
        <p className="mt-12 text-sm text-muted">В этой полосе ночь пустая.</p>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {filtered.map((mission) => (
            <MissionCard key={mission.id} mission={mission} />
          ))}
        </div>
      )}
    </NightShell>
  );
}

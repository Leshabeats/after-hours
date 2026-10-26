import { Link } from "@tanstack/react-router";
import { FilterChip } from "@/components/filter-chip";
import {
  LANGUAGES,
  DISCOVERY_MODES,
  changeCatalogSearch,
  WORLDS,
  type CategoryId,
  type LanguageId,
} from "@/lib/catalog";
import { GAME_TAGS, type GameTag, type DiscoveryMode } from "@/lib/discovery/types";
import type { ReactNode } from "react";

type CatalogTo = "/list" | "/fate";

export function CatalogFilters({
  to,
  cat,
  lang,
  tag,
  view,
}: {
  to: CatalogTo;
  cat: CategoryId;
  lang?: LanguageId;
  tag?: GameTag;
  view?: DiscoveryMode;
}) {
  const search = { cat, lang, tag, view };
  return (
    <div className="mt-8 space-y-5">
      <FilterRow label="Направление">
        {WORLDS.map((item) => (
          <FilterChip key={item.id} active={cat === item.id} asChild>
            <Link to={to} search={changeCatalogSearch(search, { cat: item.id })}>
              {item.label}
            </Link>
          </FilterChip>
        ))}
      </FilterRow>
      {cat === "games" ? (
        <>
          <FilterRow label="Область GameDev">
            <FilterChip active={!tag} asChild>
              <Link to={to} search={changeCatalogSearch(search, { tag: undefined })}>
                Все области
              </Link>
            </FilterChip>
            {GAME_TAGS.map((item) => (
              <FilterChip key={item.id} active={tag === item.id} asChild>
                <Link to={to} search={changeCatalogSearch(search, { tag: item.id })}>
                  {item.label}
                </Link>
              </FilterChip>
            ))}
          </FilterRow>
          <FilterRow label="Ежедневные находки">
            {DISCOVERY_MODES.map((item) => (
              <FilterChip key={item.id} active={(view ?? "all") === item.id} asChild>
                <Link to={to} search={changeCatalogSearch(search, { view: item.id })}>
                  {item.label}
                </Link>
              </FilterChip>
            ))}
          </FilterRow>
        </>
      ) : null}
      <FilterRow label="Язык">
        <FilterChip active={!lang} asChild>
          <Link to={to} search={changeCatalogSearch(search, { lang: undefined })}>
            Все
          </Link>
        </FilterChip>
        {LANGUAGES.map((item) => (
          <FilterChip key={item.id} active={lang === item.id} asChild>
            <Link to={to} search={changeCatalogSearch(search, { lang: item.id })}>
              {item.label}
            </Link>
          </FilterChip>
        ))}
      </FilterRow>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-caps text-muted">{label}</p>
      <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1">{children}</div>
    </div>
  );
}

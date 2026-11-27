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
import {
  WORLD_TAGS,
  isDiscoveryWorld,
  type DiscoveryTag,
  type DiscoveryMode,
} from "@/lib/discovery/types";
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
  tag?: DiscoveryTag;
  view?: DiscoveryMode;
}) {
  const search = { cat, lang, tag, view };
  const tags = isDiscoveryWorld(cat) ? WORLD_TAGS[cat] : [];
  const mode = DISCOVERY_MODES.find((item) => item.id === view && view !== "all");
  const selectedOptions = [lang, mode?.label].filter(Boolean).join(" · ");
  return (
    <div className="mt-6 space-y-3">
      <FilterRow label="Направление">
        {WORLDS.map((item) => (
          <FilterChip key={item.id} active={cat === item.id} asChild>
            <Link to={to} search={changeCatalogSearch(search, { cat: item.id })}>
              {item.label}
            </Link>
          </FilterChip>
        ))}
      </FilterRow>
      {tags.length ? (
        <FilterRow label="Тема">
          <FilterChip active={!tag} asChild>
            <Link to={to} search={changeCatalogSearch(search, { tag: undefined })}>
              Все темы
            </Link>
          </FilterChip>
          {tags.map((item) => (
            <FilterChip key={item.id} active={tag === item.id} asChild>
              <Link to={to} search={changeCatalogSearch(search, { tag: item.id })}>
                {item.label}
              </Link>
            </FilterChip>
          ))}
        </FilterRow>
      ) : null}
      <details>
        <summary className="w-fit cursor-pointer rounded-sm py-2 text-sm text-fg">
          Фильтры{selectedOptions ? ` · ${selectedOptions}` : ""}
        </summary>
        <div className="space-y-3 pt-2">
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
          {tags.length ? (
            <FilterRow label="Ежедневные находки">
              {DISCOVERY_MODES.map((item) => (
                <FilterChip key={item.id} active={(view ?? "all") === item.id} asChild>
                  <Link to={to} search={changeCatalogSearch(search, { view: item.id })}>
                    {item.label}
                  </Link>
                </FilterChip>
              ))}
            </FilterRow>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-caps text-muted">{label}</p>
      <div className="mt-2 flex gap-2 overflow-x-auto p-1 [scrollbar-width:thin]">{children}</div>
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import { FilterChip } from "@/components/filter-chip";
import {
  CATEGORIES,
  LANGUAGES,
  type CategoryId,
  type LanguageId,
} from "@/lib/catalog";
import type { ReactNode } from "react";

type CatalogTo = "/list" | "/fate";

export function CatalogFilters({
  to,
  cat,
  lang,
}: {
  to: CatalogTo;
  cat: CategoryId;
  lang?: LanguageId;
}) {
  return (
    <div className="mt-8 space-y-5">
      <FilterRow label="Направление">
        {CATEGORIES.map((item) => (
          <FilterChip key={item.id} active={cat === item.id} asChild>
            <Link
              to={to}
              search={
                lang
                  ? { cat: item.id, lang }
                  : item.id === "web"
                    ? {}
                    : { cat: item.id }
              }
            >
              {item.label}
            </Link>
          </FilterChip>
        ))}
      </FilterRow>
      <FilterRow label="Язык">
        <FilterChip active={!lang} asChild>
          <Link to={to} search={{ cat }}>
            Все
          </Link>
        </FilterChip>
        {LANGUAGES.map((item) => (
          <FilterChip key={item.id} active={lang === item.id} asChild>
            <Link to={to} search={{ cat, lang: item.id }}>
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

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { NightShell } from "@/components/night-shell";
import { MissionCard } from "@/components/mission-card";
import { FilterChip } from "@/components/filter-chip";
import { getRepoMissions } from "@/lib/api";
import { KIND_META, KINDS, type Kind } from "@/lib/kinds";

export const Route = createFileRoute("/r/$owner/$repo")({
  loader: ({ params }) => getRepoMissions({ data: params }),
  pendingComponent: function RepoPending() {
    return (
      <NightShell>
        <p className="font-mono text-xs uppercase tracking-caps text-muted">
          Загрузка ишью
        </p>
      </NightShell>
    );
  },
  component: RepoPage,
});

function RepoPage() {
  const { owner, repo } = Route.useParams();
  const { missions, live, profile } = Route.useLoaderData();
  const [kind, setKind] = useState<Kind | "all">("all");
  const shown = useMemo(
    () => (kind === "all" ? missions : missions.filter((mission) => mission.kind === kind)),
    [missions, kind],
  );
  const why = profile.blurb && profile.blurb !== profile.description ? profile.blurb : "";

  return (
    <NightShell>
      <Link to="/list" className="text-xs text-muted hover:text-fg">
        К списку
      </Link>
      <div className="mt-6 flex gap-4">
        <img
          src={profile.logoUrl}
          alt=""
          width={56}
          height={56}
          className="size-14 shrink-0 rounded-lg bg-bg object-cover"
        />
        <div>
          <p className="font-mono text-xs uppercase tracking-caps text-accent">
            {owner}
          </p>
          <h1 className="mt-2 font-display text-5xl italic leading-none sm:text-6xl">
            {repo}
          </h1>
        </div>
      </div>
      <div className="mt-5 max-w-xl space-y-3 text-sm leading-relaxed">
        {profile.description ? (
          <p className="text-fg">
            <span className="text-faint">Что. </span>
            {profile.description}
          </p>
        ) : null}
        {why ? (
          <p className="text-muted">
            <span className="text-faint">Зачем. </span>
            {why}
          </p>
        ) : null}
        <p>
          <a
            href={profile.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-fg underline decoration-border underline-offset-4 hover:decoration-fg"
          >
            Репозиторий
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
          {profile.stars != null ? (
            <span className="ml-3 font-mono text-xs text-faint">
              {profile.stars.toLocaleString("ru-RU")} звёзд
            </span>
          ) : null}
        </p>
        <p className="text-xs text-faint">
          {live ? "Эфир GitHub открыт." : "Эфир молчит."}
        </p>
      </div>

      <div className="mt-8 flex flex-wrap gap-2">
        <FilterChip type="button" active={kind === "all"} onClick={() => setKind("all")}>
          Все
        </FilterChip>
        {KINDS.map((id) => {
          const meta = KIND_META[id];
          return (
            <span key={id} className="group relative">
              <FilterChip
                type="button"
                active={kind === id}
                aria-label={`${meta.track}. ${meta.label}. ${meta.duty}`}
                onClick={() => setKind(id)}
              >
                {meta.track}
              </FilterChip>
              <span
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-56 -translate-x-1/2 rounded-lg bg-elevated px-3 py-2 text-left shadow-border group-hover:block group-focus-within:block"
              >
                <span className="block font-mono text-[10px] uppercase tracking-caps text-accent">
                  {meta.label}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-fg">
                  {meta.duty}
                </span>
              </span>
            </span>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="mt-12 text-sm text-muted">Открытых ишью нет.</p>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {shown.map((mission) => (
            <MissionCard key={mission.id} mission={mission} />
          ))}
        </div>
      )}
    </NightShell>
  );
}

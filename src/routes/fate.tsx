import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { NightShell } from "@/components/night-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getMissions } from "@/lib/api";
import { KIND_META, type Mission } from "@/lib/kinds";

export const Route = createFileRoute("/fate")({
  loader: () => getMissions(),
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

function pick(missions: Mission[], avoid?: string) {
  const pool = avoid ? missions.filter((m) => m.id !== avoid) : missions;
  const list = pool.length ? pool : missions;
  return list[Math.floor(Math.random() * list.length)];
}

function FatePage() {
  const { missions } = Route.useLoaderData();
  const [spinning, setSpinning] = useState(true);
  const [mission, setMission] = useState<Mission | null>(null);
  const reduced = usePrefersReducedMotion();

  const strip = useMemo(() => {
    if (missions.length === 0) return [];
    const times = Math.max(8, Math.ceil(24 / missions.length));
    return Array.from({ length: times }, () => missions).flat();
  }, [missions]);

  useEffect(() => {
    if (missions.length === 0) return;
    if (reduced) {
      setMission(pick(missions));
      setSpinning(false);
      return;
    }
    const chosen = pick(missions);
    const id = window.setTimeout(() => {
      setMission(chosen);
      setSpinning(false);
    }, 2200);
    return () => window.clearTimeout(id);
  }, [missions, reduced]);

  function reroll() {
    const next = pick(missions, mission?.id);
    if (reduced) {
      setMission(next);
      return;
    }
    setSpinning(true);
    window.setTimeout(() => {
      setMission(next);
      setSpinning(false);
    }, 1800);
  }

  if (missions.length === 0) {
    return (
      <NightShell>
        <p className="text-muted">Ночь пустая. Зайди в список позже.</p>
      </NightShell>
    );
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
        Один слот. Без выбора, без оправданий. То, что выпало — на эту ночь.
      </p>

      <div className="relative mt-10 overflow-hidden rounded-xl bg-surface shadow-border">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-surface to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-16 bg-gradient-to-t from-surface to-transparent" />

        {spinning ? (
          <div className="relative h-72 overflow-hidden">
            <div className="fate-window" aria-hidden="true" />
            <ul className="spin-strip py-8">
              {strip.map((item, i) => (
                <li
                  key={`${item.id}-${i}`}
                  className="px-6 py-3 font-display text-2xl italic text-fg/80 sm:text-3xl"
                >
                  {item.title}
                </li>
              ))}
            </ul>
          </div>
        ) : mission ? (
          <div className="stagger-in border-l-2 border-accent px-6 py-10 sm:px-10">
            <p className="font-mono text-xs uppercase tracking-caps text-accent">
              {KIND_META[mission.kind].track}
            </p>
            <p className="mt-3 font-mono text-xs text-muted">
              {mission.owner}/{mission.repo}{" "}
              <span className="text-faint">
                {mission.isPr ? "PR" : "#"}
                {mission.number}
              </span>
            </p>
            <h2 className="mt-3 max-w-3xl font-display text-3xl italic leading-tight sm:text-4xl">
              {mission.title}
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">
              {mission.excerpt}
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Badge>{KIND_META[mission.kind].label}</Badge>
              {mission.labels.slice(0, 3).map((l) => (
                <Badge key={l}>{l}</Badge>
              ))}
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link
                  to="/m/$owner/$repo/$number"
                  params={{
                    owner: mission.owner,
                    repo: mission.repo,
                    number: String(mission.number),
                  }}
                >
                  Взять эту ночь
                </Link>
              </Button>
              <Button type="button" variant="ghost" size="lg" onClick={reroll}>
                Ещё раз
              </Button>
            </div>
          </div>
        ) : null}
      </div>
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

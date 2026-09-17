import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { NightShell } from "@/components/night-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { briefMission, getMission, type Brief } from "@/lib/api";
import { defaultAgentPrompt } from "@/lib/agent-prompt";
import { KIND_META, relativeTime } from "@/lib/kinds";
import { notifyTaken, useAccount } from "@/components/account-session";
import { ExternalLink } from "lucide-react";

export const Route = createFileRoute("/m/$owner/$repo/$number")({
  loader: ({ params }) => {
    const number = Number(params.number);
    if (!Number.isFinite(number) || number <= 0) {
      throw new Error("Нет такого ишью");
    }
    return getMission({
      data: {
        owner: params.owner,
        repo: params.repo,
        number,
      },
    });
  },
  pendingComponent: MissionPending,
  component: MissionPage,
});

function MissionPending() {
  return (
    <NightShell>
      <p className="font-mono text-xs uppercase tracking-caps text-muted">
        Загрузка эфира
      </p>
    </NightShell>
  );
}

function MissionPage() {
  const mission = Route.useLoaderData();
  const meta = KIND_META[mission.kind];
  const { take, entries } = useAccount();
  const taken = entries.some((e) => e.id === mission.id);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefing, setBriefing] = useState(false);
  const [briefError, setBriefError] = useState("");

  async function copyPrompt(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(label);
    } catch {
      toast("Не удалось скопировать");
    }
  }

  async function runBrief() {
    setBriefing(true);
    setBriefError("");
    const result = await briefMission({
      data: {
        owner: mission.owner,
        repo: mission.repo,
        number: mission.number,
        title: mission.title,
        body: mission.body.slice(0, 8000),
        url: mission.url,
        isPr: mission.isPr,
      },
    });
    setBriefing(false);
    if (!result.ok) {
      setBriefError(result.error);
      return;
    }
    setBrief(result.brief);
  }

  return (
    <NightShell>
      <Link to="/list" className="text-xs tracking-wide text-muted hover:text-fg">
        К списку
      </Link>

      <p className="mt-6 font-mono text-xs uppercase tracking-caps text-accent">
        {meta.track}
      </p>
      <p className="mt-3 font-mono text-xs text-muted">
        {mission.owner}/{mission.repo}{" "}
        <span className="text-faint">
          {mission.isPr ? "PR" : "#"}
          {mission.number}
        </span>
        {mission.author ? (
          <span className="text-faint"> · {mission.author}</span>
        ) : null}
        {mission.language ? (
          <span className="text-faint"> · {mission.language}</span>
        ) : null}
        <span className="text-faint"> · {relativeTime(mission.updatedAt)}</span>
        {mission.comments > 0 ? (
          <span className="text-faint"> · {mission.comments} комм.</span>
        ) : null}
      </p>
      <h1 className="mt-3 max-w-3xl font-display text-4xl italic leading-tight sm:text-5xl">
        {mission.title}
      </h1>
      <p className="mt-4 max-w-xl text-sm text-muted">{meta.duty}</p>

      <div className="mt-5 flex flex-wrap gap-1.5">
        <Badge>{meta.label}</Badge>
        {mission.labels.map((l) => (
          <Badge key={l}>{l}</Badge>
        ))}
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          size="lg"
          onClick={() => {
            void take(mission).then(() => notifyTaken());
          }}
          disabled={taken}
        >
          {taken ? "Уже в журнале" : "Взять эту ночь"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          onClick={() =>
            copyPrompt(defaultAgentPrompt(mission), "Протокол агента скопирован")
          }
        >
          Протокол агента
        </Button>
        <Button asChild variant="ghost" size="lg">
          <a href={mission.url} target="_blank" rel="noreferrer">
            GitHub
            <ExternalLink className="size-3.5" />
          </a>
        </Button>
      </div>

      {mission.body ? (
        <section className="mt-12">
          <h2 className="font-mono text-xs uppercase tracking-caps text-muted">
            Тело
          </h2>
          <pre className="body-scroll mt-4 overflow-auto whitespace-pre-wrap rounded-lg bg-surface p-5 font-sans text-sm leading-relaxed text-fg/90 shadow-border">
            {mission.body}
          </pre>
        </section>
      ) : (
        <p className="mt-10 text-sm text-muted">{mission.excerpt}</p>
      )}

      <section className="mt-12 rounded-xl bg-surface p-6 shadow-border sm:p-8">
        <h2 className="font-display text-3xl italic">Разбор ночи</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          Токены уходят сюда: модель читает ишью и возвращает план, риски и
          готовый промпт для агента. Один запрос — по кнопке, не сам.
        </p>
        <Button
          type="button"
          className="mt-6"
          variant="paper"
          size="lg"
          disabled={briefing}
          onClick={() => void runBrief()}
        >
          {briefing ? "Читает…" : brief ? "Перечитать" : "Разобрать"}
        </Button>
        {briefing ? (
          <p className="mt-4 font-mono text-xs uppercase tracking-caps text-muted">
            Читает тело. Это займёт несколько секунд.
          </p>
        ) : null}
        {briefError ? (
          <p className="mt-4 text-sm text-accent" role="alert">
            {briefError}
          </p>
        ) : null}

        {brief ? (
          <div className="mt-8 space-y-6">
            <BriefBlock title="Суть" body={brief.summary} />
            <BriefBlock title="Зачем" body={brief.whyItMatters} />
            <div>
              <h3 className="font-mono text-xs uppercase tracking-caps text-muted">
                Сложность
              </h3>
              <p className="mt-2 text-sm">
                {brief.difficulty === "solo"
                  ? "Одна ночь, одному"
                  : brief.difficulty === "bleed"
                    ? "Глубокий долг"
                    : "Нужна голова"}
              </p>
            </div>
            {brief.likelyFiles.length ? (
              <div>
                <h3 className="font-mono text-xs uppercase tracking-caps text-muted">
                  Где смотреть
                </h3>
                <ul className="mt-2 space-y-1 font-mono text-sm text-fg">
                  {brief.likelyFiles.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {brief.firstSteps.length ? (
              <div>
                <h3 className="font-mono text-xs uppercase tracking-caps text-muted">
                  Первые шаги
                </h3>
                <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
                  {brief.firstSteps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </div>
            ) : null}
            <BriefBlock title="Как проверить" body={brief.howToTest} />
            <BriefBlock title="Риски" body={brief.risks} />
            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-mono text-xs uppercase tracking-caps text-muted">
                  Промпт агента
                </h3>
                <Button
                  type="button"
                  variant="quiet"
                  size="sm"
                  onClick={() =>
                    copyPrompt(brief.agentPrompt, "Промпт скопирован")
                  }
                >
                  Копировать
                </Button>
              </div>
              <pre className="body-scroll mt-3 overflow-auto whitespace-pre-wrap rounded-md bg-bg p-4 font-mono text-xs leading-relaxed text-fg/90 shadow-border">
                {brief.agentPrompt}
              </pre>
            </div>
          </div>
        ) : null}
      </section>
    </NightShell>
  );
}

function BriefBlock({ title, body }: { title: string; body: string }) {
  if (!body) return null;
  return (
    <div>
      <h3 className="font-mono text-xs uppercase tracking-caps text-muted">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-fg/90">{body}</p>
    </div>
  );
}

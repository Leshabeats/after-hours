import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { NightShell } from "@/components/night-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getMission } from "@/lib/api";
import { defaultAgentPrompt } from "@/lib/agent-prompt";
import { briefPrompt } from "@/lib/brief-prompt";
import { openCodexApp } from "@/lib/codex-link";
import { KIND_META, relativeTime } from "@/lib/kinds";
import { useAccount } from "@/components/account-session";
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
  const router = useRouter();
  const meta = KIND_META[mission.kind];
  const { take, setStatus, entries } = useAccount();
  const taken = entries.some((e) => e.id === mission.id);

  async function copyPrompt(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(label);
    } catch {
      toast("Не удалось скопировать");
    }
  }

  return (
    <NightShell>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <Link to="/list" className="text-xs tracking-wide text-muted hover:text-fg">
          К списку
        </Link>
        <button
          type="button"
          className="text-xs tracking-wide text-muted hover:text-fg"
          onClick={() => {
            if (router.history.canGoBack()) {
              router.history.back();
              return;
            }
            void router.navigate({
              to: "/r/$owner/$repo",
              params: { owner: mission.owner, repo: mission.repo },
            });
          }}
        >
          К списку ишью
        </button>
      </div>

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
            void (async () => {
              if (!taken) await take(mission);
              await setStatus(mission.id, "shipping");
              openCodexApp(defaultAgentPrompt(mission));
              toast("Codex открыт. Промпт в новом чате, осталось нажать Enter.");
            })();
          }}
        >
          Взять эту ночь
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
          Открывает новый чат в Codex у тебя на компьютере. Промпт уже внутри:
          суть, шаги, риски. Ключ сайта не используется.
        </p>
        <Button
          type="button"
          className="mt-6"
          variant="paper"
          size="lg"
          onClick={() => {
            openCodexApp(briefPrompt(mission));
            toast("Codex открыт. Промпт разбора в новом чате, осталось нажать Enter.");
          }}
        >
          Разобрать
        </Button>
      </section>
    </NightShell>
  );
}

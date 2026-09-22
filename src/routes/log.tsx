import { createFileRoute, Link } from "@tanstack/react-router";
import { NightShell } from "@/components/night-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAccount } from "@/components/account-session";
import { KIND_META } from "@/lib/kinds";
import { summarizeJournal } from "@/lib/journal/stats";
import type { LogStatus } from "@/lib/journal/types";
import { getUsageSummary, type UsageLoad } from "@/lib/usage/api";

export const Route = createFileRoute("/log")({
  validateSearch: (search: Record<string, unknown>) => ({
    auth: search.auth === "error" ? ("error" as const) : undefined,
  }),
  loader: () => getUsageSummary(),
  component: LogPage,
});

const STATUSES: { id: LogStatus; label: string }[] = [
  { id: "taken", label: "Взято" },
  { id: "shipping", label: "В работе" },
  { id: "shipped", label: "Закрыто" },
];

function formatTokens(n: number) {
  return n.toLocaleString("ru-RU");
}

function UsagePanel({ user, load }: { user: boolean; load: UsageLoad }) {
  const usage = user && load.status === "ready" ? load.usage : null;
  return (
    <section className="mt-8 max-w-xl">
      <p className="font-mono text-xs uppercase tracking-caps text-accent">
        Токены
      </p>
      {usage ? (
        <dl className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-surface px-4 py-3 shadow-border">
            <dt className="font-mono text-xs uppercase tracking-caps text-muted">
              7 дней
            </dt>
            <dd className="mt-1 font-display text-3xl italic tabular-nums text-fg">
              {formatTokens(usage.weekTokens)}
            </dd>
          </div>
          <div className="rounded-lg bg-surface px-4 py-3 shadow-border">
            <dt className="font-mono text-xs uppercase tracking-caps text-muted">
              Всего
            </dt>
            <dd className="mt-1 font-display text-3xl italic tabular-nums text-fg">
              {formatTokens(usage.allTimeTokens)}
            </dd>
          </div>
          <div className="rounded-lg bg-surface px-4 py-3 shadow-border">
            <dt className="font-mono text-xs uppercase tracking-caps text-muted">
              Харнес
            </dt>
            <dd className="mt-1 truncate font-display text-2xl italic text-fg">
              {usage.lastHarness ?? "—"}
            </dd>
          </div>
        </dl>
      ) : user && load.status === "error" ? (
        <p className="mt-3 text-sm text-muted">Не удалось прочитать расход.</p>
      ) : (
        <p className="mt-3 text-sm text-muted">
          Войди через GitHub, чтобы локальный харнес писал расход токенов. After
          Hours агента не запускает.
        </p>
      )}
    </section>
  );
}

function LogPage() {
  const { entries, setStatus, drop, user } = useAccount();
  const usage = Route.useLoaderData();
  const authError = Route.useSearch().auth === "error";
  const shown = entries;
  const stats = summarizeJournal(shown);

  return (
    <NightShell>
      <p className="font-mono text-xs uppercase tracking-caps text-accent">
        Night log
      </p>
      <h1 className="mt-2 font-display text-5xl italic leading-none sm:text-6xl">
        Журнал
      </h1>
      <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted">
        {user
          ? `Ночи аккаунта ${user.login}: взято, в работе, закрыто.`
          : "То, что ты взял этой и прошлыми ночами. Без входа — только на этом устройстве."}
      </p>
      {authError ? (
        <p className="mt-3 text-sm text-accent" role="alert">
          GitHub не пустил. Проверь OAuth-приложение и попробуй ещё раз.
        </p>
      ) : null}

      <UsagePanel user={Boolean(user)} load={usage} />

      {shown.length > 0 ? (
        <dl className="mt-8 grid max-w-xl grid-cols-3 gap-3">
          {(
            [
              ["taken", "Взято", stats.taken],
              ["shipping", "В работе", stats.shipping],
              ["shipped", "Закрыто", stats.shipped],
            ] as const
          ).map(([id, label, value]) => (
            <div key={id} className="rounded-lg bg-surface px-4 py-3 shadow-border">
              <dt className="font-mono text-xs uppercase tracking-caps text-muted">
                {label}
              </dt>
              <dd className="mt-1 font-display text-3xl italic tabular-nums text-fg">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {shown.length > 0 && stats.topKind ? (
        <p className="mt-3 max-w-xl text-sm text-muted">
          Всего {stats.total}. Чаще — {KIND_META[stats.topKind].track}.
        </p>
      ) : null}

      {shown.length === 0 ? (
        <div className="mt-16 max-w-md">
          <p className="font-display text-3xl italic">Пока тихо.</p>
          <p className="mt-3 text-sm text-muted">
            Возьми ночь из списка или позволь ей выбрать самой.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button asChild>
              <Link to="/fate">Как повезёт</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/list">Список</Link>
            </Button>
          </div>
        </div>
      ) : (
        <ul className="mt-10 space-y-4">
          {shown.map((entry) => (
            <li
              key={entry.id}
              className="rounded-lg bg-surface p-5 shadow-border"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs uppercase tracking-caps text-accent">
                    {KIND_META[entry.kind].track}
                  </p>
                  <Link
                    to="/m/$owner/$repo/$number"
                    params={{
                      owner: entry.owner,
                      repo: entry.repo,
                      number: String(entry.number),
                    }}
                    className="mt-2 block font-display text-2xl italic leading-snug hover:text-paper"
                  >
                    {entry.title}
                  </Link>
                  <p className="mt-2 font-mono text-xs text-muted">
                    {entry.owner}/{entry.repo} #{entry.number}
                  </p>
                </div>
                <Badge>
                  {STATUSES.find((s) => s.id === entry.status)?.label}
                </Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {STATUSES.map((s) => (
                  <Button
                    key={s.id}
                    type="button"
                    size="sm"
                    variant={entry.status === s.id ? "paper" : "ghost"}
                    onClick={() => void setStatus(entry.id, s.id)}
                  >
                    {s.label}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="quiet"
                  onClick={() => void drop(entry.id)}
                >
                  Убрать
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </NightShell>
  );
}

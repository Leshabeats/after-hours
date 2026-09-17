import { createFileRoute, Link } from "@tanstack/react-router";
import { NightShell } from "@/components/night-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAccount } from "@/components/account-session";
import { KIND_META } from "@/lib/kinds";
import type { LogStatus } from "@/lib/journal/types";

export const Route = createFileRoute("/log")({
  validateSearch: (search: Record<string, unknown>) => ({
    auth: search.auth === "error" ? ("error" as const) : undefined,
  }),
  component: LogPage,
});

const STATUSES: { id: LogStatus; label: string }[] = [
  { id: "taken", label: "Взято" },
  { id: "shipping", label: "В работе" },
  { id: "shipped", label: "Закрыто" },
];

function LogPage() {
  const { entries, setStatus, drop, user } = useAccount();
  const authError = Route.useSearch().auth === "error";
  const shown = entries;

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

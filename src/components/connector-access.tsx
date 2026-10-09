import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  createConnectorGrant,
  listConnectorGrants,
  revokeConnectorGrant,
  type GrantLoad,
} from "@/lib/research/api";
import type { ConnectorGrant } from "@/lib/research/types";

function formatWhen(at: number) {
  return new Date(at).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ConnectorAccess({
  signedIn,
  initial,
}: {
  signedIn: boolean;
  initial: GrantLoad;
}) {
  const [grants, setGrants] = useState<ConnectorGrant[]>(
    initial.ok === "account" ? initial.grants : [],
  );
  const [loadError, setLoadError] = useState(initial.ok === "error");
  const [token, setToken] = useState<{ value: string; grantId: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!signedIn || initial.ok === "anonymous") return null;

  async function issue() {
    setPending(true);
    setActionError(null);
    setCopied(false);
    try {
      const result = await createConnectorGrant();
      if (result.ok === "account") {
        setToken({ value: result.token, grantId: result.grant.id });
        setGrants((current) => [result.grant, ...current.filter((item) => item.id !== result.grant.id)]);
        setLoadError(false);
        return;
      }
      setActionError(
        result.ok === "anonymous"
          ? "Сессия кончилась. Войди ещё раз."
          : "Не удалось выдать доступ.",
      );
    } finally {
      setPending(false);
    }
  }

  async function revoke(id: string) {
    setPending(true);
    setActionError(null);
    try {
      const result = await revokeConnectorGrant({ data: { id } });
      if (result.ok === "account") {
        setGrants(result.grants);
        setToken((current) => (current?.grantId === id ? null : current));
        return;
      }
      if (result.ok === false) {
        const fresh = await listConnectorGrants();
        if (fresh.ok === "account") setGrants(fresh.grants);
        setActionError("Этот доступ уже не твой.");
        return;
      }
      setActionError(result.ok === "anonymous" ? "Сессия кончилась. Войди ещё раз." : "Не удалось отозвать доступ.");
    } finally {
      setPending(false);
    }
  }

  async function copyToken() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token.value);
      setCopied(true);
    } catch {
      setCopied(false);
      setActionError("Скопируй токен вручную. Браузер не дал записать его в буфер.");
    }
  }

  return (
    <section className="mt-8 max-w-xl">
      <p className="font-mono text-xs uppercase tracking-caps text-accent">Коннектор</p>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Локальный Codex сам открывает исследование и присылает отчёт. Сайт агента не
        запускает. Токен показывается один раз.
      </p>
      {loadError ? (
        <p className="mt-3 text-sm text-muted">Не удалось прочитать доступы коннектора.</p>
      ) : null}
      <div className="mt-4">
        <Button type="button" size="sm" onClick={() => void issue()} disabled={pending}>
          Выдать доступ
        </Button>
      </div>
      {token ? (
        <div className="mt-4 rounded-lg bg-surface px-4 py-3 shadow-border">
          <p className="font-mono text-xs uppercase tracking-caps text-muted">Токен</p>
          <p className="mt-2 break-all font-mono text-sm text-fg">{token.value}</p>
          <p className="mt-2 text-sm text-muted">
            Сохрани его сейчас. После обновления страницы он больше не покажется.
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-3"
            onClick={() => void copyToken()}
          >
            {copied ? "Скопирован" : "Скопировать"}
          </Button>
        </div>
      ) : null}
      {actionError ? (
        <p className="mt-3 text-sm text-accent" role="alert">
          {actionError}
        </p>
      ) : null}
      {grants.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Доступов пока нет.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {grants.map((grant) => (
            <li
              key={grant.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface px-4 py-3 shadow-border"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-fg">{grant.id}</p>
                <p className="mt-1 text-sm text-muted">
                  {grant.revokedAt ? "Отозван" : "Действует"} · {formatWhen(grant.createdAt)}
                </p>
              </div>
              {grant.revokedAt ? null : (
                <Button
                  type="button"
                  size="sm"
                  variant="quiet"
                  disabled={pending}
                  onClick={() => void revoke(grant.id)}
                >
                  Отозвать
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

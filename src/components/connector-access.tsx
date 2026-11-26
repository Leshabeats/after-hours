import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/local-time";
import {
  createConnectorGrant,
  listConnectorGrants,
  revokeConnectorGrant,
  type GrantLoad,
} from "@/lib/research/api";
import type { ConnectorGrant } from "@/lib/research/types";

export function ConnectorAccess({ signedIn, initial }: { signedIn: boolean; initial: GrantLoad }) {
  const [grants, setGrants] = useState<ConnectorGrant[]>(
    initial.ok === "account" ? initial.grants : [],
  );
  const [loadError, setLoadError] = useState(initial.ok === "error");
  const [token, setToken] = useState<{
    value: string;
    grantIds: string[];
    kind: "connector" | "claude";
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!signedIn || initial.ok === "anonymous") return null;

  async function issue(kind: "connector" | "claude") {
    setPending(true);
    setActionError(null);
    setCopied(false);
    try {
      if (kind === "claude") {
        const response = await fetch("/api/claude-access", { method: "POST" });
        if (response.ok) {
          const result: { config: object; grants: ConnectorGrant[] } = await response.json();
          setToken({
            value: JSON.stringify(result.config, null, 2),
            grantIds: result.grants.map((grant) => grant.id),
            kind,
          });
          setGrants((current) => [...result.grants, ...current]);
          setLoadError(false);
        } else {
          setActionError(
            response.status === 401
              ? "Сессия кончилась. Войди ещё раз."
              : "Не удалось выдать доступ для Claude Code.",
          );
        }
        return;
      }
      const result = await createConnectorGrant();
      if (result.ok === "account") {
        setToken({ value: result.token, grantIds: [result.grant.id], kind });
        setGrants((current) => [
          result.grant,
          ...current.filter((item) => item.id !== result.grant.id),
        ]);
        setLoadError(false);
        return;
      }
      setActionError(
        result.ok === "anonymous"
          ? "Сессия кончилась. Войди ещё раз."
          : "Не удалось выдать доступ.",
      );
    } catch {
      setActionError("Не удалось выдать доступ.");
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
        setToken((current) => (current?.grantIds.includes(id) ? null : current));
        return;
      }
      if (result.ok === false) {
        const fresh = await listConnectorGrants();
        if (fresh.ok === "account") setGrants(fresh.grants);
        setActionError("Этот доступ уже не твой.");
        return;
      }
      setActionError(
        result.ok === "anonymous"
          ? "Сессия кончилась. Войди ещё раз."
          : "Не удалось отозвать доступ.",
      );
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
      setActionError("Скопируй текст вручную. Браузер не дал записать его в буфер.");
    }
  }

  return (
    <section className="mt-8 max-w-xl">
      <p className="font-mono text-xs uppercase tracking-caps text-accent">Коннектор</p>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Подключи свой харнесс через MCP на странице «Подключить агента». Здесь можно выдать
        Bearer-токен или отозвать доступ. Токен показывается один раз.
      </p>
      {loadError ? (
        <p className="mt-3 text-sm text-muted">Не удалось прочитать доступы коннектора.</p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => void issue("connector")} disabled={pending}>
          Выдать доступ
        </Button>
        <Button
          type="button"
          size="sm"
          variant="quiet"
          onClick={() => void issue("claude")}
          disabled={pending}
        >
          Выдать доступ для Claude Code
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted">
        При запуске через адаптер Claude Code общий расход токенов виден в опубликованном отчёте.
      </p>
      {token ? (
        <div className="mt-4 rounded-lg bg-surface px-4 py-3 shadow-border">
          <p className="font-mono text-xs uppercase tracking-caps text-muted">
            {token.kind === "claude" ? "Конфигурация Claude Code" : "Токен"}
          </p>
          <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-sm text-fg">
            {token.value}
          </pre>
          <p className="mt-2 text-sm text-muted">
            {token.kind === "claude"
              ? "Сохрани конфигурацию в приватный файл вне проекта. После обновления страницы она больше не покажется."
              : "Сохрани его сейчас. После обновления страницы он больше не покажется."}
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
                <p className="truncate font-mono text-xs text-fg">
                  {grant.purpose === "telemetry"
                    ? "Расход Claude Code · "
                    : grant.purpose === "mcp"
                      ? "MCP · "
                      : ""}
                  {grant.id}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {grant.revokedAt
                    ? "Отозван"
                    : grant.expiresAt && grant.expiresAt <= Date.now()
                      ? "Истёк"
                      : "Действует"}{" "}
                  · <LocalTime at={grant.createdAt} />
                  {grant.expiresAt ? (
                    <>
                      {" "}
                      · До <LocalTime at={grant.expiresAt} />
                    </>
                  ) : null}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {grant.lastUsedAt ? (
                    <>
                      Последнее обращение <LocalTime at={grant.lastUsedAt} />
                    </>
                  ) : (
                    "Ещё не обращался"
                  )}
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

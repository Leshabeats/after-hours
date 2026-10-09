import type { LimitLoad } from "@/lib/research/api";
import type { LimitWindow } from "@/lib/research/types";

function formatWhen(at: number) {
  return new Date(at).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function percent(value: number | null) {
  return value == null ? "нет данных" : `${value.toLocaleString("ru-RU")}%`;
}

function WindowLine({ title, window }: { title: string; window: LimitWindow | null }) {
  if (!window) {
    return (
      <p className="mt-3 text-sm text-muted">
        {title}: нет данных
      </p>
    );
  }
  return (
    <p className="mt-3 text-sm text-muted">
      {title}: {percent(window.usedPercent)}
      {window.resetsAt == null ? "" : `, сброс ${formatWhen(window.resetsAt * 1000)}`}
    </p>
  );
}

export function LimitSnapshotPanel({
  signedIn,
  load,
}: {
  signedIn: boolean;
  load: LimitLoad;
}) {
  if (!signedIn || load.ok === "anonymous") return null;
  return (
    <section className="mt-8 max-w-xl">
      <p className="font-mono text-xs uppercase tracking-caps text-accent">Лимит</p>
      {load.ok === "error" ? (
        <p className="mt-3 text-sm text-muted">Не удалось прочитать лимит.</p>
      ) : load.limit == null ? (
        <p className="mt-3 text-sm text-muted">Снимка лимита ещё нет.</p>
      ) : (
        <div>
          <p className="mt-3 text-sm text-muted">Снимок от {formatWhen(load.limit.readAt)}</p>
          <WindowLine title="Основное окно" window={load.limit.primary} />
          <WindowLine title="Второе окно" window={load.limit.secondary} />
          <p className="mt-3 text-sm text-muted">
            Остаток личного лимита: {percent(load.limit.individualRemainingPercent)}
          </p>
          <p className="mt-1 text-sm text-muted">
            Потолок расхода:{" "}
            {load.limit.spendControlReached == null
              ? "нет данных"
              : load.limit.spendControlReached
                ? "достигнут"
                : "не достигнут"}
          </p>
        </div>
      )}
    </section>
  );
}

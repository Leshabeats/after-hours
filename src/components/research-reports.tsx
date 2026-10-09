import { useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { reportLinkHref, spendLabel, type PublicReport } from "@/lib/research/catalog";
import { setReportPublished } from "@/lib/research/api";
import type { TurnSpend } from "@/lib/research/accounting";

function formatWhen(at: number) {
  return new Date(at).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function SpendFigure({ label, spend }: { label: string; spend: TurnSpend }) {
  const text = spendLabel(spend);
  return (
    <p className="text-sm text-muted">
      <span className="text-fg">{label}: </span>
      <span className="tabular-nums">{text.total}</span>
      {text.note ? <span> {text.note}</span> : null}
    </p>
  );
}

function ReportCard({
  report,
  showMission,
  action,
}: {
  report: PublicReport;
  showMission: boolean;
  action: "hide" | "show" | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const author = report.author.login || "Автор не указан";

  async function change(published: boolean) {
    setPending(true);
    try {
      const result = await setReportPublished({ data: { id: report.id, published } });
      if (result.ok === "account") {
        await router.invalidate();
        return;
      }
      toast(
        result.ok === "anonymous"
          ? "Сессия кончилась. Войди ещё раз."
          : result.ok === "blocked"
            ? "Этот запуск нельзя опубликовать."
            : result.ok === "missing"
              ? "Этот отчёт уже не твой."
              : "Не удалось обновить публикацию.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="rounded-lg bg-surface px-4 py-4 shadow-border sm:px-5">
      <div className="flex flex-wrap items-center gap-3">
        {report.author.avatarUrl ? (
          <img
            src={report.author.avatarUrl}
            alt=""
            className="size-8 rounded-full object-cover"
          />
        ) : null}
        <div className="min-w-0">
          {report.author.login ? (
            <Link
              to="/u/$login"
              params={{ login: report.author.login }}
              className="font-mono text-xs text-fg hover:text-paper"
            >
              {author}
            </Link>
          ) : (
            <p className="font-mono text-xs text-muted">{author}</p>
          )}
          <p className="mt-1 text-sm text-muted">
            {report.publishedAt ? formatWhen(report.publishedAt) : "Снято с публикации"}
            {" · "}
            {report.model ?? "модель не указана"}
          </p>
        </div>
      </div>
      {showMission ? (
        <Link
          to="/m/$owner/$repo/$number"
          params={{
            owner: report.owner,
            repo: report.repo,
            number: String(report.number),
          }}
          className="mt-3 block font-mono text-xs text-accent hover:text-fg"
        >
          {report.owner}/{report.repo}
          {report.isPr ? " PR " : " #"}
          {report.number}
        </Link>
      ) : null}
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-fg">
        {report.report.findings}
      </p>
      <SpendFigure label="Расход" spend={report.spend} />
      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-muted">Подробности</summary>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-fg/90">
          <p className="whitespace-pre-wrap">{report.report.work}</p>
          <ReportList title="Доказательства" items={report.report.evidence} />
          <ReportList title="Неизвестно" items={report.report.unknowns} />
          <ReportList title="Дальше" items={report.report.nextSteps} />
          {report.report.links.length > 0 ? (
            <div>
              <p className="font-mono text-xs uppercase tracking-caps text-muted">Ссылки</p>
              <ul className="mt-1 space-y-1">
                {report.report.links.map((link) => {
                  const href = reportLinkHref(link.url);
                  return (
                    <li key={`${link.kind}-${link.url}`} className="break-all">
                      <span className="text-muted">{link.kind}: </span>
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer" className="hover:text-paper">
                          {link.url}
                        </a>
                      ) : (
                        link.url
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </details>
      {action ? (
        <Button
          type="button"
          size="sm"
          variant="quiet"
          className="mt-3"
          disabled={pending}
          onClick={() => void change(action === "show")}
        >
          {action === "hide" ? "Снять с публикации" : "Опубликовать снова"}
        </Button>
      ) : null}
    </article>
  );
}

function ReportList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-caps text-muted">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="whitespace-pre-wrap">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ResearchReportSection({
  title,
  empty,
  reports,
  publicSpend,
  viewerSpend = null,
  hidden,
  showMission,
}: {
  title: string;
  empty: string;
  reports: PublicReport[];
  publicSpend: TurnSpend;
  viewerSpend?: TurnSpend | null;
  hidden: PublicReport[];
  showMission: boolean;
}) {
  return (
    <section className="mt-12">
      <h2 className="font-display text-3xl italic">{title}</h2>
      {reports.length > 0 ? (
        <div className="mt-3 max-w-xl space-y-1">
          <SpendFigure label="Опубликованные" spend={publicSpend} />
          {viewerSpend ? <SpendFigure label="Ваш расход" spend={viewerSpend} /> : null}
        </div>
      ) : viewerSpend ? (
        <div className="mt-3 max-w-xl">
          <SpendFigure label="Ваш расход" spend={viewerSpend} />
        </div>
      ) : null}
      {reports.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{empty}</p>
      ) : (
        <div className="mt-4 max-w-xl space-y-3">
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              showMission={showMission}
              action={report.owned ? "hide" : null}
            />
          ))}
        </div>
      )}
      {hidden.length > 0 ? (
        <div className="mt-6 max-w-xl">
          <p className="font-mono text-xs uppercase tracking-caps text-muted">
            Снято с публикации
          </p>
          <div className="mt-3 space-y-3">
            {hidden.map((report) => (
              <ReportCard key={report.id} report={report} showMission={showMission} action="show" />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

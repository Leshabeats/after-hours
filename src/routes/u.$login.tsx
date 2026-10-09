import { createFileRoute } from "@tanstack/react-router";
import { NightShell } from "@/components/night-shell";
import { ResearchReportSection } from "@/components/research-reports";
import { listAuthorReports, type AuthorReportLoad } from "@/lib/research/api";

const LOGIN = /^[A-Za-z0-9-]{1,39}$/;

export const Route = createFileRoute("/u/$login")({
  loader: async ({ params }): Promise<AuthorReportLoad> => {
    if (!LOGIN.test(params.login)) {
      return {
        ok: "ready",
        board: {
          login: params.login,
          name: "",
          avatarUrl: "",
          reports: [],
          publicSpend: {
            inputTokens: null,
            cachedInputTokens: null,
            outputTokens: null,
            reasoningOutputTokens: null,
            totalTokens: null,
            unknownTurns: 0,
          },
          hidden: [],
        },
      };
    }
    return listAuthorReports({ data: { login: params.login } });
  },
  component: AuthorPage,
});

function AuthorPage() {
  const load = Route.useLoaderData();
  const login = Route.useParams().login;
  const board = load.ok === "ready" ? load.board : null;
  const title = board?.name || board?.login || login;

  return (
    <NightShell>
      <p className="font-mono text-xs uppercase tracking-caps text-accent">Профиль</p>
      <div className="mt-3 flex items-center gap-3">
        {board?.avatarUrl ? (
          <img src={board.avatarUrl} alt="" className="size-12 rounded-full object-cover" />
        ) : null}
        <h1 className="font-display text-5xl italic leading-none">{title}</h1>
      </div>
      {load.ok === "error" ? (
        <p className="mt-6 text-sm text-muted">Не удалось прочитать отчёты.</p>
      ) : board ? (
        <ResearchReportSection
          title="Исследования"
          empty="Отчётов пока нет."
          reports={board.reports}
          publicSpend={board.publicSpend}
          hidden={board.hidden}
          showMission
        />
      ) : null}
    </NightShell>
  );
}

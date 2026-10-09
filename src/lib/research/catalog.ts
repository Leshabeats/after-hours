import { sumTurnSnapshots, type TurnSpend } from "./accounting.ts";
import type { ResearchReport, ResearchRun } from "./types.ts";

export type ReportAuthor = {
  login: string;
  name: string;
  avatarUrl: string;
};

/** One published or owner-hidden report. No account id, thread id, or limit. */
export type PublicReport = {
  id: string;
  missionId: string;
  owner: string;
  repo: string;
  number: number;
  isPr: boolean;
  author: ReportAuthor;
  owned: boolean;
  model: string | null;
  publishedAt: number | null;
  report: ResearchReport;
  spend: TurnSpend;
};

export type MissionBoard = {
  reports: PublicReport[];
  publicSpend: TurnSpend;
  hidden: PublicReport[];
  viewerSpend: TurnSpend | null;
};

export type AuthorBoard = {
  login: string;
  name: string;
  avatarUrl: string;
  reports: PublicReport[];
  publicSpend: TurnSpend;
  hidden: PublicReport[];
};

const EMPTY_AUTHOR: ReportAuthor = { login: "", name: "", avatarUrl: "" };

export function reportLinkHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
  } catch {
    return null;
  }
  return null;
}

export function spendLabel(spend: TurnSpend): { total: string; note: string | null } {
  if (spend.totalTokens == null) return { total: "нет данных", note: null };
  const note =
    spend.unknownTurns === 0
      ? null
      : spend.unknownTurns === 1
        ? "По одному ходу нет данных."
        : `По ${spend.unknownTurns} ходам нет данных.`;
  return { total: spend.totalTokens.toLocaleString("ru-RU"), note };
}

function authorOf(
  authors: ReadonlyMap<string, ReportAuthor>,
  userId: string,
): ReportAuthor {
  return authors.get(userId) ?? EMPTY_AUTHOR;
}

function toCard(
  run: ResearchRun,
  author: ReportAuthor,
  viewerId: string | null,
): PublicReport | null {
  if (run.status !== "completed" || run.report == null) return null;
  return {
    id: run.id,
    missionId: run.missionId,
    owner: run.owner,
    repo: run.repo,
    number: run.number,
    isPr: run.isPr,
    author: { login: author.login, name: author.name, avatarUrl: author.avatarUrl },
    owned: viewerId != null && run.userId === viewerId,
    model: run.model,
    publishedAt: run.publishedAt,
    report: run.report,
    spend: sumTurnSnapshots(run.turns),
  };
}

function byNewest(a: PublicReport, b: PublicReport) {
  const at = (b.publishedAt ?? 0) - (a.publishedAt ?? 0);
  if (at !== 0) return at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function sameMission(
  run: ResearchRun,
  mission: { owner: string; repo: string; number: number },
) {
  return (
    run.owner.toLowerCase() === mission.owner.trim().toLowerCase() &&
    run.repo.toLowerCase() === mission.repo.trim().toLowerCase() &&
    run.number === mission.number
  );
}

export function buildMissionBoard(
  runs: readonly ResearchRun[],
  authors: ReadonlyMap<string, ReportAuthor>,
  mission: { owner: string; repo: string; number: number },
  viewerId: string | null,
): MissionBoard {
  const matching = runs.filter((run) => sameMission(run, mission));
  const published = matching.filter(
    (run) => run.publishedAt != null && run.status === "completed" && run.report != null,
  );
  const reports = published
    .flatMap((run) => {
      const card = toCard(run, authorOf(authors, run.userId), viewerId);
      return card ? [card] : [];
    })
    .sort(byNewest);
  const hidden =
    viewerId == null
      ? []
      : matching
          .filter((run) => run.userId === viewerId && run.publishedAt == null)
          .flatMap((run) => {
            const card = toCard(run, authorOf(authors, run.userId), viewerId);
            return card ? [card] : [];
          })
          .sort(byNewest);
  const own = viewerId == null ? [] : matching.filter((run) => run.userId === viewerId);
  return {
    reports,
    publicSpend: sumTurnSnapshots(published.flatMap((run) => run.turns)),
    hidden,
    viewerSpend: own.length === 0 ? null : sumTurnSnapshots(own.flatMap((run) => run.turns)),
  };
}

export function buildAuthorBoard(
  runs: readonly ResearchRun[],
  matched: readonly (ReportAuthor & { id: string })[],
  requestedLogin: string,
  viewerId: string | null,
): AuthorBoard {
  const header = matched[0] ?? {
    login: requestedLogin.trim(),
    name: "",
    avatarUrl: "",
  };
  const ids = new Set(matched.map((author) => author.id));
  const authors = new Map(matched.map((author) => [author.id, author]));
  const matching = runs.filter((run) => ids.has(run.userId));
  const published = matching.filter(
    (run) => run.publishedAt != null && run.status === "completed" && run.report != null,
  );
  const reports = published
    .flatMap((run) => {
      const card = toCard(run, authorOf(authors, run.userId), viewerId);
      return card ? [card] : [];
    })
    .sort(byNewest);
  const hidden =
    viewerId == null || !ids.has(viewerId)
      ? []
      : matching
          .filter((run) => run.userId === viewerId && run.publishedAt == null)
          .flatMap((run) => {
            const card = toCard(run, authorOf(authors, run.userId), viewerId);
            return card ? [card] : [];
          })
          .sort(byNewest);
  return {
    login: header.login,
    name: header.name,
    avatarUrl: header.avatarUrl,
    reports,
    publicSpend: sumTurnSnapshots(published.flatMap((run) => run.turns)),
    hidden,
  };
}

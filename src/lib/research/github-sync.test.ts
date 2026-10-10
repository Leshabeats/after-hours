import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  FRESH_OPEN_MS,
  FRESH_TERMINAL_MS,
  WATCH_CALL_BUDGET,
  type WatchRun,
} from "./github-watch.ts";
import { githubPausedUntil, refreshWatch, resetGithubPause } from "./github-sync.ts";
import { createMemoryWatch } from "./watch-book.ts";
import type { ResearchReport } from "./types.ts";

const savedToken = process.env.GITHUB_TOKEN;

afterEach(() => {
  resetGithubPause();
  if (savedToken == null) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = savedToken;
});

function report(links: ResearchReport["links"], work = "Смотрел"): ResearchReport {
  return {
    schemaVersion: 1,
    findings: "Итог",
    work,
    evidence: [],
    unknowns: [],
    nextSteps: [],
    links,
  };
}

function watchRun(links: ResearchReport["links"], work?: string): WatchRun {
  return {
    id: "run_1",
    owner: "vitejs",
    repo: "vite",
    number: 1,
    isPr: false,
    publishedAt: 10,
    status: "completed",
    report: report(links, work),
  };
}

type Sent = { url: string; authorization: string; hasCookie: boolean };

function stage(run: WatchRun, login = "Lesha") {
  let n = 0;
  const book = createMemoryWatch(() => `gh_${String(++n).padStart(2, "0")}`);
  const reader = {
    book,
    runs: () => [{ run, researcherLogin: login }],
  };
  const history = () => book.history([{ id: run.id, researcherLogin: login }]).get(run.id);
  return { book, reader, run, history };
}

function response(
  status: number,
  body: unknown,
  url: string,
  headers: Record<string, string> = {},
) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    url,
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    text: async () => text,
    json: async () => body,
  } as unknown as Response;
}

function issue(number: number, title: string, html = `https://github.com/vitejs/vite/issues/${number}`) {
  return {
    node_id: `I${number}`,
    number,
    title,
    html_url: html,
    state: "open",
    comments: 1,
    user: { login: "octocat" },
  };
}

function pull(
  number: number,
  title: string,
  login: string,
  flags: { merged?: boolean; closed?: boolean; draft?: boolean; comments?: number } = {},
) {
  return {
    node_id: `P${number}`,
    number,
    title,
    html_url: `https://github.com/vitejs/vite/pull/${number}`,
    state: flags.merged || flags.closed ? "closed" : "open",
    merged: Boolean(flags.merged),
    draft: Boolean(flags.draft),
    comments: flags.comments ?? 1,
    user: { login },
  };
}

function github(sent: Sent[], handler: (url: string) => Response): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    sent.push({
      url,
      authorization: headers.get("authorization") ?? "",
      hasCookie: headers.has("cookie"),
    });
    return handler(url);
  }) as typeof fetch;
}

describe("github sync", () => {
  it("records review, close, reopen, and merge once, then skips a fresh poll", async () => {
    resetGithubPause();
    const sent: Sent[] = [];
    const { reader, run, history } = stage(
      watchRun([{ url: "https://github.com/vitejs/vite/pull/9", kind: "pull" }]),
    );
    let reviewState = "CHANGES_REQUESTED";
    let comments = 1;
    let merged = false;
    let closed = false;
    const fetchImpl = github(sent, (url) => {
      if (url.endsWith("/issues/1")) return response(200, issue(1, "Задача"), url);
      if (url.includes("/reviews")) {
        return response(
          200,
          [{ user: { login: "Ann" }, state: reviewState, submitted_at: "2" }],
          url,
        );
      }
      return response(200, pull(9, "Правка", "Lesha", { merged, closed, comments }), url);
    });

    await refreshWatch(reader, [run.id], 1_000_000, fetchImpl);
    assert.equal(history()?.links[0]?.review, "changes_requested");
    assert.deepEqual(history()?.links[0]?.facts.map((fact) => fact.kind), ["changes_requested"]);
    const firstCalls = sent.length;
    await refreshWatch(reader, [run.id], 1_000_000 + 1_000, fetchImpl);
    assert.equal(sent.length, firstCalls);

    reviewState = "APPROVED";
    comments = 4;
    await refreshWatch(reader, [run.id], 1_000_000 + FRESH_OPEN_MS, fetchImpl);
    assert.deepEqual(history()?.links[0]?.facts.map((fact) => fact.kind), [
      "approved",
      "comments",
      "changes_requested",
    ]);

    closed = true;
    await refreshWatch(reader, [run.id], 1_000_000 + FRESH_OPEN_MS * 2, fetchImpl);
    assert.equal(history()?.links[0]?.state, "closed");
    assert.equal(history()?.links[0]?.facts.some((fact) => fact.kind === "closed"), true);

    closed = false;
    await refreshWatch(reader, [run.id], 1_000_000 + FRESH_OPEN_MS * 2 + FRESH_TERMINAL_MS, fetchImpl);
    assert.equal(history()?.links[0]?.state, "open");
    assert.equal(history()?.links[0]?.facts.some((fact) => fact.kind === "reopened"), true);
    assert.equal(history()?.links[0]?.facts.some((fact) => fact.kind === "closed"), true);

    merged = true;
    const beforeMerge = history()?.links[0]?.facts.length ?? 0;
    await refreshWatch(
      reader,
      [run.id],
      1_000_000 + FRESH_OPEN_MS * 3 + FRESH_TERMINAL_MS,
      fetchImpl,
    );
    assert.equal(history()?.links[0]?.state, "merged");
    const mergedFacts = history()?.links[0]?.facts.filter((fact) => fact.kind === "merged") ?? [];
    assert.equal(mergedFacts.length, 1);
    await refreshWatch(
      reader,
      [run.id],
      1_000_000 + FRESH_OPEN_MS * 3 + FRESH_TERMINAL_MS * 2,
      fetchImpl,
    );
    assert.equal(
      history()?.links[0]?.facts.filter((fact) => fact.kind === "merged").length,
      1,
    );
    assert.ok((history()?.links[0]?.facts.length ?? 0) >= beforeMerge);
  });

  it("leaves review unknown when the review page is truncated", async () => {
    resetGithubPause();
    const sent: Sent[] = [];
    const { reader, run, history } = stage(
      watchRun([{ url: "https://github.com/vitejs/vite/pull/9", kind: "pull" }]),
    );
    await refreshWatch(
      reader,
      [run.id],
      2_000_000,
      github(sent, (url) => {
        if (url.endsWith("/issues/1")) return response(200, issue(1, "Задача"), url);
        if (url.includes("/reviews")) {
          return response(200, [{ user: { login: "Ann" }, state: "APPROVED", submitted_at: "1" }], url, {
            link: '<https://api.github.com/repos/vitejs/vite/pulls/9/reviews?page=2>; rel="next"',
          });
        }
        return response(200, pull(9, "Правка", "Lesha"), url);
      }),
    );
    assert.equal(history()?.links[0]?.review, "unknown");
  });

  it("keeps the last public snapshot when GitHub rate-limits the next poll", async () => {
    resetGithubPause();
    const sent: Sent[] = [];
    const { reader, run, history } = stage(
      watchRun([{ url: "https://github.com/vitejs/vite/pull/9", kind: "pull" }]),
    );
    let limited = false;
    const fetchImpl = github(sent, (url) => {
      if (limited) {
        return response(403, "API rate limit exceeded", url, {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "9999999999",
        });
      }
      if (url.endsWith("/issues/1")) return response(200, issue(1, "Живой"), url);
      if (url.includes("/reviews")) return response(200, [], url);
      return response(200, pull(9, "Правка", "Lesha"), url);
    });
    await refreshWatch(reader, [run.id], 3_000_000, fetchImpl);
    limited = true;
    const before = sent.length;
    await refreshWatch(reader, [run.id], 3_000_000 + FRESH_OPEN_MS, fetchImpl);
    assert.equal(sent.length, before + 1);
    assert.equal(history()?.source?.title, "Живой");
    assert.equal(history()?.source?.stale, true);
    assert.equal(history()?.links[0]?.title, "Правка");
    assert.equal(history()?.links[0]?.stale, false);
    assert.ok(githubPausedUntil() > 3_000_000 + FRESH_OPEN_MS);
    const paused = sent.length;
    await refreshWatch(reader, [run.id], 3_000_000 + FRESH_OPEN_MS + 1_000, fetchImpl);
    assert.equal(sent.length, paused);
  });

  it("hides a title after the object stops being public", async () => {
    resetGithubPause();
    const sent: Sent[] = [];
    const { reader, run, history } = stage(
      watchRun([{ url: "https://github.com/vitejs/vite/pull/9", kind: "pull" }]),
    );
    let missing = false;
    await refreshWatch(
      reader,
      [run.id],
      4_000_000,
      github(sent, (url) => {
        if (missing && url.endsWith("/pulls/9")) return response(404, "missing", url);
        if (url.endsWith("/issues/1")) return response(200, issue(1, "Задача"), url);
        if (url.includes("/reviews")) return response(200, [], url);
        return response(200, pull(9, "Секрет", "Lesha"), url);
      }),
    );
    missing = true;
    await refreshWatch(reader, [run.id], 4_000_000 + FRESH_OPEN_MS, github(sent, (url) => {
      if (url.endsWith("/pulls/9")) return response(404, "missing", url);
      if (url.endsWith("/issues/1")) return response(200, issue(1, "Задача"), url);
      return response(404, "missing", url);
    }));
    assert.equal(history()?.links[0]?.title, null);
    assert.equal(history()?.links[0]?.visibility, "hidden");
    assert.equal(history()?.links[0]?.facts.length, 0);
    assert.equal(history()?.source?.title, "Задача");
  });

  it("follows a transfer and keeps the same public subject", async () => {
    resetGithubPause();
    const sent: Sent[] = [];
    const { reader, run, history } = stage(watchRun([]));
    const moved = issue(1, "Переехала", "https://github.com/new/name/issues/1");
    await refreshWatch(
      reader,
      [run.id],
      5_000_000,
      github(sent, () =>
        response(200, moved, "https://api.github.com/repos/new/name/issues/1"),
      ),
    );
    assert.equal(history()?.source?.owner, "new");
    assert.equal(history()?.source?.repo, "name");
    assert.equal(history()?.source?.title, "Переехала");
    assert.equal(history()?.source?.visibility, "public");
    await refreshWatch(
      reader,
      [run.id],
      5_000_000 + FRESH_OPEN_MS,
      github(sent, (url) => response(200, moved, url)),
    );
    assert.equal(sent.at(-1)?.url, "https://api.github.com/repos/new/name/issues/1");
  });

  it("does not bind a mention or label someone else's merged pull", async () => {
    resetGithubPause();
    process.env.GITHUB_TOKEN = "test-token";
    const sent: Sent[] = [];
    const { reader, run, history } = stage(
      watchRun(
        [{ url: "https://github.com/vitejs/vite/pull/3", kind: "pull" }],
        "В тексте есть https://github.com/vitejs/vite/pull/44, но это не ссылка отчёта.",
      ),
      "Lesha",
    );
    await refreshWatch(
      reader,
      [run.id],
      6_000_000,
      github(sent, (url) => {
        if (url.endsWith("/graphql")) {
          return response(200, {
            data: {
              repository: {
                issue: {
                  closedByPullRequestsReferences: { nodes: [{ number: 3, merged: true }, { number: 44, merged: true }] },
                },
              },
            },
          }, url);
        }
        if (url.endsWith("/issues/1")) return response(200, issue(1, "Задача"), url);
        if (url.includes("/reviews")) return response(200, [], url);
        if (url.endsWith("/pulls/3")) return response(200, pull(3, "Чужой", "Other", { merged: true }), url);
        return response(404, "missing", url);
      }),
    );
    assert.deepEqual(
      history()?.links.map((link) => link.number),
      [3],
    );
    assert.equal(history()?.links[0]?.byResearcher, false);
    assert.equal(history()?.links[0]?.fixedByResearcher, false);
    assert.equal(history()?.links[0]?.state, "merged");
    assert.equal(sent.some((item) => item.url.endsWith("/pulls/44")), false);
    assert.equal(sent.some((item) => item.hasCookie), false);
  });

  it("labels a fix only from an explicit merged pull by the report author", async () => {
    resetGithubPause();
    process.env.GITHUB_TOKEN = "test-token";
    const sent: Sent[] = [];
    const { reader, run, history } = stage(
      watchRun([{ url: "https://github.com/vitejs/vite/pull/9", kind: "pull" }]),
    );
    const fetchImpl = github(sent, (url) => {
      if (url.endsWith("/graphql")) {
        return response(200, {
          data: {
            repository: {
              issue: { closedByPullRequestsReferences: { nodes: [{ number: 9, merged: true }] } },
            },
          },
        }, url);
      }
      if (url.endsWith("/issues/1")) return response(200, issue(1, "Задача"), url);
      if (url.includes("/reviews")) return response(200, [], url);
      return response(200, pull(9, "Правка", "lesha", { merged: true }), url);
    });
    await refreshWatch(reader, [run.id], 7_000_000, fetchImpl);
    assert.equal(history()?.links[0]?.fixedByResearcher, true);
    assert.equal(history()?.links[0]?.byResearcher, true);
    assert.equal(sent.some((item) => item.authorization === "Bearer test-token"), true);
    assert.equal(sent.some((item) => item.hasCookie), false);

    delete process.env.GITHUB_TOKEN;
    resetGithubPause();
    const bare: Sent[] = [];
    const second = stage(watchRun([{ url: "https://github.com/vitejs/vite/pull/8", kind: "pull" }]));
    await refreshWatch(
      second.reader,
      [second.run.id],
      8_000_000,
      github(bare, (url) => {
        if (url.endsWith("/issues/1")) return response(200, issue(1, "Задача"), url);
        if (url.includes("/reviews")) return response(200, [], url);
        return response(200, pull(8, "Без справки", "Lesha", { merged: true }), url);
      }),
    );
    assert.equal(second.history()?.links[0]?.state, "merged");
    assert.equal(second.history()?.links[0]?.byResearcher, true);
    assert.equal(second.history()?.links[0]?.fixedByResearcher, false);
    assert.equal(bare.some((item) => item.url.endsWith("/graphql")), false);
  });

  it("stops after the call budget and saves a pull when review would be the extra call", async () => {
    resetGithubPause();
    assert.equal(WATCH_CALL_BUDGET, 6);
    const sent: Sent[] = [];
    const links = [2, 3, 4, 5, 6, 7].map((number) => ({
      url: `https://github.com/vitejs/vite/issues/${number}`,
      kind: "issue" as const,
    }));
    const crowded = stage(watchRun(links));
    await refreshWatch(
      crowded.reader,
      [crowded.run.id],
      9_000_000,
      github(sent, (url) => {
        const number = Number(url.match(/issues\/(\d+)/)?.[1]);
        return response(200, issue(number, `Задача ${number}`), url);
      }),
    );
    assert.equal(sent.length, 6);
    assert.equal(crowded.history()?.links.find((link) => link.number === 7)?.checkedAt, null);
    assert.equal(crowded.history()?.source?.title, "Задача 1");

    const tight: Sent[] = [];
    const pullLast = stage(
      watchRun([
        ...[2, 3, 4, 5].map((number) => ({
          url: `https://github.com/vitejs/vite/issues/${number}`,
          kind: "issue" as const,
        })),
        { url: "https://github.com/vitejs/vite/pull/9", kind: "pull" },
      ]),
    );
    await refreshWatch(
      pullLast.reader,
      [pullLast.run.id],
      9_100_000,
      github(tight, (url) => {
        if (url.includes("/reviews")) return response(200, [], url);
        if (url.endsWith("/pulls/9")) return response(200, pull(9, "Позже", "Lesha"), url);
        const number = Number(url.match(/issues\/(\d+)/)?.[1]);
        return response(200, issue(number, `Задача ${number}`), url);
      }),
    );
    assert.equal(tight.length, 6);
    assert.equal(tight.some((item) => item.url.includes("/reviews")), false);
    assert.equal(pullLast.history()?.links.find((link) => link.number === 9)?.review, null);
    assert.equal(pullLast.history()?.links.find((link) => link.number === 9)?.title, "Позже");
  });

  it("continues after one broken payload", async () => {
    resetGithubPause();
    const sent: Sent[] = [];
    const { reader, run, history } = stage(
      watchRun([{ url: "https://github.com/vitejs/vite/pull/9", kind: "pull" }]),
    );
    await refreshWatch(
      reader,
      [run.id],
      10_000_000,
      github(sent, (url) => {
        if (url.endsWith("/issues/1")) {
          return {
            status: 200,
            ok: true,
            url,
            headers: { get: () => null },
            text: async () => "{",
            json: async () => {
              throw new Error("bad json");
            },
          } as unknown as Response;
        }
        if (url.includes("/reviews")) return response(200, [], url);
        return response(200, pull(9, "Правка", "Lesha"), url);
      }),
    );
    assert.equal(history()?.source?.stale, true);
    assert.equal(history()?.links[0]?.title, "Правка");
    assert.equal(sent.some((item) => item.hasCookie), false);
  });
});

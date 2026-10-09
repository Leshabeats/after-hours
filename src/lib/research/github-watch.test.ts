import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  emptySubject,
  fixedByResearcher,
  foldReviews,
  githubStateLabel,
  mergeObservation,
  parseGithubLink,
  planBindings,
  shouldRefresh,
  subjectCard,
  FRESH_OPEN_MS,
  FRESH_RETRY_MS,
  FRESH_TERMINAL_MS,
  type WatchRun,
} from "./github-watch.ts";
import type { ResearchReport } from "./types.ts";

function report(links: ResearchReport["links"]): ResearchReport {
  return {
    schemaVersion: 1,
    findings: "Итог",
    work: "Смотрел",
    evidence: [],
    unknowns: [],
    nextSteps: [],
    links,
  };
}

function run(overrides: Partial<WatchRun> = {}): WatchRun {
  return {
    id: "run_1",
    owner: "vitejs",
    repo: "vite",
    number: 1,
    isPr: false,
    publishedAt: 10,
    status: "completed",
    report: report([
      { url: "https://github.com/vitejs/vite/pull/9", kind: "pull" },
      { url: "https://github.com/vitejs/vite/issues/1#issuecomment-4", kind: "issue" },
    ]),
    ...overrides,
  };
}

describe("github watch rules", () => {
  it("keeps pull and issue links and drops everything else", () => {
    assert.deepEqual(parseGithubLink("https://github.com/vitejs/vite/pull/9"), {
      kind: "pull",
      owner: "vitejs",
      repo: "vite",
      number: 9,
    });
    assert.deepEqual(parseGithubLink("https://github.com/vitejs/vite/issues/3#issuecomment-8"), {
      kind: "issue",
      owner: "vitejs",
      repo: "vite",
      number: 3,
    });
    assert.equal(parseGithubLink("https://github.com/vitejs/vite/pull/9#discussion_r12")?.number, 9);
    assert.equal(parseGithubLink("https://github.com/vitejs/vite/commit/abc"), null);
    assert.equal(parseGithubLink("https://github.com/vitejs/vite/pull/9/files"), null);
    assert.equal(parseGithubLink("https://example.com/vitejs/vite/pull/9"), null);
    assert.equal(parseGithubLink("javascript:alert(1)"), null);
  });

  it("binds the source once and ignores the issue's own link", () => {
    const planned = planBindings(run());
    assert.deepEqual(
      planned.map((item) => `${item.relation}:${item.kind}#${item.number}`),
      ["source:issue#1", "linked:pull#9"],
    );
    assert.equal(planBindings(run({ publishedAt: null })).length, 0);
    assert.equal(planBindings(run({ status: "in_progress" })).length, 0);
  });

  it("folds reviews by the latest opinion of each person", () => {
    assert.equal(
      foldReviews(
        [
          { login: "Ann", state: "APPROVED", submittedAt: "1" },
          { login: "bob", state: "CHANGES_REQUESTED", submittedAt: "2" },
          { login: "Bob", state: "APPROVED", submittedAt: "3" },
        ],
        false,
      ),
      "approved",
    );
    assert.equal(
      foldReviews(
        [
          { login: "Ann", state: "APPROVED", submittedAt: "1" },
          { login: "Bob", state: "CHANGES_REQUESTED", submittedAt: "2" },
        ],
        false,
      ),
      "changes_requested",
    );
    assert.equal(
      foldReviews(
        [
          { login: "Ann", state: "CHANGES_REQUESTED", submittedAt: "1" },
          { login: "Ann", state: "DISMISSED", submittedAt: "2" },
          { login: "Bob", state: "COMMENTED", submittedAt: "3" },
        ],
        false,
      ),
      null,
    );
    assert.equal(foldReviews([], true), "unknown");
  });

  it("names a fix only for the author's merged closing pull", () => {
    const closing = [{ number: 9, merged: true }];
    assert.equal(
      fixedByResearcher({
        kind: "pull",
        explicitlyLinked: true,
        byResearcher: true,
        state: "merged",
        prNumber: 9,
        closing,
      }),
      true,
    );
    assert.equal(
      fixedByResearcher({
        kind: "pull",
        explicitlyLinked: true,
        byResearcher: false,
        state: "merged",
        prNumber: 9,
        closing,
      }),
      false,
    );
    assert.equal(
      fixedByResearcher({
        kind: "pull",
        explicitlyLinked: false,
        byResearcher: true,
        state: "merged",
        prNumber: 9,
        closing,
      }),
      false,
    );
    assert.equal(
      fixedByResearcher({
        kind: "pull",
        explicitlyLinked: true,
        byResearcher: true,
        state: "merged",
        prNumber: 9,
        closing: null,
      }),
      false,
    );
    assert.equal(
      fixedByResearcher({
        kind: "pull",
        explicitlyLinked: true,
        byResearcher: true,
        state: "merged",
        prNumber: 8,
        closing,
      }),
      false,
    );
  });

  it("waits out a pause, a fresh open subject, and a terminal subject", () => {
    const row = emptySubject("gh_1", { kind: "issue", owner: "vitejs", repo: "vite", number: 1 });
    assert.equal(shouldRefresh(row, 100, 200), false);
    assert.equal(shouldRefresh(row, 300, 200), true);
    const open = { ...row, checkedAt: 0, isPublic: true, state: "open" as const };
    assert.equal(shouldRefresh(open, FRESH_OPEN_MS - 1, 0), false);
    assert.equal(shouldRefresh(open, FRESH_OPEN_MS, 0), true);
    const merged = { ...open, state: "merged" as const };
    assert.equal(shouldRefresh(merged, FRESH_TERMINAL_MS - 1, 0), false);
    const failed = { ...open, error: "unavailable" as const };
    assert.equal(shouldRefresh(failed, FRESH_RETRY_MS - 1, 0), false);
    assert.equal(shouldRefresh(failed, FRESH_RETRY_MS, 0), true);
  });

  it("keeps the last public snapshot when GitHub fails", () => {
    const prev = {
      ...emptySubject("gh_1", { kind: "pull", owner: "vitejs", repo: "vite", number: 9 }),
      isPublic: true,
      title: "Старый",
      htmlUrl: "https://github.com/vitejs/vite/pull/9",
      state: "open" as const,
      checkedAt: 5,
      commentCount: 2,
    };
    const failed = mergeObservation(prev, { type: "unavailable" }, 9);
    assert.equal(failed.row.title, "Старый");
    assert.equal(failed.row.error, "unavailable");
    assert.equal(failed.facts.length, 0);
    const hidden = mergeObservation(prev, { type: "private" }, 9);
    assert.equal(hidden.row.title, null);
    assert.equal(hidden.row.isPublic, false);
    const rated = mergeObservation(prev, { type: "rate" }, 9);
    assert.equal(rated.row.title, "Старый");
    assert.equal(rated.row.state, "open");
  });

  it("records merge, review, comments, and reopen once each", () => {
    let row = emptySubject("gh_1", { kind: "pull", owner: "vitejs", repo: "vite", number: 9 });
    const opened = mergeObservation(
      row,
      {
        type: "ok",
        observed: {
          nodeId: "n1",
          kind: "pull",
          owner: "vitejs",
          repo: "vite",
          number: 9,
          authorLogin: "Lesha",
          title: "Правка",
          htmlUrl: "https://github.com/vitejs/vite/pull/9",
          state: "open",
          draft: false,
          review: "changes_requested",
          commentCount: 1,
        },
      },
      10,
    );
    assert.deepEqual(opened.facts.map((fact) => fact.kind), ["changes_requested"]);
    const again = mergeObservation(opened.row, {
      type: "ok",
      observed: {
        nodeId: "n1",
        kind: "pull",
        owner: "vitejs",
        repo: "vite",
        number: 9,
        authorLogin: "Lesha",
        title: "Правка",
        htmlUrl: "https://github.com/vitejs/vite/pull/9",
        state: "open",
        draft: false,
        review: "changes_requested",
        commentCount: 1,
      },
    }, 20);
    assert.equal(again.facts.length, 0);
    const commented = mergeObservation(again.row, {
      type: "ok",
      observed: {
        nodeId: "n1",
        kind: "pull",
        owner: "vitejs",
        repo: "vite",
        number: 9,
        authorLogin: "Lesha",
        title: "Правка",
        htmlUrl: "https://github.com/vitejs/vite/pull/9",
        state: "closed",
        draft: false,
        review: "approved",
        commentCount: 3,
      },
    }, 30);
    assert.deepEqual(commented.facts.map((fact) => fact.kind), ["comments", "approved", "closed"]);
    const reopened = mergeObservation(commented.row, {
      type: "ok",
      observed: {
        nodeId: "n1",
        kind: "pull",
        owner: "vitejs",
        repo: "vite",
        number: 9,
        authorLogin: "Lesha",
        title: "Правка",
        htmlUrl: "https://github.com/vitejs/vite/pull/9",
        state: "open",
        draft: false,
        review: "approved",
        commentCount: 3,
      },
    }, 40);
    assert.deepEqual(reopened.facts.map((fact) => fact.kind), ["reopened"]);
    row = reopened.row;
    row.state = "merged";
    const stuck = mergeObservation(row, {
      type: "ok",
      observed: {
        nodeId: "n1",
        kind: "pull",
        owner: "vitejs",
        repo: "vite",
        number: 9,
        authorLogin: "Lesha",
        title: "Правка",
        htmlUrl: "https://github.com/vitejs/vite/pull/9",
        state: "open",
        draft: false,
        review: null,
        commentCount: 3,
      },
    }, 50);
    assert.equal(stuck.row.state, "merged");
    assert.equal(stuck.facts.some((fact) => fact.kind === "reopened"), false);
  });

  it("hides a private subject and keeps a public fix label", () => {
    const subject = {
      ...emptySubject("gh_1", { kind: "pull", owner: "vitejs", repo: "vite", number: 9 }),
      isPublic: false,
      title: "Секрет",
      authorLogin: "Lesha",
      state: "merged" as const,
      checkedAt: 10,
    };
    const hidden = subjectCard(subject, {
      researcherLogin: "lesha",
      explicitlyLinked: true,
      closing: [{ number: 9, merged: true }],
      facts: [{ kind: "merged", at: 10 }],
    });
    assert.equal(hidden.title, null);
    assert.equal(hidden.facts.length, 0);
    assert.equal(hidden.fixedByResearcher, false);
    const visible = subjectCard(
      { ...subject, isPublic: true, title: "Правка", htmlUrl: "https://github.com/vitejs/vite/pull/9" },
      {
        researcherLogin: "lesha",
        explicitlyLinked: true,
        closing: [{ number: 9, merged: true }],
        facts: [{ kind: "merged", at: 10 }],
      },
    );
    assert.equal(visible.fixedByResearcher, true);
    assert.equal(visible.byResearcher, true);
  });

  it("keeps an unfinished review and ignores a smaller comment count", () => {
    const prev = {
      ...emptySubject("gh_1", { kind: "pull", owner: "vitejs", repo: "vite", number: 9 }),
      isPublic: true,
      state: "open" as const,
      review: "approved" as const,
      commentCount: 4,
      checkedAt: 1,
    };
    const truncated = mergeObservation(
      prev,
      {
        type: "ok",
        observed: {
          nodeId: "n1",
          kind: "pull",
          owner: "vitejs",
          repo: "vite",
          number: 9,
          authorLogin: "Lesha",
          title: "Правка",
          htmlUrl: "https://github.com/vitejs/vite/pull/9",
          state: "open",
          draft: false,
          review: "unknown",
          commentCount: 2,
        },
      },
      10,
    );
    assert.equal(truncated.row.review, "unknown");
    assert.equal(truncated.facts.length, 0);
    assert.equal(
      githubStateLabel({
        kind: "pull",
        state: "open",
        draft: false,
        review: "unknown",
        visibility: "public",
        facts: [],
      }),
      "открыт",
    );
    assert.equal(
      githubStateLabel({
        kind: "pull",
        state: "open",
        draft: true,
        review: null,
        visibility: "public",
        facts: [],
      }),
      "черновик",
    );
    assert.equal(
      githubStateLabel({
        kind: "pull",
        state: "open",
        draft: false,
        review: null,
        visibility: "public",
        facts: [{ kind: "reopened", at: 1 }],
      }),
      "открыт снова",
    );
    assert.equal(
      githubStateLabel({
        kind: "issue",
        state: "closed",
        draft: false,
        review: null,
        visibility: "public",
        facts: [],
      }),
      "закрыта",
    );
  });
});

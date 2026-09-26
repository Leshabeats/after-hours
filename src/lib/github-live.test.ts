import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { freshSliceCaption } from "./issue-slice.ts";
import { loadMission, loadRepoMissions } from "./github-live.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function issueItem(owner: string, repo: string, number: number, title: string) {
  return {
    title,
    number,
    html_url: `https://github.com/${owner}/${repo}/issues/${number}`,
    body: `body ${number}`,
    comments: 1,
    created_at: "2024-01-02T00:00:00Z",
    updated_at: "2024-06-02T00:00:00Z",
    labels: ["bug"],
    user: { login: "someone" },
    repository_url: `https://api.github.com/repos/${owner}/${repo}`,
  };
}

function prItem(owner: string, repo: string, number: number) {
  return {
    ...issueItem(owner, repo, number, `pr ${number}`),
    html_url: `https://github.com/${owner}/${repo}/pull/${number}`,
    pull_request: {},
  };
}

function stubGithub(owner: string, repo: string) {
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push(url);
    if (url.includes("/search/issues")) {
      const query = new URL(url).searchParams.get("q") ?? "";
      if (query.includes("is:pr")) {
        return json({
          items: [prItem(owner, repo, 8)],
          total_count: 12,
        });
      }
      return json({
        items: [
          issueItem(owner, repo, 43911, "opened first"),
          issueItem(owner, repo, 100, "another open issue"),
        ],
        total_count: 90,
      });
    }
    if (url.includes(`/issues/43911`)) {
      return json(issueItem(owner, repo, 43911, "opened first"));
    }
    if (url.includes("/issues/100")) {
      return json(issueItem(owner, repo, 100, "another open issue"));
    }
    if (url.includes("/issues/777")) {
      return json(issueItem(owner, repo, 777, "opened after the slice"));
    }
    if (url.includes("api.github.com/graphql")) {
      return json({ message: "rate limit" }, 403);
    }
    if (url.includes(`/repos/${owner}/${repo}`)) {
      return json({
        description: "A live description that is not the shelf line",
        stargazers_count: 20,
        language: "C",
        owner: { avatar_url: "https://example.com/logo.png" },
        html_url: `https://github.com/${owner}/${repo}`,
      });
    }
    return json({ message: "unexpected" }, 404);
  };
  return calls;
}

describe("loadRepoMissions after loadMission", () => {
  it("does not treat one opened issue as the repository slice", async () => {
    const owner = "cache-order";
    const repo = "probe";
    const calls = stubGithub(owner, repo);

    const opened = await loadMission(owner, repo, 43911);
    assert.equal(opened.number, 43911);
    assert.equal(opened.title, "opened first");
    assert.equal(
      calls.some((url) => url.includes("/search/issues")),
      false,
    );

    const page = await loadRepoMissions(owner, repo);
    assert.equal(page.issueTotal, 90);
    assert.equal(page.prTotal, 12);
    assert.equal(page.filterSkipped, true);
    assert.deepEqual(
      page.issues.map((item) => item.number).sort((a, b) => a - b),
      [100, 43911],
    );
    assert.deepEqual(
      page.pullRequests.map((item) => item.number),
      [8],
    );
    assert.equal(freshSliceCaption(page.issues.length, page.issueTotal), "2 свежих из 90");
    assert.equal(
      calls.filter((url) => url.includes("/search/issues")).length,
      2,
    );
  });

  it("keeps the fresh slice when a later issue is opened", async () => {
    const owner = "cache-order";
    const repo = "later";
    stubGithub(owner, repo);

    const first = await loadRepoMissions(owner, repo);
    assert.equal(first.issueTotal, 90);
    assert.equal(first.filterSkipped, true);

    const opened = await loadMission(owner, repo, 777);
    assert.equal(opened.number, 777);
    assert.equal(opened.title, "opened after the slice");

    const again = await loadRepoMissions(owner, repo);
    assert.equal(again.issueTotal, 90);
    assert.equal(again.prTotal, 12);
    assert.equal(again.filterSkipped, true);
    assert.equal(again.issues.length, 2);
    assert.equal(freshSliceCaption(again.issues.length, again.issueTotal), "2 свежих из 90");
  });
});

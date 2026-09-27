import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { freshSliceCaption } from "./issue-slice.ts";
import { loadMission, loadProjects, loadRepoMissions } from "./github-live.ts";

const realFetch = globalThis.fetch;
const savedToken = process.env.GITHUB_TOKEN;
delete process.env.GITHUB_TOKEN;

afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = savedToken;
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
    if (url.includes("/timeline")) return json({ message: "rate limit" }, 403);
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

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe("review fixes", () => {
  it("does not search when the repo name contains a qualifier", async () => {
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(requestUrl(input));
      return json({ message: "no" }, 404);
    };
    const page = await loadRepoMissions("microsoft", "vscode -org:microsoft");
    assert.equal(calls.length, 0);
    assert.equal(page.live, false);
    assert.equal(page.issues.length, 0);
  });

  it("keeps a successful pull-request slice when the issue search fails", async () => {
    globalThis.fetch = async (input) => {
      const url = requestUrl(input);
      const query = url.includes("/search/issues")
        ? new URL(url).searchParams.get("q") ?? ""
        : "";
      if (query.includes("is:issue")) return json({ message: "boom" }, 500);
      if (query.includes("is:pr")) {
        return json({
          items: [prItem("partial", "repo", 8)],
          total_count: 3,
        });
      }
      if (url.includes("/repos/partial/repo")) {
        return json({
          description: "Live partial",
          stargazers_count: 1,
          owner: { avatar_url: "https://example.com/a.png" },
        });
      }
      return json({ message: "no" }, 404);
    };
    const page = await loadRepoMissions("partial", "repo");
    assert.equal(page.live, true);
    assert.equal(page.issues.length, 0);
    assert.equal(page.issueTotal, null);
    assert.equal(page.prTotal, 3);
    assert.equal(page.pullRequests.length, 1);
    assert.equal(page.filterSkipped, false);
  });

  it("treats an empty successful search as live and does not restore seeds", async () => {
    globalThis.fetch = async (input) => {
      const url = requestUrl(input);
      if (url.includes("/search/issues")) return json({ items: [], total_count: 0 });
      if (url.includes("/repos/vitejs/vite")) {
        return json({ description: "Vite", stargazers_count: 1 });
      }
      return json({ message: "no" }, 404);
    };
    const page = await loadRepoMissions("vitejs", "vite");
    assert.equal(page.live, true);
    assert.equal(page.issues.length, 0);
    assert.equal(page.pullRequests.length, 0);
    assert.equal(page.filterSkipped, false);
  });

  it("drops an issue whose public timeline shows a merged pull request", async () => {
    globalThis.fetch = async (input) => {
      const url = requestUrl(input);
      if (url.includes("/timeline")) {
        const merged = url.includes("/issues/43911/");
        return json(
          merged
            ? [
                {
                  event: "cross-referenced",
                  source: {
                    issue: { pull_request: { merged_at: "2024-03-03T00:00:00Z" } },
                  },
                },
              ]
            : [],
        );
      }
      if (url.includes("/search/issues")) {
        const query = new URL(url).searchParams.get("q") ?? "";
        if (query.includes("is:pr")) return json({ items: [], total_count: 0 });
        return json({
          items: [
            issueItem("timeline", "repo", 43911, "already fixed"),
            issueItem("timeline", "repo", 100, "still open"),
          ],
          total_count: 2,
        });
      }
      if (url.includes("/repos/timeline/repo")) {
        return json({ description: "Timeline", stargazers_count: 1 });
      }
      return json({ message: "no" }, 404);
    };
    const page = await loadRepoMissions("timeline", "repo");
    assert.equal(page.filterSkipped, false);
    assert.deepEqual(
      page.issues.map((item) => item.number),
      [100],
    );
  });

  it("refetches an opened issue after the cache window", async () => {
    const calls: string[] = [];
    const start = 1_700_000_000_000;
    const realNow = Date.now;
    Date.now = () => start;
    globalThis.fetch = async (input) => {
      const url = requestUrl(input);
      calls.push(url);
      if (url.includes("/issues/43911")) {
        return json(issueItem("ttl-order", "probe", 43911, "first title"));
      }
      return json({ message: "no" }, 404);
    };
    try {
      const first = await loadMission("ttl-order", "probe", 43911);
      assert.equal(first.title, "first title");
      const fetches = () => calls.filter((url) => url.includes("/issues/43911")).length;
      assert.equal(fetches(), 1);
      Date.now = () => start + 1000;
      await loadMission("ttl-order", "probe", 43911);
      assert.equal(fetches(), 1);
      Date.now = () => start + 12 * 60 * 1000 + 1;
      globalThis.fetch = async (input) => {
        const url = requestUrl(input);
        calls.push(url);
        if (url.includes("/issues/43911")) {
          return json(issueItem("ttl-order", "probe", 43911, "edited title"));
        }
        return json({ message: "no" }, 404);
      };
      const again = await loadMission("ttl-order", "probe", 43911);
      assert.equal(again.title, "edited title");
      assert.equal(fetches(), 2);
    } finally {
      Date.now = realNow;
    }
  });

  it("does not spend a repo request on every pinned library", async () => {
    const repoGets: string[] = [];
    globalThis.fetch = async (input) => {
      const url = requestUrl(input);
      if (url.includes("/search/repositories")) return json({ items: [] });
      if (url.includes("/repos/") && !url.includes("/contents/")) {
        repoGets.push(url);
        return json({
          description: "Live project",
          stargazers_count: 10,
          language: "TypeScript",
          owner: { avatar_url: "https://example.com/a.png" },
        });
      }
      return json({ message: "no" }, 404);
    };
    const shelf = await loadProjects({ category: "web", language: "TypeScript" });
    const zod = shelf.libraries.find((project) => project.repo === "zod");
    assert.ok(zod);
    assert.equal(zod?.live, false);
    assert.equal(repoGets.some((url) => url.includes("/zod")), false);
    assert.ok(repoGets.length <= 15);
    assert.ok(repoGets.some((url) => url.includes("/TypeScript")));
  });
});

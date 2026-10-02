import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { freshSliceCaption } from "./issue-slice.ts";
import { loadMission, loadProjects, loadRepoMissions } from "./github-live.ts";

const realFetch = globalThis.fetch;
const savedToken = process.env.GITHUB_TOKEN;
beforeEach(() => { delete process.env.GITHUB_TOKEN; });

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
    if (new URL(url).pathname.endsWith("/timeline")) return json({ message: "rate limit" }, 403);
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
        private: false,
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
          private: false,
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
        return json({ private: false,
          description: "Vite", stargazers_count: 1 });
      }
      return json({ message: "no" }, 404);
    };
    const page = await loadRepoMissions("vitejs", "vite");
    assert.equal(page.live, true);
    assert.equal(page.issues.length, 0);
    assert.equal(page.pullRequests.length, 0);
    assert.equal(page.filterSkipped, false);
  });

  it("keeps issues without trusting timeline mentions when no token is configured", async () => {
    globalThis.fetch = async (input) => {
      const url = requestUrl(input);
      if (new URL(url).pathname.endsWith("/timeline")) {
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
        return json({ private: false,
          description: "Timeline", stargazers_count: 1 });
      }
      return json({ message: "no" }, 404);
    };
    const page = await loadRepoMissions("timeline", "repo");
    assert.equal(page.filterSkipped, true);
    assert.deepEqual(
      page.issues.map((item) => item.number),
      [43911, 100],
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
      if (url.endsWith("/repos/ttl-order/probe")) return json({ private: false });
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
        if (url.endsWith("/repos/ttl-order/probe")) return json({ private: false });
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
          private: false,
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

describe("public repository boundary", () => {
  it("preserves public transferred issues and rechecks destination visibility", async () => {
    let destinationPrivate = false;
    globalThis.fetch = async (input) => {
      const url = requestUrl(input);
      if (url.endsWith("/repos/public-transfer/source")) return json({ private: false });
      if (url.endsWith("/repos/public-transfer/destination")) return json({ private: destinationPrivate });
      if (url.endsWith("/issues/18")) return json(issueItem("public-transfer", "destination", 19, "Transferred public issue"));
      throw new Error(`Unexpected request: ${url}`);
    };
    const mission = await loadMission("public-transfer", "source", 18);
    assert.equal(mission.title, "Transferred public issue");
    assert.equal(mission.body, "body 19");
    assert.equal(mission.repo, "destination");
    destinationPrivate = true;
    assert.equal((await loadMission("public-transfer", "source", 18)).body, "");
    assert.equal((await loadMission("public-transfer", "destination", 19)).body, "");
  });

  it("never exposes an issue transferred into a private repository or caches its body", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    let issueRequests = 0;
    let publicSearches = 0;
    globalThis.fetch = async (input) => {
      const url = requestUrl(input);
      if (url.endsWith("/repos/transfer-source/public")) return json({ private: false });
      if (url.endsWith("/repos/transfer-target/private")) return json({ private: true });
      if (url.endsWith("/issues/17")) {
        issueRequests++;
        // The token can read the private destination after fetch follows a 301.
        return json(issueItem("transfer-target", "private", 17, "PRIVATE TITLE"));
      }
      if (url.includes("/search/issues")) {
        assert.ok(new URL(url).searchParams.get("q")?.split(" ").includes("is:public"));
        publicSearches++;
        return json({ items: [], total_count: 0 });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const mission = await loadMission("transfer-source", "public", 17);
      assert.equal(mission.body, "");
      assert.equal(mission.live, false);
      assert.equal(mission.title, "transfer-source/public#17");
    }
    assert.equal(issueRequests, 2);
    assert.equal(publicSearches, 0);
  });

  for (const visibility of [true, undefined]) {
    it(`refuses issue and repository data when private=${visibility}`, async () => {
      process.env.GITHUB_TOKEN = "test-token";
      const calls: string[] = [];
      globalThis.fetch = async (input) => {
        calls.push(requestUrl(input));
        return json({ private: visibility, description: "PRIVATE DESCRIPTION" });
      };
      const mission = await loadMission("private-owner", "private-repo", 1);
      const page = await loadRepoMissions("private-owner", "private-repo");
      assert.equal(mission.body, "");
      assert.equal(mission.live, false);
      assert.equal(page.profile.description, "");
      assert.deepEqual(page.issues, []);
      assert.deepEqual(page.pullRequests, []);
      assert.ok(calls.every((url) => url.endsWith("/repos/private-owner/private-repo")));
    });
  }

  it("checks visibility again before returning cached bodies, slices or profiles", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    stubGithub("visibility-change", "repo");
    const mission = await loadMission("visibility-change", "repo", 43911);
    const page = await loadRepoMissions("visibility-change", "repo");
    assert.ok(mission.body);
    assert.ok(page.issues.length);
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(requestUrl(input));
      return json({ private: true, description: "NOW PRIVATE" });
    };
    assert.equal((await loadMission("visibility-change", "repo", 43911)).body, "");
    const denied = await loadRepoMissions("visibility-change", "repo");
    assert.equal(denied.issues.length, 0);
    assert.equal(denied.pullRequests.length, 0);
    assert.equal(denied.profile.description, "");
    assert.equal(calls.length, 2);
  });

  it("does not serve cached private-capable data when the visibility check fails", async () => {
    stubGithub("visibility-error", "repo");
    await loadMission("visibility-error", "repo", 43911);
    await loadRepoMissions("visibility-error", "repo");
    globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
    assert.equal((await loadMission("visibility-error", "repo", 43911)).body, "");
    assert.equal((await loadRepoMissions("visibility-error", "repo")).issues.length, 0);
  });

  it("restricts issue, fallback and library searches to public repositories", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    const queries: string[] = [];
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = requestUrl(input);
      calls.push(url);
      if (url.includes("/search/")) {
        const query = new URL(url).searchParams.get("q") ?? "";
        queries.push(query);
        if (url.includes("/search/repositories")) return json({ items: [
          { name: "private-library", private: true, owner: { login: "fixture" } },
          { name: "public-library", private: false, owner: { login: "fixture" } },
        ] });
        return json({ items: [], total_count: 0 });
      }
      if (url.includes("/contents/")) return json([{ name: "Cargo.toml" }]);
      if (url.includes("/issues/")) return json({}, 404);
      return json({ private: false, description: "public", language: "Rust" });
    };
    await loadRepoMissions("search-public", "repo");
    await loadMission("search-public", "repo", 123);
    const shelf = await loadProjects({ category: "games", language: "Rust" });
    assert.equal(queries.length, 4);
    assert.ok(queries.every((query) => query.split(" ").includes("is:public")));
    assert.ok(shelf.libraries.some((item) => item.repo === "public-library"));
    assert.ok(!shelf.libraries.some((item) => item.repo === "private-library"));
    assert.ok(!calls.some((url) => url.includes("private-library")));
  });
});

describe("confirmed closing relationships", () => {
  for (const mode of ["merged", "network-error", "invalid-json", "graphql-error", "no-token"] as const) {
    it(`keeps lists usable with ${mode}`, async () => {
      if (mode !== "no-token") process.env.GITHUB_TOKEN = "test-token";
      const owner = "closing-lookup";
      const repo = mode;
      let timelineCalls = 0;
      globalThis.fetch = async (input) => {
        const url = requestUrl(input);
        if (new URL(url).pathname.endsWith("/timeline")) {
          timelineCalls++;
          throw new TypeError("timeline is unavailable");
        }
        if (url === "https://api.github.com/graphql") {
          if (mode === "network-error") throw new TypeError("fetch failed");
          if (mode === "invalid-json") return new Response("not JSON");
          if (mode === "graphql-error") return json({ errors: [{ message: "rate limit" }] });
          return json({ data: { repository: {
            i0: { number: 41, closedByPullRequestsReferences: { nodes: [{ merged: true }] } },
            i1: { number: 42, closedByPullRequestsReferences: { nodes: [{ merged: false }] } },
          } } });
        }
        if (url.includes("/search/issues")) {
          const isPr = new URL(url).searchParams.get("q")?.includes("is:pr");
          return json({ items: isPr ? [prItem(owner, repo, 43)] : [
            issueItem(owner, repo, 41, "fixed"), issueItem(owner, repo, 42, "open"),
          ], total_count: isPr ? 1 : 2 });
        }
        return json({ private: false });
      };
      const page = await loadRepoMissions(owner, repo);
      assert.deepEqual(page.issues.map((issue) => issue.number), mode === "merged" ? [42] : [41, 42]);
      assert.deepEqual(page.pullRequests.map((pr) => pr.number), [43]);
      assert.equal(page.filterSkipped, mode !== "merged");
      assert.equal(page.live, true);
      assert.equal(timelineCalls, 0);
    });
  }
});

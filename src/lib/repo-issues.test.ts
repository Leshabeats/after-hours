import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { repoIssuesLink } from "./repo-issues.ts";

describe("repoIssuesLink", () => {
  it("targets that repository's issues, not the previous page", () => {
    assert.deepEqual(repoIssuesLink("systemd", "systemd"), {
      to: "/r/$owner/$repo",
      params: { owner: "systemd", repo: "systemd" },
    });
    assert.deepEqual(repoIssuesLink("ollama", "ollama").params, {
      owner: "ollama",
      repo: "ollama",
    });
  });
});

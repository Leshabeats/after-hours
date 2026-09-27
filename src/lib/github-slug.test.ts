import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { githubSlug, repoSearchQualifier } from "./github-slug.ts";

describe("githubSlug", () => {
  it("keeps a repository name and drops search operators", () => {
    assert.equal(githubSlug("vscode"), "vscode");
    assert.equal(githubSlug("vscode -org:microsoft"), null);
    assert.equal(githubSlug("org microsoft"), null);
    assert.equal(repoSearchQualifier("microsoft", "vscode"), "repo:microsoft/vscode");
    assert.equal(repoSearchQualifier("microsoft", "vscode -org:microsoft"), null);
  });
});

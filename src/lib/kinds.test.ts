import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyKind,
  missionId,
  parseGithubRef,
} from "./kinds.ts";

describe("parseGithubRef", () => {
  it("parses issue and pull URLs", () => {
    assert.deepEqual(
      parseGithubRef("https://github.com/vitejs/vite/issues/23221"),
      { owner: "vitejs", repo: "vite", number: 23221 },
    );
    assert.deepEqual(
      parseGithubRef("https://github.com/TanStack/router/pull/8199 extra"),
      { owner: "TanStack", repo: "router", number: 8199 },
    );
  });

  it("parses owner/repo#number", () => {
    assert.deepEqual(parseGithubRef("  colinhacks/zod#6516  "), {
      owner: "colinhacks",
      repo: "zod",
      number: 6516,
    });
  });

  it("rejects noise", () => {
    assert.equal(parseGithubRef("vitejs/vite"), null);
    assert.equal(parseGithubRef("https://gitlab.com/org/repo/-/issues/1"), null);
  });
});

describe("classifyKind", () => {
  const now = new Date().toISOString();

  it("treats pull requests as review work", () => {
    assert.equal(
      classifyKind({ title: "fix leak", labels: [], isPr: true, createdAt: now }),
      "eyes",
    );
  });

  it("classifies labels and titles", () => {
    assert.equal(
      classifyKind({
        title: "Typo in README",
        labels: [],
        isPr: false,
        createdAt: now,
      }),
      "tears",
    );
    assert.equal(
      classifyKind({
        title: "Hang on close",
        labels: ["good first issue"],
        isPr: false,
        createdAt: now,
      }),
      "alone",
    );
    assert.equal(
      classifyKind({
        title: "Memory leak in SSR",
        labels: [],
        isPr: false,
        createdAt: now,
      }),
      "late",
    );
  });

  it("marks very old issues as bleed", () => {
    assert.equal(
      classifyKind({
        title: "Something vague",
        labels: [],
        isPr: false,
        createdAt: "2024-01-01T00:00:00Z",
      }),
      "bleed",
    );
  });
});

describe("missionId", () => {
  it("is stable", () => {
    assert.equal(missionId("vitejs", "vite", 1), "vitejs/vite#1");
  });
});

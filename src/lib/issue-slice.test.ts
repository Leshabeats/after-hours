import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  emptySliceMessage,
  freshSliceCaption,
  issueClosedByMergedPull,
  mergedIssueNumbers,
  splitWork,
  withoutMergedFixes,
} from "./issue-slice.ts";

describe("freshSliceCaption", () => {
  it("says the page is a slice when GitHub reports a larger total", () => {
    assert.equal(freshSliceCaption(40, 900), "40 свежих из 900");
  });

  it("stays quiet when everything returned fits", () => {
    assert.equal(freshSliceCaption(12, 12), null);
    assert.equal(freshSliceCaption(0, null), null);
  });
});

describe("emptySliceMessage", () => {
  it("says the track is empty when the slice itself has work", () => {
    assert.equal(
      emptySliceMessage(4, 0, true, "Открытых pull request нет."),
      "В этом треке пусто.",
    );
    assert.equal(
      emptySliceMessage(0, 0, true, "Открытых pull request нет."),
      "Открытых pull request нет.",
    );
  });
});

describe("issueClosedByMergedPull", () => {
  it("reads a merged pull request from a public timeline", () => {
    assert.equal(
      issueClosedByMergedPull([
        {
          event: "cross-referenced",
          source: { issue: { pull_request: { merged_at: null } } },
        },
        {
          event: "cross-referenced",
          source: { issue: { pull_request: { merged_at: "2024-02-02T00:00:00Z" } } },
        },
      ]),
      true,
    );
    assert.equal(
      issueClosedByMergedPull([
        { event: "commented" },
        {
          event: "cross-referenced",
          source: { issue: { pull_request: { merged_at: null } } },
        },
      ]),
      false,
    );
  });
});

describe("splitWork", () => {
  it("keeps pull requests out of the issue list", () => {
    const split = splitWork([
      { id: "a", isPr: false },
      { id: "b", isPr: true },
    ]);
    assert.deepEqual(split.issues.map((item) => item.id), ["a"]);
    assert.deepEqual(split.pullRequests.map((item) => item.id), ["b"]);
  });
});

describe("withoutMergedFixes", () => {
  it("drops an open issue that a merged pull request already fixes", () => {
    const result = withoutMergedFixes(
      [
        { id: "fixed", isPr: false, closingPrs: [{ merged: true }] },
        { id: "open", isPr: false, closingPrs: [{ merged: false }] },
        { id: "pr", isPr: true, closingPrs: [{ merged: true }] },
      ],
      false,
    );
    assert.equal(result.filterSkipped, false);
    assert.deepEqual(
      result.items.map((item) => item.id),
      ["open", "pr"],
    );
  });

  it("keeps every row when the lookup failed", () => {
    const rows = [{ id: "fixed", isPr: false, closingPrs: [{ merged: true }] }];
    const result = withoutMergedFixes(rows, true);
    assert.equal(result.filterSkipped, true);
    assert.equal(result.items.length, 1);
  });
});

describe("mergedIssueNumbers", () => {
  it("reads merged closing pull requests from a GraphQL repository map", () => {
    const numbers = mergedIssueNumbers({
      i0: {
        number: 9242,
        closedByPullRequestsReferences: { nodes: [{ merged: true }] },
      },
      i1: {
        number: 1,
        closedByPullRequestsReferences: { nodes: [{ merged: false }] },
      },
      i2: null,
    });
    assert.deepEqual([...numbers], [9242]);
  });
});

import assert from "node:assert/strict";
import { it } from "node:test";
import { describeResearchIssue, issueIndexQuery, parseIssueIndex } from "./issues.ts";

const checkedAt = Date.UTC(2026, 10, 27, 12);
const repo = { id: "99", owner: "example", repo: "browser" };
const issue = {
  number: 1,
  title: "Test fullscreen permission for a cross-origin frame",
  body: "Steps to reproduce: open fullscreen/api/permission.html in a test runner. The expected value is false, but the actual value is true.",
  state: "OPEN",
  updatedAt: new Date(checkedAt - 60_000).toISOString(),
  assignees: { totalCount: 0 },
  labels: { nodes: [{ name: "good first issue" }] },
  closedByPullRequestsReferences: { nodes: [], pageInfo: { hasNextPage: false } },
};
const repository = {
  databaseId: 99,
  nameWithOwner: "example/browser",
  isPrivate: false,
  visibility: "PUBLIC",
  isArchived: false,
};

it("rejects filler, proposals and empty issue templates", () => {
  assert.equal(describeResearchIssue("Ammar", "Ehat should i do", []), null);
  assert.equal(
    describeResearchIssue(
      issue.title,
      "<!-- Steps to reproduce and expected result go here. -->",
      [],
    ),
    null,
  );
  assert.equal(describeResearchIssue(issue.title, issue.body, ["type: tracking"]), null);
  assert.equal(describeResearchIssue(issue.title, issue.body, [])?.evidence, "reproduction");
});

it("excludes large plans and release checklists while allowing long reproduction logs", () => {
  const checklist = Array.from({ length: 8 }, (_, index) => `- [ ] Check subsystem ${index}\n`);
  assert.equal(describeResearchIssue(issue.title, issue.body + "\n" + checklist.join(""), []), null);
  const longPlan = "Update the renderer, runtime, bindings and migration guide.\n".repeat(90);
  assert.equal(describeResearchIssue("Vulkan implementation plan", issue.body + longPlan, []), null);

  const log = "```text\n" + "Test runner output\n".repeat(450) + "```";
  assert.equal(
    describeResearchIssue(issue.title, issue.body + "\n\n" + log, [])?.evidence,
    "reproduction",
  );
});

it("indexes open unassigned issues with complete fixing-PR checks", () => {
  const sample = (number: number, nodes: unknown[], hasNextPage = false) => ({
    ...issue,
    number,
    closedByPullRequestsReferences: { nodes, pageInfo: { hasNextPage } },
  });
  const nodes = [
    sample(1, [{ state: "OPEN" }]),
    sample(2, [{ state: "MERGED" }]),
    sample(3, [], true),
    sample(4, [{ state: "CLOSED" }]),
    { ...issue, number: 6, assignees: { totalCount: 1 } },
    { ...issue, number: 7, state: "CLOSED" },
    { ...issue, number: 9, updatedAt: new Date(checkedAt - 1000).toISOString() },
  ];
  const index = parseIssueIndex(
    { data: { r0: { ...repository, issues: { nodes } } } },
    [repo],
    checkedAt,
  );
  assert.deepEqual(
    index[0].issues?.map(({ number }) => number),
    [9, 4],
  );
  assert.match(issueIndexQuery([repo]).query, /closedByPullRequestsReferences/);
  assert.throws(() => parseIssueIndex({ data: {} }, [repo], checkedAt), /Incomplete/);
});

it("does not attach issue text from a private repository or a reused slug", () => {
  for (const metadata of [
    { ...repository, isPrivate: true, visibility: "PRIVATE" },
    { ...repository, databaseId: 100 },
  ]) {
    const result = parseIssueIndex(
      { data: { r0: { ...metadata, issues: { nodes: [issue] } } } },
      [repo],
      checkedAt,
    );
    assert.equal(JSON.stringify(result).includes(issue.title), false);
    assert.deepEqual(result[0].issues, metadata.databaseId === 99 ? null : []);
  }
});

import { z } from "zod";
import { excerptOf } from "../kinds.ts";
import type { DiscoveryIssue } from "./types.ts";

export const ISSUE_BATCH_SIZE = 5;
export const ISSUES_PER_PROJECT = 2;

export const discoveryIssueSchema = z.object({
  number: z.number().int().positive().safe(),
  title: z.string().min(1).max(500),
  excerpt: z.string().max(221),
  checkedAt: z.number().int().nonnegative(),
  evidence: z.enum(["reproduction", "file", "behavior"]),
});

const pageInfo = z.object({ hasNextPage: z.boolean() });
const issue = z.object({
  number: z.number().int().positive().safe(),
  title: z.string(),
  body: z.string(),
  state: z.string(),
  updatedAt: z.string(),
  assignees: z.object({ totalCount: z.number().int().nonnegative() }),
  labels: z.object({ nodes: z.array(z.object({ name: z.string() }).nullable()) }),
  closedByPullRequestsReferences: z.object({
    nodes: z.array(z.object({ state: z.enum(["OPEN", "CLOSED", "MERGED"]) }).nullable()),
    pageInfo,
  }),
});

const repository = z.object({
  databaseId: z.number().int().positive().safe().nullable(),
  nameWithOwner: z.string(),
  isPrivate: z.boolean(),
  visibility: z.string(),
  isArchived: z.boolean(),
  issues: z.object({ nodes: z.array(issue.nullable()).max(16) }),
});

const graph = z.object({
  data: z.record(z.string(), repository.nullable()),
  errors: z.array(z.unknown()).max(0).optional(),
});

export const issueRepositorySchema = z.object({
  id: z.string().regex(/^\d+$/),
  owner: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  repo: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
});
type IssueRepository = z.infer<typeof issueRepositorySchema>;

export function issueIndexQuery(repositories: IssueRepository[]) {
  const fields = repositories.map(
    (
      { owner, repo },
      index,
    ) => `r${index}: repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(repo)}) {
      databaseId nameWithOwner isPrivate visibility isArchived
      issues(first:16, states:[OPEN], orderBy:{field:UPDATED_AT,direction:DESC}) {
        nodes {
          number title body state updatedAt
          assignees(first:1) { totalCount }
          labels(first:12) { nodes { name } }
          closedByPullRequestsReferences(first:10,includeClosedPrs:true) {
            nodes { state }
            pageInfo { hasNextPage }
          }
        }
      }
    }`,
  );
  return { query: `query { ${fields.join("\n")} }` };
}

const simpleLabels =
  /^(?:good first issue|beginner(?:-friendly)?|easy|small|documentation|docs|tests?|test-only)$/i;
const broadLabels =
  /(?:^|[ :_-])(?:epic|roadmap|tracking|proposal|spam|duplicate|wontfix)(?:$|[ :_-])/i;
const fileReference =
  /(?:\b[\w@.-]+\/)+(?:[\w.-]+\.(?:tsx?|jsx?|html?|css|py|rs|go|java|cpp|c|h|md|json|ya?ml|toml|g?lsl|wgsl|zig))\b/i;
const fencedBlock = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm;
const checklistItem = /^[ \t]*[-+*][ \t]+\[[ xX]\]/gm;
const MAX_PROSE_LENGTH = 4_000;
const MAX_CHECKLIST_ITEMS = 5;

function candidate(value: z.infer<typeof issue>, checkedAt: number) {
  const links = value.closedByPullRequestsReferences;
  if (
    value.state !== "OPEN" ||
    value.assignees.totalCount > 0 ||
    links.pageInfo.hasNextPage ||
    links.nodes.some((pr) => pr === null || pr.state === "OPEN" || pr.state === "MERGED")
  )
    return null;

  const updated = Date.parse(value.updatedAt);
  if (!Number.isFinite(updated) || updated > checkedAt) return null;
  const match = describeResearchIssue(
    value.title,
    value.body,
    value.labels.nodes.flatMap((label) => label?.name.trim() || []),
  );
  if (!match) return null;
  const selected: DiscoveryIssue = {
    number: value.number,
    title: match.title,
    excerpt: excerptOf(match.body),
    checkedAt,
    evidence: match.evidence,
  };
  return { selected, updated, priority: match.priority };
}

export function describeResearchIssue(
  rawTitle: string,
  rawBody: string,
  labels: string[],
): { title: string; body: string; evidence: DiscoveryIssue["evidence"]; priority: number } | null {
  const title = rawTitle.trim();
  const description = rawBody.replace(/<!--[\s\S]*?-->/g, "").replaceAll("\r\n", "\n").trim();
  const prose = description.replace(fencedBlock, "").trim();
  const body = description.slice(0, 8000);
  if (
    title.length < 10 ||
    title.length > 500 ||
    body.length < 40 ||
    prose.length > MAX_PROSE_LENGTH ||
    (prose.match(checklistItem)?.length ?? 0) > MAX_CHECKLIST_ITEMS ||
    labels.some((label) => broadLabels.test(label)) ||
    /^(?:\[tracking\]|roadmap|rfc\b)/i.test(title)
  )
    return null;

  const focused =
    labels.some((label) => simpleLabels.test(label)) ||
    /\b(?:test|assertion|typo|docs?|documentation)\b/i.test(title);
  const hasFile = fileReference.test(`${title}\n${body}`);
  const reproduction =
    /\b(?:steps? to reproduce|minimal reproduction|reproducible example|reproducer|reproduce(?:s|d)? (?:by|with))\b/i.test(
      body,
    );
  const behavior =
    /\bexpected(?: behavior| result)?\b/i.test(body) &&
    /\b(?:actual|observed|instead)(?: behavior| result)?\b/i.test(body);
  if (!focused && !hasFile) return null;
  const evidence = reproduction ? "reproduction" : hasFile ? "file" : behavior ? "behavior" : null;
  if (!evidence) return null;
  return { title, body, evidence, priority: Number(focused) + Number(reproduction) };
}

export function parseIssueIndex(raw: unknown, repositories: IssueRepository[], checkedAt: number) {
  const { data } = graph.parse(raw);
  return repositories.map(({ id, owner, repo }, index) => {
    const alias = `r${index}`;
    if (!Object.hasOwn(data, alias)) throw new Error("Incomplete GitHub issue index");
    const row = data[alias];
    const slug = `${owner}/${repo}`.toLowerCase();
    // A slug may now refer to a different repository. Never attach its issues to
    // our candidate or let its metadata revoke a different stable identity.
    if (!row || String(row.databaseId) !== id || row.nameWithOwner.toLowerCase() !== slug)
      return { id, scope: slug, issues: [] };
    if (row.isPrivate || row.visibility !== "PUBLIC" || row.isArchived)
      return { id, scope: slug, issues: null };
    const issues = row.issues.nodes
      .flatMap((value) => {
        const result = value && candidate(value, checkedAt);
        return result ? [result] : [];
      })
      .sort(
        (a, b) =>
          b.priority - a.priority || b.updated - a.updated || a.selected.number - b.selected.number,
      )
      .slice(0, ISSUES_PER_PROJECT)
      .map(({ selected }) => selected);
    return { id, scope: slug, issues };
  });
}

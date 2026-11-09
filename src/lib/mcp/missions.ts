import { z } from "zod";
import { parseGithubRef, missionId } from "../kinds.ts";
import { worldProjects, parseCategoryId } from "../catalog.ts";

export const missionRef = z
  .string()
  .trim()
  .max(160)
  .refine((value) => !!parseGithubRef(value), "Expected owner/repo#number");
export type PublicMission = {
  missionId: string;
  owner: string;
  repo: string;
  number: number;
  isPr: boolean;
  title: string;
  body: string;
  url: string;
};
async function github(path: string, fetchImpl: typeof fetch) {
  // Deliberately anonymous: site credentials must never broaden public MCP reads.
  const response = await fetchImpl("https://api.github.com" + path, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "after-hours-mcp" },
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Public GitHub data is unavailable. Retry later.");
  return response.json();
}
export async function publicMission(
  raw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PublicMission> {
  const ref = parseGithubRef(raw);
  if (!ref) throw new Error("Invalid mission.");
  const root = "/repos/" + encodeURIComponent(ref.owner) + "/" + encodeURIComponent(ref.repo);
  const metadata = await github(root, fetchImpl);
  if (metadata.private !== false || (metadata.visibility && metadata.visibility !== "public"))
    throw new Error("Only explicitly public repositories are supported.");
  const item = await github(root + "/issues/" + ref.number, fetchImpl);
  // Reject transfers or inconsistent payloads rather than expose another repository's body.
  if (
    String(item.repository_url).toLowerCase() !== ("https://api.github.com" + root).toLowerCase() ||
    item.number !== ref.number ||
    typeof item.title !== "string"
  )
    throw new Error("Mission identity changed. Open the canonical GitHub URL.");
  return {
    missionId: missionId(ref.owner, ref.repo, ref.number),
    ...ref,
    isPr: !!item.pull_request,
    title: item.title,
    body: String(item.body ?? "").slice(0, 8000),
    url: `https://github.com/${ref.owner}/${ref.repo}/${item.pull_request ? "pull" : "issues"}/${ref.number}`,
  };
}
export const findInput = {
  category: z.enum(["web", "stars", "linux", "ai", "games", "data"]).optional(),
  language: z
    .string()
    .regex(/^[A-Za-z0-9#+.-]{1,30}$/)
    .optional(),
  limit: z.number().int().min(1).max(10).default(5),
};
export async function findMissions(
  input: { category?: string; language?: string; limit: number },
  fetchImpl: typeof fetch = fetch,
) {
  const repositories = input.category ? worldProjects(parseCategoryId(input.category)) : [];
  const query = [
    "is:public",
    "is:issue",
    "is:open",
    "archived:false",
    ...repositories.map((r) => `repo:${r.owner}/${r.repo}`),
    ...(input.language ? ["language:" + input.language] : []),
  ].join(" ");
  const result = await github(
    "/search/issues?per_page=" +
      input.limit +
      "&sort=updated&order=desc&q=" +
      encodeURIComponent(query),
    fetchImpl,
  );
  // Recheck every returned repository and canonical identity; search is not a visibility receipt.
  const settled = await Promise.allSettled(
    (result.items ?? [])
      .slice(0, input.limit)
      .map((item: { html_url: string }) => publicMission(item.html_url, fetchImpl)),
  );
  return settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

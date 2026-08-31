import type { Mission } from "@/lib/kinds";

export function defaultAgentPrompt(mission: Mission) {
  const kind = mission.isPr ? "pull request" : "issue";
  return `You are doing useful open-source work. Close or review this ${kind} with the smallest correct change.

Repo: ${mission.owner}/${mission.repo}
${kind} : ${mission.url}
Title: ${mission.title}

Body:
${mission.body.slice(0, 4000) || "(empty)"}

Rules:
- Follow the repo's contributing guide and existing code style.
- Do not refactor unrelated code.
- Add or update tests if the repo has a test suite that covers this area.
- If this is a review, write a precise review: bugs, missing tests, API risk — not nits.
- Summarize the change in the PR description.`;
}

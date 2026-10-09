export type AgentPromptMission = {
  owner: string;
  repo: string;
  url: string;
  title: string;
  body: string;
  isPr: boolean;
};

export function defaultAgentPrompt(mission: AgentPromptMission) {
  const kind = mission.isPr ? "pull request" : "issue";
  const task = mission.isPr
    ? "Study this pull request."
    : "Study this issue.";
  return `You are researching a public open-source ${kind}. ${task}
Do not implement a fix, open a pull request, post a comment, merge, or submit a review.

Repo: ${mission.owner}/${mission.repo}
${kind}: ${mission.url}
Title: ${mission.title}

Body:
${mission.body.slice(0, 4000) || "(empty)"}

Check whether the report is still current, read the discussion, CONTRIBUTING, and linked pull requests, look at the code, and see what it would take to reproduce the behavior.
Already fixed, cannot reproduce, and needs clarification are valid endings.

Write the report text in Russian. End with one json fence and nothing after it. Do not put token counts in that JSON.

\`\`\`json
{"schemaVersion":1,"findings":"...","work":"...","evidence":["..."],"unknowns":["..."],"nextSteps":["..."],"links":[{"url":"https://github.com/${mission.owner}/${mission.repo}","kind":"${kind}"}]}
\`\`\``;
}

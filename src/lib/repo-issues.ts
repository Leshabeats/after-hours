/** Where «К списку ишью» goes: that repository's issue list, never browser history. */
export function repoIssuesLink(owner: string, repo: string) {
  return {
    to: "/r/$owner/$repo" as const,
    params: { owner, repo },
  };
}

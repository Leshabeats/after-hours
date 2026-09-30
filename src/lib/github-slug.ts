const GITHUB_SLUG = /^[A-Za-z0-9_.-]{1,100}$/;

/** Owner and repo names that are safe to place in a GitHub search qualifier. */
export function githubSlug(value: string) {
  return GITHUB_SLUG.test(value) ? value : null;
}

export function repoSearchQualifier(owner: string, repo: string) {
  const safeOwner = githubSlug(owner);
  const safeRepo = githubSlug(repo);
  if (!safeOwner || !safeRepo) return null;
  return `repo:${safeOwner}/${safeRepo}`;
}

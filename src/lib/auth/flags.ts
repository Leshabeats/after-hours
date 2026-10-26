export function githubOAuthConfigured() {
  if (process.env.VERCEL_ENV === "preview") return false;
  return Boolean(process.env.GITHUB_CLIENT_ID?.trim() && process.env.GITHUB_CLIENT_SECRET?.trim());
}

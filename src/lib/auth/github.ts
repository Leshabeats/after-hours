import { randomBytes } from "node:crypto";
import { getRequestUrl } from "@tanstack/react-start/server";
import { githubOAuthConfigured } from "./flags";

export function oauthRedirectUri() {
  const configured = process.env.APP_ORIGIN?.replace(/\/$/, "");
  const origin = configured || getRequestUrl().origin;
  return `${origin}/api/auth/callback`;
}

export function githubAuthorizeUrl(state: string) {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  if (!clientId) throw new Error("GITHUB_CLIENT_ID is missing.");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", oauthRedirectUri());
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  return url.toString();
}

export function newOAuthState() {
  return randomBytes(32).toString("base64url");
}

export async function exchangeGithubCode(code: string) {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("GitHub OAuth is not configured.");
  }
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "after-hours-oss",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: oauthRedirectUri(),
    }),
  });
  if (!res.ok) throw new Error(`GitHub token ${res.status}`);
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!json.access_token) throw new Error(json.error || "GitHub token missing.");
  return json.access_token;
}

export async function fetchGithubUser(accessToken: string) {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "after-hours-oss",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`GitHub user ${res.status}`);
  const json = (await res.json()) as {
    id?: number;
    login?: string;
    name?: string | null;
    avatar_url?: string;
  };
  if (!json.id || !json.login) throw new Error("GitHub user is incomplete.");
  return {
    id: String(json.id),
    login: json.login,
    name: json.name ?? json.login,
    avatarUrl: json.avatar_url ?? "",
  };
}

export { githubOAuthConfigured };

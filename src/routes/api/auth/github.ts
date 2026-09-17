import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/github")({
  server: {
    handlers: {
      GET: async () => {
        const { githubOAuthConfigured } = await import("@/lib/auth/flags");
        if (!githubOAuthConfigured()) {
          return new Response("GitHub OAuth is not configured.", { status: 503 });
        }
        const { githubAuthorizeUrl, newOAuthState } = await import("@/lib/auth/github");
        const { oauthStateCookie } = await import("@/lib/auth/session");
        const state = newOAuthState();
        return new Response(null, {
          status: 302,
          headers: {
            Location: githubAuthorizeUrl(state),
            "Set-Cookie": oauthStateCookie(state),
          },
        });
      },
    },
  },
});

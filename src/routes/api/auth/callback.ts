import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getRequestUrl } = await import("@tanstack/react-start/server");
        const origin = process.env.APP_ORIGIN?.replace(/\/$/, "") || getRequestUrl().origin;
        const fail = () => Response.redirect(`${origin}/log?auth=error`, 302);
        try {
          const url = new URL(request.url);
          if (url.searchParams.get("error")) return fail();
          const code = url.searchParams.get("code");
          const state = url.searchParams.get("state");
          const {
            OAUTH_COOKIE,
            clearCookie,
            readOAuthStateFromRequest,
            sessionCookie,
          } = await import("@/lib/auth/session");
          const expected = readOAuthStateFromRequest(request);
          if (!code || !state || !expected || state !== expected) return fail();
          const { exchangeGithubCode, fetchGithubUser } = await import("@/lib/auth/github");
          const token = await exchangeGithubCode(code);
          const user = await fetchGithubUser(token);
          const { saveUser } = await import("@/lib/auth/db");
          saveUser(user);
          const headers = new Headers();
          headers.append("Location", `${origin}/log`);
          headers.append("Set-Cookie", sessionCookie(user));
          headers.append("Set-Cookie", clearCookie(OAUTH_COOKIE));
          return new Response(null, { status: 302, headers });
        } catch {
          return fail();
        }
      },
    },
  },
});

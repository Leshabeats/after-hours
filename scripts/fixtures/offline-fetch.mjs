// Loaded only by production-smoke.mjs. Exercise fallback without external services.
globalThis.fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin === "https://api.github.com") {
    if (url.pathname === "/repos/smoke/claude")
      return Response.json({ private: false, visibility: "public" });
    if (url.pathname === "/repos/smoke/claude/issues/9")
      return Response.json({
        number: 9,
        title: "Claude Code smoke issue",
        body: "Public fixture",
        repository_url: "https://api.github.com/repos/smoke/claude",
        html_url: "https://github.com/smoke/claude/issues/9",
        state: "open",
        comments: 0,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        labels: [],
      });
  }
  throw new Error("External fetch is disabled in the production smoke fixture.");
};

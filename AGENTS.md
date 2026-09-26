# After Hours

TanStack Start app. Product copy is Russian; mission kinds are After Hours track names.

- Catalog shows projects, issues live at `/r/$owner/$repo`. Worlds are Web, Stars, Linux, AI, Games, and Data. A language chip adds that language's ecosystem and its libraries. Inside a repo, issues and pull requests are separate recent slices, and an issue already fixed by a merged PR is omitted when that lookup succeeds.
- Journal: anonymous = `localStorage`. Signed-in GitHub user = SQLite in `data/`, scoped by GitHub user id. Never trust a client-sent user id. OAuth is GitHub only (`read:user`), session cookie, no Grok auth chrome. On first GitHub login, if the server journal is empty and the device journal has entries, `importDeviceJournal` copies them once (session user id only). If both journals have data, keep the server copy — do not auto-merge. `/log` shows night stats from journal entries via `summarizeJournal` — counts only. Signed-in `/log` also shows token spend from `usage_events` (local harness `POST /api/usage` / `reportUsage`; session user id only). After Hours does not run the agent, proxy model calls, or store GitHub tokens. Anonymous `/log` hides token totals.
- Backend is TanStack Start server functions + `/api/auth/*` in the same Node process. Not a separate Nest/Fastify app.
- "Взять эту ночь" and "Разобрать" open `codex://threads/new` in the visitor's browser. The server does not run Codex and does not use a site model key.
- Do not reintroduce Grok App Builder chrome (`.grok/`, `public/__grok/`, PWA injector, preview host bridge, auth/db scaffolding).

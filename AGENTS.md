# After Hours

TanStack Start app. Product copy is Russian; mission kinds are After Hours track names.

- Catalog: contribution targets, not every repo in a language. Criterion: GitHub repository stars `>= 1000` (`MIN_STARS`). First search top repos, then their issues. Never use issue-search `stars:` (that is reactions). Stars category is a curated household list. Web is first. Language is a second filter. Work type is After Hours `kind` tracks. Seed is Web/TS fallback only.
- Journal: anonymous = `localStorage`. Signed-in GitHub user = SQLite in `data/`, scoped by GitHub user id. Never trust a client-sent user id. OAuth is GitHub only (`read:user`), session cookie, no Grok auth chrome.
- Backend is TanStack Start server functions + `/api/auth/*` in the same Node process. Not a separate Nest/Fastify app.
- Briefing: `briefMission` in `src/lib/api.ts` calls xAI only when `XAI_API_KEY` is set. User-initiated, one request per click.
- Do not reintroduce Grok App Builder chrome (`.grok/`, `public/__grok/`, PWA injector, preview host bridge, auth/db scaffolding).

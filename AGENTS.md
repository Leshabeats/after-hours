# After Hours

TanStack Start app. Product copy is Russian; mission kinds are After Hours track names.

- Catalog: live GitHub search of the stack in `src/lib/github-live.ts`, seed fallback in `src/lib/seed.ts`.
- Journal: `localStorage` via zustand. No auth, no database.
- Briefing: `briefMission` in `src/lib/api.ts` calls xAI only when `XAI_API_KEY` is set. User-initiated, one request per click.
- Do not reintroduce Grok App Builder chrome (`.grok/`, `public/__grok/`, PWA injector, preview host bridge, auth/db scaffolding).

# GameDev discovery

`cat=games` keeps existing links, with the GameDev label and tags for engines,
tools, assets, emulation, Linux gaming, SteamOS/Deck, and Proton. Topic/description
rules are deterministic. Manual taxonomy/fork exceptions live in
`src/lib/discovery/ranking.ts`; they are reviewable source changes, not a model verdict.

Discovery is public-only. Every search includes `is:public`; parsing requires
`private: false` and, when present, `visibility: public`. Missing or contradictory
visibility fails closed. Only explicitly public observations and cards are eligible.
Private/unknown refreshes revoke eligibility without copying the response metadata
or adding metrics. Both stores filter publication and reads; a known revocation
also hides a prior completed card while the next run is incomplete. Legacy unmarked
records/cards stay hidden until public metadata is fetched again.

The daily feed is separate from the curated shelf and language libraries. No
minimum star count is applied to discovery. `createdAt` is GitHub's creation time;
`firstSeenAt` is when this catalog first observed the stable GitHub repository ID.
Known repositories and their release/PR samples are fetched through stable API
IDs, so reused old slugs cannot replace identity or supply unrelated activity.
Unavailable repository checks update exclusion state but preserve `countsObservedAt`; they insert no daily count metric. Renames
do not create a new repository. The growing badge requires 6–9 days of
actual observations (the displayed interval is exact to 0.1 days), at least ten
additional stars and 2% relative growth with a small-base floor, plus a recent
release or human merged PR from a bounded sample. No weekly history is fabricated
on bootstrap. Stars and activity can still be manipulated; this is a discovery
heuristic, not a trust certification. PR counts are a sample, not repository totals.

The collector queries ten topics for recently created and recently pushed
repositories, at most two pages per query. Overlapping 30-day windows handle late
indexing; incomplete API responses retain the checkpoint and prior publication.
Search results are capped and are not exhaustive GitHub indexing. Each of the
20 topic/window queries reserves 15 new IDs (300 total); overlapping or already
stored IDs consume no additional admission slots. These counters persist across
retries. Legacy version-1/2/3/4/5/6 checkpoints restart with the current admission and identity policy,
retaining stored observations and the last published snapshot. Search can update
already stored IDs within its existing page/request bounds. Up to 180 existing
repositories are additionally refreshed per scan. Eligible rows whose measurement
would exceed two days before the next daily run take priority over excluded rows;
oldest measurements rotate first. Eighteen of the same 180 slots are reserved
for excluded-row retries, oldest check first, so temporary 404/410/451 exclusions
can recover even while the eligible queue stays full. Unused retry slots return
to the main queue. Up to 40 repositories receive release/PR
samples. Rows with a real 6–9-day baseline take priority; within each group,
service age (last activity check, or first discovery for unchecked rows) rotates
oldest first. A constant influx of new rows cannot displace baseline-ready rows
or repeatedly reset their place in the activity queue. Explicit
fork exceptions also receive a metadata refresh. Archived, disabled, empty,
mirrored and ordinary fork repositories are omitted from published discovery.
Known independent forks may be allowlisted. Undeclared mirrors cannot reliably
be identified from repository metadata alone.

Per invocation: at most 500 HTTP requests, 40 search requests, 8 minutes; search
requests are paced at least 3.1 seconds apart and all calls at least 0.5 seconds.
GitHub rate limits and Retry-After take precedence. Transient failures persist a
retry time rather than sleeping through runner limits. Each successful task saves
its cursor and observations atomically, renewing a fenced lease. Expired writers
cannot save or publish. Run retries resume; scans interrupted for over 48 hours
restart their query windows. Partial scans never replace the last complete JSON
snapshot. A completed snapshot contains at most 100 cards: reserve the top 14
per populated tag, sharing slots for multi-tag repositories, then fill spare slots
by global relevance. Identity is deduplicated only by GitHub ID. Identity refresh
starts with the fresh ranked set. An old eligible record can be added only as a
fallback for a tag with no fresh representative, oldest measurement first; stale
growth scores never compete with fresh scores. Fresh candidates rank by their
actual measured growth. Identity validation updates public metadata and canonical
links while retaining authoritative stable-ID stars, forks and their original measurement time
for up to two days; it does not insert a synthetic metric or move that baseline.
Search and unmarked samples from any scan instead yield to the stable-ID sample. Count source
and scan UUID are stored with the sample, so later search/slug documents cannot
replace a stable-ID sample from the same scan. The UUID survives checkpoints and
changes on a new/restarted scan; equal timestamps do not determine provenance.
Daily metrics require an explicit actual-measurement marker and stable-ID repository
provenance in both stores. Search and slug-only counts are provisional: they never
insert or replace daily history, including across UTC midnight and resumed scans.
No time-range deletion is used; genuine stable-ID history from the same or previous
scans remains intact. Activity, identity-only validation and revocations never
manufacture samples. The rotating stable-ID metadata queue samples new counts. Expired identity tasks
remeasure, including after a pause. Multi-tag fallbacks share slots,
and fresh tag coverage is preserved within the same 100-candidate limit.

The version-7 checkpoint records successful public metadata validations obtained
through stable-ID requests. Search and slug-only responses never grant these
identity receipts, including for a later replacement winner. If a later search or
slug response overwrites metadata, any earlier identity receipt is invalidated.
Final ranking considers all eligible measurements within two days, using eleven
days of history to retain their 6–9-day baselines. Every selected card must have a
validation receipt before publication. Expiry, exclusion or changed tags can expose
new winners; those receive another bounded identity batch, keeping receipts only
for the complete current winner set (at most 100 IDs). These batches share the
same per-invocation request/time budgets and resume from their saved cursor.
A conflicting current URL retries the selected identities without publishing;
private/unknown visibility excludes immediately. Request/time budgets are unchanged.
Selected cards keep their relevance order; new engines cannot
crowd SteamOS/Proton out before filters run. Daily metrics retain
90 days; old completed runs are bounded. Repository identities remain for
first-discovery history and rotation. The UI marks published data older than 48
hours as delayed and falls back to the curated shelf if storage is unavailable.

## Local verification

`npm run catalog:sync -- --fixture path/to/repos.json` uses a GitHub-shaped JSON
array, an in-memory store and mock HTTP responses. It never opens a database or
requests GitHub. Without arguments, the command performs a read-only GitHub scan
into memory. Network requests do not execute repository code or download assets.

Tests use mock responses and the existing isolated local PostgreSQL 17 test helper.
They never load `.env.local` or use working database URLs. Migration 002 is additive;
001 remains byte-for-byte unchanged. HTTP requests never execute migration DDL.

## Activation (not performed by this PR)

1. Review and merge the stacked release dependency and this PR; production rollout
   remains an explicit decision. Scheduled Actions require the workflow on main.
2. Apply 002 through the versioned migrator to the approved database, after testing
   the upgrade in a separate development branch.
3. Create a dedicated database login restricted to SELECT/INSERT/UPDATE/DELETE on
   the four discovery tables. It must have no application-user/journal access,
   DDL rights or migration-owner privileges. Approve credential creation/transfer
   separately, then store its pooled URL as Actions secret CATALOG_DATABASE_URL.
   Do not reuse the application owner connection string.
4. Copy `docs/examples/catalog-discovery.yml` to `.github/workflows/` and run once
   manually after approval; verify run/snapshot counts and UI. Only then uncomment
   the daily schedule. Do not use pull_request_target or expose secrets to PR jobs.
5. Monitor the last successful snapshot age and GitHub run summaries. Public repo
   standard runners are free under current GitHub terms; no paid runner, API,
   artifact upload or plan upgrade is configured. If the repo becomes private,
   reassess included quotas before activation. Scheduled jobs may be delayed or
   disabled after 60 days of repository inactivity; manual dispatch remains available.

This is application ingestion, not a chat notification or digest automation.
The workflow template is deliberately outside the active workflow directory.

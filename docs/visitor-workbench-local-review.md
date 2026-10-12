# Visitor Workbench: Local Review

Status: implementation approved for release on 2026-10-11. Local preview and
automated checks are complete; production rollout is verified separately by
exact commit, service revision and authenticated browser checks.

## Review

Open `/admin/visitor-preview` on the local development server. This renders the
same `VisitorsWorkspace` component with clearly labeled synthetic events and an
in-memory alert API. No production reads or writes occur in this preview.
Production builds return 404 for this route. The actual `/admin/visitors` route
continues to require the existing verified administrator session.

## Phase 1

- Location opens Google Maps with city/region/country only. Coordinates, IP and
  session identifiers are never included. Unknown locations have no map action.
- City/country and device shortcuts apply existing server filters and reset paging.
- Referrer links filter records; a separate external button opens only the source
  origin, stripping paths, query strings and fragments.
- IP shortcuts use the existing keyword search; they are not an identity join.
  IP, event and session IDs, event time and received time have copy actions.
- Local/UTC display toggle; original event and server timestamps remain unchanged.
- Session drawer reads a fixed time window in pages of 25. Returned events are
  ordered within the displayed page, with progress, target and engagement fields
  when recorded. Time gaps are not labeled as dwell time.

## Phase 2

- Classification shows recorded provider/status/score/reasons and missing data.
  A non-bot flag is never represented as a verified human.
- On-demand session analysis uses the existing ADMIN-only
  `visitor.get_session_events` MCP tool. No new LLM provider or model calls.
  The drawer shows evidence, returned-page scope, observed paths and limitations.
- Record-to-alert prefill includes geography, event type, bot policy and source.
  Drafts start paused; preparation and explicit confirmation remain separate.
- Exact source rules add `filters.referrerDomain` through the BFF, MCP schema,
  alerts repository, evaluator, replay and frozen notification snapshot.
  Omission preserves the domain, empty string clears it, and comparisons are
  case-insensitive exact hostnames. Sources are not substring matched for alerts.
- Saved filter views are local to this browser/admin, capped at 12. Free-text
  queries, IPs and visitor identifiers are deliberately excluded from persistence.

## Boundaries

`POST /api/admin/visitor-session` verifies the existing server-derived ADMIN role,
hardcodes one read tool, bounds identifiers/window/page/result size, disallows
redirects, cancels abandoned reads, applies a deadline, and uses no-store headers.
Ordinary users and the public MCP endpoint gain no private visitor capability.

Frontend alert review carries nested filters; backend source evaluation queries
event facts because existing geographic rollups do not retain the source domain.
Source rules are evaluated together in a bounded window rather than one query
per rule. Rules without a source retain the existing rollup path.

## Verification

- Portfolio: 154 automated tests passed; 40 security tests passed.
- MCP server: 102 tests passed, including source schema and private visitor access.
- Analytics common/alerts: 55 tests passed, including H2-backed source matching,
  bot/geography/time boundaries, domain casing, durable preview/apply, source
  preservation and explicit clearing.
- All 19 real PostgreSQL tests passed in isolated GitHub CI run `38196543985`,
  with zero skips, including Flyway V11. The source regression covers count,
  batch evaluation, replay, notification evidence and replay deduplication.
  Local runs without `ALERT_TEST_JDBC_URL` still skip this database suite.
- Playwright: complete sample workflows at 1440, 390 and 320 pixels; screenshots
  in ignored `test-artifacts/visitor-workbench/`. Includes map URLs, copy, filters,
  saved views, timeline paging, analysis, classification and alert confirmation.
- Production build passed. A local production-mode server returned 404 for the
  sample route and 401/no-store for an unauthenticated private session request.
- Lint passed with existing repository warnings.

Browser test command (use an installed Playwright module):

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:visitor-browser
```

## Before Any Release

Owner approved the release on 2026-10-11. Keep these gates for future releases.

1. Run the real PostgreSQL suite against a disposable local database, including
   `V11__alert_rule_referrer_filter.sql`. Do not point destructive test fixtures
   at a shared or production database.
2. Verify the authenticated browser -> BFF -> real Admin MCP session read with an
   approved administrator session. Current browser E2E uses synthetic data.
3. Release the analytics source-filter support and its migration before releasing
   callers that send `filters.referrerDomain`; verify a paused rule round-trip.
4. Review source-query cost against the retained event volume and existing
   site/time indexes before enabling many source-specific rules.
5. Commit only the reviewed changes in Portfolio, portfolio-mcp-server and
   portfolio-analytics-platform. Preserve unrelated primary checkout changes.

The production schema review found RLS enabled on both `behavior_events` and
`alert_rules`, about 6,077 estimated event rows, and existing site/time and
site/event/time indexes. Source rules stay paused until explicitly enabled;
larger future traffic volumes need another query-plan review.

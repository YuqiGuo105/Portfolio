# Security Audit Follow-Up: 2026-10-08

This is a targeted remediation, not a complete security certification.
Source changes were prepared in isolated worktrees under
/private/tmp/portfolio-audit-20261008. The findings and test results below record
the pre-release review. On October 9, the owner authorized direct commits and
deployment with end-to-end verification. Release completion is recorded separately;
the pre-release results alone do not establish that application fixes are live.

## Production Database

With explicit owner approval, migration
`harden_verified_internal_table_access` enabled RLS and revoked all direct
table privileges from PUBLIC, anon and authenticated on 43 named internal
tables. The exact SQL is in
[applied-internal-tables-2026-10-08.sql](applied-internal-tables-2026-10-08.sql).
No data was deleted or updated; service_role privileges and ownership remain
unchanged. Preflight checked table existence, absence of policies and column
grants, and backend CRUD privileges.

Post-change checks:

- 43/43 tables have RLS enabled.
- 43/43 reject zero-row SELECTs as both anon and authenticated.
- 43/43 allow zero-row SELECTs as service_role and retain all CRUD grants.
- The authenticated Admin MCP agent_search_runs call succeeded through the
  deployed backend using an intentionally unmatched query; no chat data was read.

This verifies database access and one real backend read chain, not every
application workflow or a production write test. No test emails or data mutations
were sent to establish access.

## Remaining Database Review

The advisor still reports six RLS-disabled aggregate/search tables, four
owner-rights content views, public execution grants on three SECURITY DEFINER
functions, a publicly selectable materialized view, mutable function search
paths, and authentication configuration warnings. No broad public-content ACL
changes were made because the globe and other browser features use some of
these read contracts. The four function revocations in the older runbook have
not been applied by the table-only migration.

The 57 RLS-without-policy informational notices include intentional server-only
tables. Do not add permissive policies to silence these notices.

References:
[RLS checks](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public),
[view checks](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view),
[function exposure](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

## Incident Review

The previous direct grants were real, but do not prove that anyone used them.
Review admin account changes and retained authentication/database logs; assess
whether any stored secrets need rotation. The Supabase anon key is a public
client credential, not a service secret. RLS and grants must protect data even
when that public key is known.

## Source Remediation

Reviewed fresh origin/main snapshots in isolated worktrees so existing local
edits were not overwritten. Review continued into October 9, America/Denver.

| Repository | Base | Local changes |
| --- | --- | --- |
| Portfolio | 1264539 | CI security gate; safe environment example; opt-in confirmation and explicit unsubscribe pages/API proxy; legacy bootstrap privacy fixes; non-mutating, opt-in security probe |
| portfolio-ai-platform | cb7d54a | Explicit CI pipefail; Gemini keys in headers and sanitized provider errors; bounded content-list offset schema |
| portfolio-admin-service | 9c8848e | Canonical-path/default-deny auth; afterCommit worker updates use a new transaction; experience period in list DTO; release workflows run tests |
| portfolio-analytics-platform | 869c5b5 | Canonical-path/default-deny admin-token filter; correct current deployment documentation |
| portfolio-application-copilot | dbf0758 | Reviewed tab/document/origin checks before filling; extension tests in CI; credential durability documentation |
| portfolio-mcp-server | b4b1534 | HTML Mermaid extraction; Markdown conversion with GFM tables; bounded list tools; compact search; safe lookup errors; profile dates/order; Node 24/non-root container; patched dependencies |
| portfolio-notification-service | 37c747a | Double opt-in and single-use hashed confirmation tokens; unsubscribe-only email capability and RFC 8058 headers; PostgreSQL concurrency test service in CI |

### Ownership Verification

```text
Anonymous subscription request
  -> bounded pending request (no account/preference/token changes)
  -> email containing a 30-minute confirmation capability
  -> explicit confirmation POST
  -> atomic single-use consume + activation/token rotation
  -> browser stores management credentials
```

Repeated anonymous requests do not rotate an unexpired pending link. The
initial API returns HTTP 202 and no management credential. Confirmation pages
read tokens from fragments, remove them after router initialization, and do not
activate on GET. Notification emails have a separate unsubscribe-only capability;
the email-scanner GET path only opens a confirmation page, while the standard
one-click POST performs unsubscribe. A tampered unsubscribe token cannot change
preferences or unsubscribe an account. No production email was sent in this review.

`V9__subscription_confirmation.sql` is a new **unapplied** Flyway migration in
the notification-service worktree. The live subscription vulnerability is not
fixed merely by these unshipped source changes.

### MCP Response Compatibility

Public detail responses default to Markdown; `get_project` accepts an explicit
HTML format for the existing publication-workflow parser. The Portfolio
playground now requests that format. `list_projects` and `list_articles` use
bounded nested pagination. Gateway offset support and the admin-service period
field are companion changes, not independent deployments. Search diagnostics
are opt-in; normal results no longer repeat the same documents in groups.

## Corrections To The Submitted Audit

- The September assessment was historical. Current production `visitor_logs`
  already denied anonymous SELECT before this change; `behavior_events` also
  had existing protection. The other internal grants still needed hardening.
- An anon key is designed to be public. The defect is excessive grants/RLS,
  not disclosure of that key alone. The old hardcoded live-write probe was
  nevertheless replaced with an explicit-environment, zero-row read probe.
- The gateway checks its internal Bearer token before accepting forwarded
  roles. An unauthenticated `X-Role` header alone is not sufficient in the
  inspected default configuration. Shared-secret trust still has a large
  blast radius; this is not a claim that production IAM is correctly configured.
- Copilot already ran Java Maven tests. Its extension test suite was omitted
  from CI and has now been added.
- Admin-service CI already provisions PostgreSQL for knowledge tests. The new
  afterCommit regression uses real Spring/JPA transactions with H2, not a
  PostgreSQL/Kafka fault-injection test.
- Analytics isolates parse-invalid messages individually. Unexpected parsing
  exceptions or database-stage poison records still need batch-failure review;
  it is not accurate that every malformed JSON necessarily DLQs the whole batch.
- SECURITY DEFINER trigger-returning functions and ordinary maintenance RPCs
  are not equivalent: trigger-only functions cannot simply be called as normal
  RPCs. `rebuild_visitor_pin_cells()` is an ordinary public maintenance function
  and remains an actionable permission issue.
- No evidence establishes unauthorized use of the exposed tables. Incident
  review and key rotation must not be reported as already completed.

## Verification

| Check | Observed result |
| --- | --- |
| Production internal-table RLS/grants | 43/43 expected deny/allow checks; real authenticated Admin MCP read succeeds |
| Portfolio test suite | 136 passed |
| Portfolio security suite | 30 passed |
| Portfolio optimized production build | Passed with placeholder local-only backend configuration; existing lint warnings remain |
| Confirmation/unsubscribe browser flow | Chrome 1280, 390 and 320px passed; real browser and Next.js proxy against a fixture backend, not production SMTP/PostgreSQL |
| MCP suite | 101 passed, including HTTP and privacy contracts |
| MCP syntax/configuration/build | Passed; workspace bundle builds |
| Notification suite | 70 passed, 4 PostgreSQL tests skipped locally |
| Admin-service targeted tests | 26 passed, including afterCommit transaction and path regressions |
| Agent targeted tests | 6 passed, including provider credential/error handling |
| Gateway targeted contract tests | 2 passed |
| Analytics targeted auth tests | 11 passed |
| Copilot extension | All six existing test scripts pass, including added origin/navigation checks |

The PostgreSQL tests are configured to run against a disposable localhost-only
database in CI. There is no local PostgreSQL/Docker runtime available in this
environment, so they have **not** been verified here. CI itself has not run on
these uncommitted changes. A successful mock or H2 test is not a substitute.
No Docker image was built locally.

The MCP dependency check also found four advisory entries in existing
dependencies. SDK 1.31.0 and compatible fast-uri/ip-address/proxy-addr updates
clear this repository's current `npm audit` report. The SDK advisory concerns
OAuth clients, not every SDK-based server; no exploitation claim is made.
See the [SDK advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h)
and [proxy-addr advisory](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h).
This result says nothing about dependencies in the other repositories.

## Still Open

| Priority | Item | Status / next boundary |
| --- | --- | --- |
| P0 | Public `cv_comments.author_email` SELECT | Confirmed in production for anon/authenticated; local bootstrap tightened. Separate production approval requested; not applied. Public comment display already selects safe fields. |
| P0 | Public maintenance RPC execution | Confirmed `rebuild_visitor_pin_cells()` privilege; function revocations not included in approved 43-table migration. |
| P0 | Email-ownership fix rollout | Local only. Require PostgreSQL tests, staging SMTP delivery and safe multi-service rollout before calling the live bug fixed. |
| P0 | Gemini key rotation / historical exposure review | Header/error fixes local; production secrets and retained logs were not rotated/deleted. |
| P1 | Expired outbox/indexing lease retry budget and fencing | Claim SQL does not count repeated expired PROCESSING claims; requires a separate concurrency/failure patch. afterCommit persistence fix alone does not resolve this. |
| P1 | Analytics database-stage poison batch | Needs record isolation tests plus real database/Kafka recovery verification. |
| P1 | Retention and alert scheduling at scale-to-zero | Source deploy settings allow scale-to-zero and CPU throttling. External authenticated scheduling is not configured by this change. |
| P1 | Service IAM and shared-token blast radius | Runtime IAM bindings and per-service identity migration not changed. |
| P1 | Remaining database advisor findings | Aggregate/search tables, views, function search paths, auth settings remain under review; do not revoke browser contracts blindly. |
| P1 | Spring/Next major upgrades | Not performed as an incidental security patch; need compatibility, auth, SSR and deployment regression suites. |
| P1 | Copilot ATS password durability/key versions | Origin checks fixed locally; Valkey-only credential storage and unversioned encryption remain. No stored credentials were deleted. |
| P2 | Cross-service PostgreSQL + Kafka fault tests | Not added for all durable workflows; do not claim exactly-once delivery. |
| P2 | Dependabot/CodeQL | Not enabled. Decide scan scope and dependency-PR workflow separately; user prefers direct commits. |
| P2 | GitHub pins, descriptions, topics, licenses | Not changed. License choice and public-profile edits need owner decisions; do not silently assign a license. |
| P2 | Biography/project content and contribution lists | Dates are projected from actual fields; no new Goldman Sachs achievements, relocation, tags or PR claims were invented or published. |
| P2 | Category taxonomy/package branding | Entity noise/spacing cleaned in MCP responses; semantic taxonomy consolidation and package renaming not performed. |

## Release Gates

1. Review source diffs in the isolated worktrees. Nothing was committed, pushed
   or deployed as application code in this audit.
2. Pass the real PostgreSQL confirmation tests and a staging email round-trip;
   verify a previously unsubscribed address cannot be reactivated by an
   anonymous POST. Do not send unsolicited tests to real subscribers.
3. Deploy backward-compatible confirmation/unsubscribe web routes before the
   notification-service migration and changed subscription response. Verify
   actual mail delivery and both unsubscribe methods with an owner-controlled
   test address.
4. Deploy admin DTO and gateway catalog updates before the new public MCP lists;
   smoke-test public privacy, admin auth, pagination and the publication demo.
5. Rotate the Gemini secret with a coordinated production rollout and inspect
   historical exposure. Resolve separate production ACL requests explicitly.
6. Re-run security advisors and read-only backend checks; treat new failures as
   failures, not empty data. Do not run the legacy full bootstrap on production.

Implementation references:
[Spring afterCommit contract](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/support/TransactionSynchronization.html#afterCommit()),
[Chrome document-targeted scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting),
[Turndown GFM conversion](https://github.com/mixmark-io/turndown-plugin-gfm).

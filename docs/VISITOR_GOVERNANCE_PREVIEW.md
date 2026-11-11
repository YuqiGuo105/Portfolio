# Visitor governance

Release scope: authenticated Visitors governance, minimized evidence receipts,
and access/change audit. Public tracking frequency, existing raw-log retention,
identity providers and cloud billing settings are unchanged.

## Preview

```sh
node scripts/dev-visitor-governance.mjs
```

Open `http://127.0.0.1:3143/admin/visitor-preview#visitor-governance` and expand
**Visitor record protection**. This loopback-only server serves the synthetic preview
and static assets, and blocks every API and public-page route. The preview uses
18 sample receipts in memory, not production records. Reload resets the sample.

- Archive pending sample receipts, verify a batch and download its JSON package.
- Place, renew or release a 90-day batch hold with a bounded reason and explicit
  confirmation; the expiry date is visible on the batch.
- Check a downloaded package locally; file contents are never uploaded.
- See the resulting sample access/change audit. Third-party timestamp remains
  `not connected`; preview storage is explicitly `in memory`.

### Reading the panel

- **Archived / Waiting to archive / Total received** count event evidence records,
  not unique visitors. Preserved records are a subset of archived records.
- The status strip separates maintenance health from recent archive checks.
  Pending records are not an error; unchecked archives are not reported as verified.
  Failed checks and maintenance issues stay visible outside collapsed details.
- **Saved archives** shows each batch, its record count and its latest check in
  the returned audit window. IDs, fingerprints and cleanup eligibility are folded
  into each row's **Archive details**.
- **Retention & protection settings** and **Admin activity log** start collapsed.
  Check results also distinguish file integrity from comparison with live sources.
- This local UI revision adds no polling or API calls. Status reflects the loaded
  snapshot and the bounded recent audit window, not continuous monitoring.

## Existing controls and gaps

The analytics backend already separates raw sensitive facts from canonical
behavior records, deduplicates event IDs, persists them transactionally, and has
bounded retention jobs. The inspected Visitors proxies require a verified
Supabase session and a server-managed ADMIN role.

The missing controls were durable integrity receipts, verifiable archive exports,
preservation holds, and attributable admin reads/exports. Existing raw CSV/JSON
exports include sensitive identifiers; they are still restricted to admins and
are not the new minimized evidence packages. Existing intelligence aggregates are
not evidence for an exact filtered event window.

## Data path

```text
Existing browser events (unchanged sampling and network traffic)
    -> existing track/click endpoints, exact origin validation
    -> Kafka -> existing canonical-event transaction
       -> minimized evidence receipt (one extra SQL statement per batch)
    -> bounded archive worker / admin archive command
       -> exact-byte SHA-256 manifest + receipt hashes
       -> private audit + retention / batch holds

Admin session -> verified actor UUID -> private analytics API
    -> audit before read/export -> no-store response -> Visitors panel
```

Backend changes live in the separate local analytics worktree
`portfolio-analytics-governance-preview`; see its `docs/visitor-governance.md` for
the migration, endpoint contracts and PostgreSQL tests. The real feature is
disabled by default and requires explicit production enablement.
The UI preview is an injected synthetic adapter, not a
production-auth bypass or a claim that the backend has been deployed.

## Performance and cost

- No new public JavaScript, tracking event, browser timer, provider call or cloud
  service. The existing tracking origin check is tightened without extra events.
- Governance data loads only when its admin disclosure is opened; no polling.
- Each archive is bounded to 100 receipts by default, 500 maximum; recent lists
  are capped at 20. File verification accepts at most 4 MB and 500 receipts.
- The enabled backend adds an indexed receipt append in the ingestion transaction
  and an audit insert for protected reads. These have real database/storage cost;
  no zero-overhead or fixed billing guarantee is claimed.
- Production maintenance reuses the existing Cloud Scheduler recovery endpoint,
  with a database-enforced hourly throttle and bounded transactions. It does not
  require a new scheduler or a continuously running service. The panel exposes
  the most recent maintenance result; an eligible date alone is not proof of deletion.

## Retention and release controls

| Data | Retention |
| --- | --- |
| Minimized receipt/archive payload | 90 days, unless an active batch hold applies |
| Audit entries | 180 days from the recorded action |
| Expired receipt/batch metadata | 180 days after actual payload expiry |
| Preservation hold | 90 days per explicit approval; renewal and release audited |

These policies cover only the new governance tables. Original IP, visitor records,
Kafka and backups keep their existing policies. Cleanup is bounded and may need
subsequent maintenance runs to clear a backlog. Holds are operational preservation,
not a court order or legal certification.

The Vercel production proxy requires `ANALYTICS_API_URL` and uses the existing
internal service credential. Browser requests require verified ADMIN access;
actor identifiers cannot be supplied by callers. Responses are `no-store`.
The backend feature flag is `ANALYTICS_GOVERNANCE_ENABLED`; disabling it stops
capture and maintenance without deleting existing evidence. Do not drop tables
or revert an applied migration to roll back the application.

## Evidence boundaries

Hashes detect changes relative to the stored receipt/manifest. They do not prove
who visited, that a browser-reported action happened, or that every visit was
captured. A database owner able to rewrite both content and hashes can defeat
local-only integrity checks. No independent timestamp, signing authority, WORM
storage or legal certification is claimed or enabled.

Holds affect only the evidence batch, not raw logs, other databases, Kafka or
backups. Historical records are not retrospectively certified. Audit modification
is denied; only time-eligible, bounded retention purge is supported. Hash/counter
tombstones have the finite retention policy above, not indefinite storage.

## Checks

```sh
npm test
npm run test:visitor-governance
```

Tests cover unauthorized/no-fetch paths, forged actor headers, fixed API targets,
bounded IDs/reasons/files, exact-byte verification, altered packages, hold review,
lazy loading/cancellation, and synthetic lifecycle. Browser checks cover desktop,
390px and 320px layouts, archive/verify/hold/release interactions. Backend database
verification is documented independently; a UI fixture is not database evidence.

Release verification on 2026-11-10: 334 frontend tests, 12 focused governance tests
and 41 security tests passed. Production build passed with existing lint warnings.
The built homepage, shared app, blog and project bundles contain no governance
module. Backend database and maintenance verification is recorded in its release
documentation separately.

A synthetic package exported by the real PostgreSQL-backed service was checked
independently with this frontend's verifier and the browser's **Check file** flow.
Both accepted the original; the Node check rejected altered manifest bytes.
This verifies cross-runtime compatibility, not production ingestion or an
independent certification. Deployment must additionally verify the live revision,
private schema permissions, administrator flow and maintenance checkpoint.

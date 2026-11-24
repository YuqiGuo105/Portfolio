# Media and activity analytics (local implementation)

## Scope

Existing media players and cover previews emit bounded behavior events through
the existing `/api/track` -> Kafka -> transactional consumer inbox -> visitor
logs pipeline. The existing durable fallback outbox is unchanged. No new
server, vendor SDK, database migration, paid model call or scheduled job is
required. Production has not been deployed for this change.

`/admin/visitors` gains a collapsed Activity & media section using its existing
authenticated raw visitor endpoint. Opening or manually refreshing requests at
most 100 recent filtered records. Grouping, bot thresholds and tab switches
are computed over that snapshot without requests or writes. These numbers are
a recent sample, not full-period totals or conversion rates.

`/admin/activity-preview` is development-only and uses synthetic in-memory
records. Its actual local video adds test telemetry only to that memory.

## Counting and risk boundaries

- Stable event IDs deduplicate delivery retries in the existing backend inbox.
- Optional same-IP groups use anchored 5/15/30-minute windows and retain each
  session and event. A shared network is not a person and is not evidence of bot
  traffic. This is a display option, never record deletion or UV deduplication.
- Saved bot classifications and existing diagnostic rule candidates are shown
  separately. Filters and thresholds do not rewrite stored classifications,
  block access or alter public statistics. Missing assessments remain unknown.
- Video impressions need at least 50% visibility for one second. The same
  page/media/placement is suppressed for five minutes in the mounted app.
- Previews are distinct from deliberate playback. Cover starts distinguish
  viewport dwell, mouse hover and explicit button presses. Actual watched ranges are
  observed using native video events, not seeking position. A 95% observed
  coverage requirement prevents seeking to the end from counting as completion.
- Summaries are cumulative per playback ID. The admin projection takes their
  maximum, not their sum; different asset versions stay separate. Partial
  playback records without a start in the sample are identified explicitly.
- New widget opens cover chat, search, share and monitoring service details;
  monitoring expansion/collapse is also recorded. Share actions cover successful
  link copy and image/QR download requests. Existing chat/search events also
  appear. A download request does not prove a completed download.
- Only identifiers, bounded metrics and action names are retained. No transcript,
  captions, microphone contents or signed storage URLs are added. Existing
  consent, private-route exclusion and retention policies remain in force.

## Cost and performance

Checked official pricing on 2026-11-23; account-specific usage was not inspected:

- [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/plans/):
  free plan includes unlimited challenges. Existing form protection is retained;
  contact verification tokens are not reused for analytics.
- [Google reCAPTCHA](https://docs.cloud.google.com/recaptcha/docs/billing-information):
  10,000 assessments/month free across an organization; with billing enabled,
  the 10,001-100,000 tier is $8. New media/widget telemetry never executes or
  assesses CAPTCHA. Existing page-event assessment behavior is unchanged.

The new events add no per-event bot-provider fee, but existing Kafka, database,
Valkey and hosting capacity is not guaranteed free. Real incremental cost depends
on the account plans and traffic; no quotas, billing or budgets were changed.
As an illustration, one uninterrupted 60-second view produces about 12 events
(impression, request, start, four checkpoints, four summaries, completion), rather
than 60 per-second writes. User actions and errors add a shared cap of 12 per play.

Safeguards: native video events (no animation-frame analytics loop), visibility
checks, 15-second watch summaries, a separate 30 requests/IP/minute media/widget
bucket using the existing Valkey limiter, and the existing bounded delivery
queue (32 records / 32 KiB / six-hour TTL). Page-event limits remain separate.
All mounted players share one exposure observer and one set of visibility/pagehide
listeners. The 100-cover test creates no idle timers or layout reads; only visible
covers schedule a one-second exposure check. Unmounting the last cover removes the
observer and listeners. The Visitors section performs no polling.
Long outages and browser shutdown can still lose telemetry; retries are not a
claim of perfect end-to-end delivery.

The aggregator stores new media/widget events for the admin record view but skips
legacy geo rollup expansion. It does not inflate existing page-view/public totals.
Deploy the paired aggregator changes before enabling production media events.

## Local verification

- Unit and API tests cover event IDs, retries, privacy, sanitization, no paid
  assessment, actual watch ranges, replay, partial samples and view-only grouping.
- Component tests cover lazy fetching, threshold/filter counts and aborted reads.
- Aggregator tests cover property preservation, inbox deduplication and rollup
  exclusion. Real production Kafka/Valkey/DB were not invoked in this task.
- In-app browser: actual 10-second playback recorded one completed view; replay
  followed by a seek to the end increased starts but not completions.
- In-app browser: explicit cover preview emitted preview events separately;
  raising the diagnostic threshold from 50 to 79 changed three candidates to
  zero without removing the one saved bot session. Same-IP grouping preserved
  the 27 distinct synthetic records. At 390px and 320px there was no page-level
  horizontal overflow; wide click tables scroll inside their own region.
- Existing frontend suite: 606 passed. Media/activity/ingest tests: 82 passed
  (some overlap with the existing suite; do not add these counts together).
- Production build passed. Lint had warnings, not errors; Google font stylesheet
  optimization was skipped when the build environment could not fetch it.
- Aggregator suite: 201 tests, 168 passed and 33 skipped. Docker/Testcontainers
  is unavailable here, so real database/Kafka integration remains unverified.

Run locally from `Portfolio-behavior-continue`:

```sh
npm test
node --test tests/media-*.test.mjs tests/visitor-activity*.test.mjs tests/analytics-media-ingest.test.mjs
npm run build
npm run dev -- -H 127.0.0.1 -p 3165
```

Open `http://127.0.0.1:3165/admin/activity-preview`. For the paired analytics
worktree, run `mvn -B -ntp -pl analytics-aggregator-service -am test`.
The development preview returns 404 in production; the real panel remains
inside the existing authenticated Visitors page.

No commit, push, deployment or production visitor-data mutation is included.

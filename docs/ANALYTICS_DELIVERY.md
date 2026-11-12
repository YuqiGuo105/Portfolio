# Visitor event delivery

## What the percentage means

`read_progress` is the highest measured scroll offset divided by the scrollable
document distance, rounded down to 25/50/75/100. It is not proof of reading or
identity. Opening a project, clicking a link, or staying on a page does not imply
25% progress. Missing historical checkpoints must not be backfilled by inference.

The scroll listener is passive, tracks only the peak offset, and reads document
geometry at most once per second while scrolling. It emits at most four progress
events per page tracker. A fast jump can emit only 75% or 100%. Public route exits
flush before Next.js changes the old URL/DOM; private routes remain excluded.

## Delivery contract

1. The browser assigns `eventId` once, with the original event time, page, anonymous
   identifier and session. The bounded per-tab queue is saved before sending.
2. A matching `{ok: true, eventId}` acknowledgement removes that event. Network
   errors, missing acknowledgements, HTTP 408/429 and 5xx retain the same payload
   for backoff retry. `Retry-After` is honored. Other 4xx and intentional privacy
   exclusion (204) are terminal and not retried.
3. `/api/track` derives a stable server key from site, original browser/session
   identifiers and client event ID. New IP addresses and receipt times do not
   create a different deduplication key. Old clients without IDs remain accepted.
4. The primary path awaits Kafka with `acks: -1`. If Kafka is unavailable, the
   complete validated RawEvent is inserted into `analytics_event_outbox` using
   `ON CONFLICT(event_id) DO NOTHING`. The API returns 202 only after persistence.
   If both destinations fail, it returns 503, never a false success.
5. The existing relay publishes that outbox event with the same ID. The aggregator
   claims its inbox key and updates raw facts, serving facts, evidence receipts,
   sessions and rollups in one transaction; Kafka acknowledgement follows commit.
   The inbox also checks the canonical `behavior_events` primary key to prevent
   late replay from double-counting after inbox retention has elapsed.
6. Admin aggregation remains server-side, grouped by site/session/page, not IP.
   A durable ingestion ACK is not a promise that the asynchronous UI projection
   is already updated. Outbox recovery and Kafka consumer lag can delay display.

## Performance and privacy bounds

- No heartbeat polling or extra successful-path database write in `/api/track`.
- At most three concurrent browser deliveries, 32 queued events, approximately
  32 KiB serialized queue, and a six-hour retry lifetime. Old pending events are
  evicted when the cap is reached; in-flight events are not evicted for capacity.
- Empty queues have no retry timer. Offline/hidden tabs pause retries. Online,
  pageshow and visible-tab events resume due work; reload restores same-tab work.
- Optional analytics reCAPTCHA scoring is requested only on the first attempt;
  leaving a page does not wait for it. Missing scores are not a claim of humanity.
  Contact-form Turnstile protection is separate and unchanged.
- No CAPTCHA token, IP address, query token or authenticated credential is saved
  in the browser queue. Consent denial clears pending work. Private routes cannot
  enqueue or initiate retries. Local preview remains excluded from real analytics.
- The durable fallback uses the existing restricted service-role outbox and its
  existing relay/retention controls; no new infrastructure or public data grants.

This is bounded at-least-once retry plus idempotent processing, not a claim of
zero browser-side loss. Blocked scripts/storage, a closed tab, queue expiration,
capacity limits or an event never measured can still prevent collection. A
duplicate arriving after both inbox and canonical facts have been purged is also
outside the retained deduplication window.

## Regression coverage

Frontend: `node --test tests/analytics-*.test.mjs`, plus the existing full suite.
Coverage includes lost ACKs, offline delivery, reload, pending CAPTCHA at exit,
Retry-After, privacy withdrawal, queue bounds, original timestamps and full outbox
payloads. A project open without scrolling must not generate a progress event.

Backend: `BehaviorEventAccessPostgresTest` exercises real PostgreSQL migrations,
duplicate offsets/IDs, inbox cleanup, rollback/recovery, evidence deduplication,
outbox conflict behavior and the admin grouped-query result. It requires an
isolated loopback `analytics_test` database and refuses other database URLs.

The backend guard can be released first, followed by the atomic frontend/API
release. No data backfill or schema migration is needed for this change. Local
tests do not constitute production deployment or a live Kafka outage test.

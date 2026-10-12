# Lightweight Visitor Scroll Depth

The visitor record and session timelines show existing `progressPercent` values
as **Scroll depth / About 75%**, rather than treating elapsed wall-clock time as
engagement. This is a page-scroll checkpoint, not evidence that text was read.

## Collection Budget

- Reuses schema v2 `read_progress` and `properties.progressPercent`, the current
  ingestion endpoint, privacy exclusions, and bot assessment. No new dependency,
  database migration, query, background service, or administrator polling.
- A passive scroll listener only updates a numeric maximum and schedules one
  pending timer. Document height is read outside the scroll handler, at most once
  per second during scrolling. There is no startup geometry scan or idle polling.
- Reports only newly reached 25/50/75/100 checkpoints. A jump directly to 100%
  sends one checkpoint, not four. Repeated/backward scrolling never resends one.
  After 100%, the scroll listener is removed until the next page tracker starts.
- A pending checkpoint may be flushed once when hidden, on pagehide or cleanup.
  These lifecycle signals share the pending timer and cannot duplicate a sample. Private-route
  navigation discards pending work. A changed URL cannot attribute the new page's
  geometry to the old page. Hidden-tab timer callbacks do not measure geometry.
- The page tracker no longer sends `engaged_time`. Old duration data and ingestion
  compatibility remain; existing downstream duration-based metrics/signals will
  only have historical data from this client. No intent-scoring policy is changed.

## Approximation and Compatibility

- Uses maximum sampled scroll offset divided by current scrollable page height.
  Browser resizing, lazy-loaded content, rapid navigation and interrupted delivery
  can affect the estimate. Accuracy is deliberately secondary to responsiveness.
  A one-pixel bottom tolerance accommodates fractional browser scroll offsets.
- No initial 0% or automatic 100% is inferred for a short/non-scrollable page.
  Missing, invalid or out-of-range values display as unrecorded, not as zero.
- The UI reads the existing property or the projected journey's top-level field;
  it does not fetch or join extra records to invent a page-view percentage.
- Historical duration-only records remain visible as legacy events without
  translating seconds into percentages or deleting source records.

## Local Verification

- `npm test`: includes 9 tracker regression tests and 2 new UI
  tests. A 10,000-event scroll burst schedules one timer and zero immediate
  document-height reads, then one deferred read and one checkpoint request.
- `npm run test:security`: 40 passing tests. Lint passes with existing warnings.
- An isolated production build passed without interrupting the 3111 preview.
- `tests/visitor-scroll-depth.browser.mjs`: actual browser scroll geometry with
  intercepted local ingestion verifies all four checkpoints, fast-bottom coalescing
  and no duration events. No production ingestion occurs.
- The same browser suite verifies the real preview UI at 1440/390/320px: percentages,
  proportional bars, session timeline, no overflow and no external data requests.
- Browser testing uses sample data and an isolated tracker fixture, not a measured
  production Core Web Vitals experiment or a production delivery guarantee.

Local review: `http://127.0.0.1:3111/admin/visitor-preview`.

## Performance Check

An isolated Chrome benchmark compared the previous collector with the throttled
collector before the final lifecycle/tolerance fixes. Three repeats of an
eight-second scroll at 390px width reduced document/body height getter calls
from 481 to 16 (eight samples). Median combined scroll/sample callback time was
20.9ms versus 10.7ms; with 4x CPU throttling, 24.1ms versus 13.7ms. Both were idle
without scrolling. Instrumentation adds overhead; reCAPTCHA, network, other app
scripts and total rendering cost were excluded. These are not mobile-device or
production Core Web Vitals measurements.

# Visitor bot diagnostics: read-only preview

Release scope: authenticated Visitors diagnostic preview only. No collector,
classifier, Kafka, database, archive, public marker or public statistics changes.
The local preview remains synthetic and development-only.

## Preview

Run `node scripts/dev-visitor-governance.mjs` from this worktree, then open:
`http://127.0.0.1:3143/admin/visitor-preview#visitor-bot-diagnostics`.
The preview server binds to loopback and rejects API/public-page routes.
All preview visitors are synthetic; IP addresses are documentation ranges.
No production visitor data was copied into fixtures.

The reusable panel is also wired into the existing authenticated Visitors
workspace. It uses the existing read-only list API, without changing its
authorization, request schema or backend. The production entry point is
`/admin/visitors#visitor-bot-diagnostics`; it requires the existing administrator
session. Production deployment and real-record checks are separate release
verification steps, not implied by the local checks below.

## Behavior

- Opens on demand; loads at most 100 raw events from the current filter/window.
- No polling, automatic pagination, provider API, writes or saved thresholds.
- Adjusting thresholds reclassifies the in-memory sample without another request.
- Defaults: suspected 50, high likelihood 80. The controls cannot cross.
- Scores are diagnostic rule weights, not calibrated probabilities or identity proof.
- Behavior-only candidates require two distinct signals, even at threshold 1.
- Session candidates propagate only across events present in this sample.
- Existing saved bot flags remain separate and are never removed or overwritten.
- Counts show existing bot events, additional candidate events and their union.
- Changes relative to default thresholds use the same sample, not a moving window.
- Missing samples, errors and incomplete coverage are not presented as clean traffic.

## Rules

| Signal | Points | Evidence |
| --- | --- | --- |
| Concurrent sessions | 35 | 3 sessions, same site/IP/path, server receipt within 1s |
| Repeated navigation | 25 | 3 sessions, same site/IP and first two distinct sampled pages within 10m |
| Rapid reading checkpoints | 30 | Page view, intermediate progress and 100% within 3s; reject contradictory server timing |
| Explicit automation UA | 90 | Small explicit product pattern; header remains spoofable |
| Valid recorded CAPTCHA | 50-100 | Existing server provider assessment; risk = 100 - human score, verified bot = 100 |

Final score is the larger of direct evidence and the summed behavior weights,
capped at 100. Missing CAPTCHA, no referrer, location or hosting hints add no
points. Only event IDs are deduplicated, scoped by site. Missing IDs are shown
as a coverage limitation. Missing session IDs are never joined together.

Filtering or loading only 100 events can omit relevant session context; shared
IPs, synchronized delivery and fast scrolling can be legitimate. No operator
or malicious intent is inferred. A non-candidate is not a verified human.

## Verification (2026-11-20)

- 18 focused logic/UI tests passed, including cancellation, stale response,
  error, malformed response, threshold, deduplication and false-positive guards.
- 581 full-suite tests passed with file concurrency 1. A parallel run while
  building hit an existing asynchronous file-verification UI timing assertion;
  the isolated visitor suite and complete serial run passed without changing it.
- `npm run build` passed; existing image/lint and unavailable external font
  optimization warnings remain.
- Chrome desktop 1280px and mobile 390px/320px verified, no panel overflow or
  console errors. Existing unconfigured Supabase/font warnings in the synthetic
  preview remain; no credentials are needed.
- Default synthetic sample: 8 saved bot events, 18 additional candidates.
  Raising the suspected threshold to 70 reduces additional candidates to 12;
  saved flags stay at 8. Raising high likelihood to 95 reclassifies the
  90-point sessions as suspected. Reset restores 50/80.
- Single fast-reading sample stays unflagged, including at the lowest threshold.
- The existing governance preview retains its original fixture set, so adding
  diagnostic scenarios does not change archive fixture contents.

No block, delete, apply or paid-model action is part of this feature. Real-record
verification must compare thresholds against one fixed sample and confirm that
saved bot counts remain unchanged. Never copy private visitor records into this
document or the synthetic fixtures.

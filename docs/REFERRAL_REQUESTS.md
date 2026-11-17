# Talk page and referral requests

`/talk` is the one place to reach Yuqi: send a message, ask for a referral, or open a live chat on
TalkNest. The home page's Contact section keeps Message and Live chat as two compact tabs;
an independent Request a referral link opens `/talk?intent=referral`.

| Choice | What happens |
|---|---|
| Send a message | The existing guarded contact form (`src/lib/contactGuard.mjs`): Turnstile, honeypot, rate limit, shared moderation, email. |
| Ask for a referral | A four-step form: the role, about you, a third-person introduction, review. |
| Chat or call live | Explains TalkNest and links to it with `?connect=Yuqi%20Guo`, so TalkNest opens that conversation after sign-in. |

## What a referral request contains

Role title, posting link, optional job ID, location and pasted requirements; name, email, optional
profile link, current title and years of experience; how the applicant knows Yuqi; a résumé PDF
(2 MB at most); an introduction of the applicant **in third person** (200 to 1,500 characters);
optionally why they want the role.

The introduction is third person because a referral form asks the referrer to describe the
candidate. **The applicant writes it, or pastes one they already have. No model writes or rewrites
it**, and the owner receives it character for character. The form explains the convention, offers a
fill-in template, and checks the wording with plain rules (`src/lib/referral/fields.mjs`): a
first-person paragraph or an unfilled template is refused in the browser and again on the server.

## Built for load

The page is static HTML served from the CDN and calls no API when it opens. Everything slow is
kept off the request path.

```
browser ── POST /api/referral ──────────▶ validate · rate limit · verify · 1 insert · signed upload URL
browser ── PUT (résumé) ────────────────▶ private storage bucket          (never through a function)
browser ── POST /api/referral/complete ─▶ confirm the object exists · queue · kick the worker
                                             │
worker (kick · scheduler · review page) ◀────┘ claim batch with lease → check file → screen → save
                                               → one digest email → retention
```

- **Accepting is O(1).** `POST /api/referral` takes a few kilobytes of JSON and does one insert. No
  model call and no email happen there, so its latency does not depend on anything slow.
- **The résumé goes straight to storage** through a one-file signed upload URL. The bucket itself
  enforces PDF and 2 MB. A serverless function never holds the file in a request body.
- **Idempotent end to end.** The form generates one UUID per request. Sending it again, from a
  double click, a retry after a dropped connection or a reload, returns the same request and a
  fresh upload link instead of creating another; it is not verified a second time because its
  one-time token is already spent. `complete` and the upload are repeatable too.
- **The table is the queue.** `claim_referral_screenings` takes a batch with
  `FOR UPDATE SKIP LOCKED` and a lease, so any number of workers can overlap without screening a
  request twice. A worker that dies leaves its claims to expire. A failed request backs off
  (1, 2, 3, 4 minutes) and after five attempts is delivered with a plain note rather than retried
  forever. Partial indexes keep claiming fast however large the table grows.
- **Bounded fan-out.** Submissions start at most one worker run every ten seconds. Each run screens
  a few requests at a time, and after the queue empties it keeps checking for twelve seconds, which
  is longer than the gap between runs: a request that arrives while starts are being held back is
  always picked up by a run that is still alive. The backlog waits in the queue, which costs nothing.
- **Bounded spend.** AI screening is capped by the shared monthly ledger and by a daily allowance
  (`REFERRAL_AI_DAILY_LIMIT`, 40). Past either, requests still arrive, with a completeness note.
- **Bounded email.** Notifications are digests: one email covers every request that became ready,
  at most six an hour (`REFERRAL_DIGESTS_PER_HOUR`). Up to three requests are shown in full; more
  become a list that links to the review page. No attachments.
- **Abuse limits.** Six submissions an hour per network, checked before verification; a site-wide
  flood valve of 5,000 a day, counted only after verification so unverified traffic cannot use it
  up. Both are atomic counters in Valkey shared by every instance.

`tests/referral-handler.test.mjs` and `tests/referral-worker.test.mjs` exercise this: 200
simultaneous copies of one request create one row, 1,000 different requests are all accepted, six
overlapping workers screen 60 requests exactly once each, a request that arrives just after the
queue empties is still picked up, and a busy hour produces a handful of digests. `node scripts/referral-load.mjs` measures the accept path against a running preview.

## Which company the form is for

Nothing in the code or the configuration names an employer. The form is for the **current employer
in the work history**: the row of the `experience` table whose period ends in "Current" or
"Present" (`src/lib/currentRole.mjs`). `docs/CHANGING_JOBS.md` describes what follows it.

- `/talk` and the home page stay static. The company is read when a page is generated; pages are
  regenerated every five minutes, and at once when a job change is recorded on `/admin/experience`
  or the switch on `/admin/referrals` is used.
- The server decides the company again when a request arrives and stores it on the request
  (`company`). The form says which company it was showing; if that is no longer the current one
  (a tab left open across a job change), the request is refused before verification is spent and
  the applicant is asked to reload. A request that was already accepted keeps its company.
- Requests for an earlier employer stay in the review list, marked "a previous employer". Their
  AI note and email keep naming the company they were written for.
- The form is closed, with a "send me a message instead" panel, when the work history has no
  current role, when the owner pauses it on `/admin/referrals`, or with `REFERRALS_PAUSED=1`. If
  the work history cannot be read and no earlier answer is cached, requests get "try again in a
  few minutes" instead of being treated as "no employer".

## Screening

The worker first checks the stored file (`inspectResume`): it must be a real PDF, not
password-protected, with no scripts, launch actions or embedded files. A file that fails is deleted
before anyone can open it and the request is marked "résumé refused"; the request still arrives.

The `evidence-v1` policy is **not job matching**. It produces a private 0-100 evidence score with
a pass mark of **60**. At least one of three independent paths must qualify:

1. Substantial engineering employment at a major established technology or financial-services
   company, **and an official LinkedIn verification badge confirmed by the owner**.
2. Strong original open-source engineering or substantive merged upstream work. A real Kafka /
   microservices platform can qualify through ownership, failure handling, tests, deployment and
   measurable impact. Stars, technology lists, tutorial clones and trivial PR counts are not enough.
3. Strong LeetCode weekly/biweekly performance, supported by rating, dated rankings and consistency.
   Solved-problem counts and practice streaks do not qualify. There is no arbitrary fixed rating,
   star or PR cutoff; the AI must explain the substantive quality.

The model supplies a score, gate assessment, reason, evidence quotations and supporting links for
each path. `rubric.mjs` computes the final result: the strongest path wins, **not the sum**. A path
without substantive evidence, the required reference, or its required badge confirmation is capped
at 59 in the final score. Spam, prompt injection, off-topic requests and conflicting evidence cannot
pass. The model cannot set the final score or attest a badge. A score is a screening heuristic, not
a probability. No request is automatically declined, hidden or referred; the owner decides.

All material is untrusted. The prompt excludes protected characteristics and rejects padding.
Malformed model responses fall back to an unscored completeness note. Evidence and URLs come from
the submitted form or resume, **not independent web retrieval**. The UI and email make this limit
explicit. Contact email and the separately entered profile URL are still excluded from model input.

LinkedIn verification is recorded in the authenticated review panel. The owner opens the supplied
LinkedIn member profile, checks the official badge and records its type and what was checked.
Premium, OAuth sign-in, a URL and an applicant's own assertion do not count. A badge may verify
identity, workplace or education; it does not by itself certify the entire work history
([LinkedIn Help](https://www.linkedin.com/help/linkedin/answer/a1357905)). The server stores the
owner ID, timestamp, note and profile URL with the screening JSON, then recalculates the score.
Conditional updates reject stale reviews and concurrent rescreening. Rescreening clears a previous
badge confirmation and asks for a fresh check. No third-party badge-verification API is connected.

Existing job-fit notes are labelled as previous-policy results and excluded from score ranking;
use "Screen again" to reevaluate them. No bulk re-screen, database migration or retention change
is required. The legacy `fit` column mirrors the new score for storage compatibility; only a note
with the `evidence-v1` rubric can be displayed as a current score.

- Model: the same `gemini-2.5-flash-lite` constant as discovery, thinking disabled, 1,600 output tokens.
- Off by default. It runs only with `REFERRAL_AI_ENABLED=1` and a key in `REFERRAL_GOOGLE_API_KEY`
  (or `DISCOVERY_GOOGLE_API_KEY` / `GEMINI_API_KEY`).
- Every paid call reserves its cost in the shared monthly ledger first (`docs/AI_SPEND_GUARD.md`)
  and settles with the provider's reported usage. No reservation, no call. No retries, no fallback model.
- A PDF's token count cannot be bounded from its size, so the free `countTokens` endpoint is asked
  first. Above 20,000 prompt tokens, or with no count, the file is not sent and only the form
  answers are screened.
- One generation per screening, no external scraping, and no extra call for badge confirmation.
  The increased output allowance is included in the existing reservation before generation.
- When the model is off, over a limit, slow or returns something malformed, the note is a plain
  completeness check with no score and no pass decision.

## What is kept, and for how long

| What | Where | Until |
|---|---|---|
| The request and its screening note | `public.referral_requests` (service role only, RLS on) | 180 days |
| The résumé file | private bucket `referral-resumes` | the request is declined, archived or deleted; otherwise 30 days |
| A form whose upload never finished | same table, not shown to the owner | 1 day |

The owner opens a résumé from the review page through a link that lasts one minute and downloads
the file under its original name. Only files the worker has checked can be opened.

## Review

`/admin/referrals` (Audience → Referral requests) lists requests by status, newest or highest
evidence score first: the applicant's introduction with one click to copy, the three evidence paths,
the official-badge check, the note, the details, a
download button for the résumé, a status (new, reviewing, referred, declined, archived), a private
note, "Screen again" and delete.

## Configuration

| Variable | Purpose |
|---|---|
| `CRON_SECRET` | Already used by the stories cleanup. Authorises the worker endpoint for the scheduler and for kicks. Without it requests are accepted but only screened by the daily job. |
| `REFERRAL_AI_ENABLED` | `1` switches AI screening on. Anything else: completeness check only. |
| `REFERRAL_GOOGLE_API_KEY` | Gemini key for screening. Falls back to `DISCOVERY_GOOGLE_API_KEY`, then `GEMINI_API_KEY`. |
| `REFERRAL_AI_DAILY_LIMIT` | AI screenings a day (40). |
| `REFERRAL_DIGESTS_PER_HOUR` | Digest emails an hour (6). |
| `REFERRAL_RATE_LIMIT`, `REFERRAL_DAILY_LIMIT` | Per-network hourly limit (6) and the site-wide flood valve (5,000 a day). |
| `REFERRAL_COMPANY` | Leave unset. Pins the company named on the form instead of taking it from the work history. |
| `REFERRALS_PAUSED` | `1` closes the form. The switch on `/admin/referrals` does the same without a deploy. |
| `NEXT_PUBLIC_TALKNEST_URL` | Where "Chat or call live" goes. Default: the public TalkNest deployment. |

Email uses the contact form's `EMAIL_USER`, `EMAIL_PASS` and `EMAIL_TO`; verification uses its
Turnstile keys. The storage bucket is created on first use with its size and type limits.

`vercel.json` schedules the worker once a day (housekeeping, and a sweep of anything a kick
missed), which every Vercel plan allows. On a plan with more frequent cron jobs, a tighter schedule
only shortens the worst case; normal latency comes from the kicks.

## Before going live

1. Run `supabase/migrations/20261116090000_referral_requests.sql` in the Supabase SQL editor. Until
   then the form answers "could not be saved" and `/admin/referrals` shows a notice. Then run
   `20261116100000_knowledge_lexical_employers_from_history.sql` (it only swaps two employer
   names written into the assistant's keyword search for the names in the work history).
2. Check that `CRON_SECRET` is set in Vercel.
3. Decide whether to switch AI on (`REFERRAL_AI_ENABLED=1` and a key). It can be left off.
4. Deploy TalkNest's `connect` change first, so the live-chat text matches what visitors see.

## Local preview

```
npm run dev:talk
```

serves `http://127.0.0.1:3147/talk`, the home page section and `/admin/referrals-preview` (the
review list over made-up requests plus anything sent from the form). The preview skips verification
and rate limits, sends no email, and keeps requests and files in memory, with a local route
standing in for the storage bucket. `TALK_ENV_FILE=../Portfolio/.env.local` adds real site content;
adding `TALK_AI=1` makes real model calls through the shared ledger.

Tests: `npm run test:referral`. Browser walk-throughs against a running preview:
`node tests/talk-referral.browser.mjs` and, on a freshly started preview,
`node tests/talk-job-change.browser.mjs` (it records a change of employer in the preview's
made-up work history).

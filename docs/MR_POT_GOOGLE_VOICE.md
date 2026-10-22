# Mr. Pot Voice

Qwen is also available as a separately configured local provider. See
[Qwen local setup and trial boundaries](MR_POT_QWEN_VOICE.md). Adding it does not
renew the approved Google trial or reuse its key.

Voice conversation launched from the Chat Widget header. Production uses the
bounded relay below; the direct-provider setup further down is local-only.

## Production Limits

```text
Homepage Phone -> /api/voice/session -> Cloud Run voice relay -> Google Live
                                          |
                              private PostgreSQL allowance
```

- 5 attempts per calendar day, shared by the entire platform; midnight America/Denver.
- 40 attempts per calendar month; one pending/active call at a time.
- 120 seconds per call, at most 60 seconds of generated audio, 8 completed turns,
  6 tool calls and 512 output tokens per response. The server closes the provider
  socket, independently of browser timers.
- Counters are atomically reserved before connecting, persist across restarts and
  replicas, and are not refunded on failure. No automatic provider retry/fallback.
- Browser tickets expire after 29 seconds and can be claimed once. Provider keys
  and ephemeral Google tokens never reach the browser. Only bounded PCM input is
  forwarded; setup, model changes, text injection and tool responses are rejected.
- Storage outages fail closed. A private `voice_budget.enabled` switch stops new
  calls immediately and active calls within 10 seconds. No anonymous table/RPC access.
- Usage metadata has a conservative USD 0.20 disconnect threshold. This is an
  estimate, not an exact invoice cap; daily/monthly call and audio limits are the
  primary controls. Hosting/network costs are separate.
- Cloud Run: scale to zero, maximum one instance, 256 MiB, request CPU allocation,
  non-root Node 24. No transcript/audio storage or new always-on service.

`db/voice-budget.sql` creates the private allowance disabled by default. Deploy
`services/voice/cloudbuild.yaml`, then bind the dedicated runtime identity to
`GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `VOICE_GATEWAY_TOKEN` in Secret
Manager. Relay variables: `VOICE_ENABLED`, `VOICE_PUBLIC_URL`, `SUPABASE_URL`.
Vercel production variables: `VOICE_ENABLED`, `NEXT_PUBLIC_VOICE_ENABLED`,
`VOICE_RELAY_URL`, and the same server-only `VOICE_GATEWAY_TOKEN`.
Enable the database switch only after readiness and access-control checks.

Rollback: set the database switch false first, then disable `VOICE_ENABLED` in
Vercel/Cloud Run. Do not reset counters as part of a deployment or rollback.
Run `npm run test:voice` for deterministic safety tests without paid API calls.

For an existing deployment, apply only the `create or replace function` and
function grants from `db/voice-budget.sql`; do not recreate or seed the budget
table. The five-call update preserves today's usage and the monthly allowance.

The one-click revision passes 57 voice tests, 201 portfolio regressions and 40
security checks. Mocked browser coverage verifies one click/one reservation,
one greeting, no automatic redial, permission denial without reservation, and
exhausted-quota preflight without microphone access. The greeting is a fixed
server-side request within the existing session, subject to the same output,
turn and duration limits.

The one-click production smoke call verified automatic connection, the spoken
Mr. Pot greeting, 5.12 seconds of audio, input transcription and hangup cleanup.
It consumed one attempt; four of five daily attempts were then used, with the
concurrency lease released. This smoke call did not verify a follow-up education
answer: its test initially mistook greeting completion for answer completion.
The opt-in script now requires a subsequent completed turn. No second paid test
was made, and the earlier education verification below remains a separate run.

Release checks (2026-10-21): 56 voice tests, 201 existing portfolio tests and 40
security tests pass;
production build passes with existing lint warnings. Fake-provider browser E2E
passes at desktop, 390px and 320px, including canvas-pixel/movement checks,
interruption, mute, bounded rendering and microphone/AudioContext cleanup.
The deployed relay rejects unauthenticated session requests and its database
table/RPC deny anonymous/authenticated access. Quota concurrency, replay, daily
exhaustion and hard stop paths are tested with an isolated shared store, not by
resetting production counters. Existing database advisories outside the new voice
table remain outside this release's scope.

Production homepage E2E passed with synthetic speech (no real microphone): one
Google session returned 9.37 seconds of PCM, played in the browser, and correctly
named Syracuse University and the University of Liverpool with both degrees.
Hangup released microphone/AudioContext resources, disconnected the relay and
cleared the concurrency lease. A simultaneous status read reported `busy`.
An earlier empty test-audio file failed before connecting to Google but consumed
an attempt as designed. Both attempts remain counted; no allowance was reset.
The test now validates its audio fixture before reserving a call.

`tests/voice.production.browser.mjs --approved-single-call` is opt-in and consumes
the real daily allowance. Set `VOICE_TEST_WAV` to a verified synthetic WAV file
and `VOICE_APPROVAL_MARKER` to a new approval-specific receipt path. Never rerun
as an automatic retry. Human microphone/echo and Safari/iOS still need manual
validation; synthetic Chromium coverage is not a substitute.

Unrelated existing database notices include
[public-table RLS configuration](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public)
and [security-definer views](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view).
The voice table is RLS-enabled, has no public policy, and its RPC is service-role-only.

## Flow

```text
User clicks header Phone -> compact full-body call window -> connects automatically
  Local server -> public MCP get_profile (approved summaries, 60s cache)
  Browser -> POST /api/voice/session -> Google auth_tokens + profile grounding
  Browser <- single-use, model-constrained, expiring token
  Browser <== PCM audio + captions + tool calls over WSS ==> Google Live
  UI -> full-body Mr. Pot, captions, mute, interrupt, hangup, transcript
```

The long-lived key stays on the local Node server. Audio travels directly between
the browser and Google, without an additional audio proxy. The provider adapter
is separate from capture/playback and the React interface; another realtime model
requires its own transport and event mapping, not just changing a model name.

## Scope

- Continuous audio, input/output captions, interruption, mute and hangup.
- Read bounded current public-page text/selection, excluding forms, chat and private subtrees.
- Offer fixed public-section navigation. A user click is required; interrupted or stale offers are discarded.
- Education/work history are loaded from the public MCP `get_profile` contract, not inferred from the visible DOM. The model receives the approved facts in setup and can call `get_profile` without another network hop. Missing fields are not treated as missing qualifications.
- The profile reader accepts only explicitly reviewed PROFILE summaries under the public-evidence coverage contract. It does not fetch the full restricted source or private resumes. Errors return UNAVAILABLE, not an assertion that education is absent. Fetch deadline: 6.5s; no stale facts after cache expiry.
- No cross-site RAG search, admin tools, subscriptions, email actions, camera or screen capture.
- Text widget dimensions and avatar artwork are unchanged. Phone is in the header, outside the composer. The call is a 380 x 580px non-modal floating window (viewport-constrained on phones); the underlying text widget is hidden while the rest of the page remains interactive. Closing restores keyboard focus to the header Phone button.
- The call reuses the last local full-body model (including hand/ankle refinements) without changing reference geometry, proportions or materials. A separate Three.js scene adds a quiet stepped studio backdrop, a finite welcome wave, synchronized blinks, listening nods, thinking bows, gently moving steam and speaking gestures. A small open-mouth overlay follows actual playback amplitude, not phoneme lip sync.
- Canonical names are Mr. Pot and Yuqi Guo / 郭育奇 (the Chinese name is also present in the home page's structured data). The voice instructions request short complete sentences and avoid unsolicited current-employer claims. Published work-history records are attributed to the portfolio, not treated as independently verified current employment.
- Provider turn completion does not stop queued audio. A turn is finalized after playback drains; interrupted or unfinished-on-hangup replies are explicitly labeled. These labels do not guess why a provider ended a response or silently rewrite its transcript. No automatic paid retry or increased output budget.
- Hangup preserves this call's transcript in memory; closing the room clears it. Navigation ends the call before opening the requested section.

## Local Setup

### Animation Preview

`/admin/mr-pot-voice-motion` is development-only and needs no API key or microphone.
It uses the same stage as both voice providers, with Welcome, Listening, Thinking,
Speaking and Goodbye states, pause/replay, and a tap-to-pop lid reaction. Speaking
on this study page uses a simulated envelope; actual calls use playback amplitude.
The model geometry, colors and proportions are unchanged. Tighter fixed framing
and 24px more stage height make the character easier to read without enlarging
the 380 x 580px call window. No pulsing scale or continuous turntable motion.

Ready-state motion sleeps between occasional short glances. Live poses remain
capped at 24fps, hidden/collapsed stages pause, and reduced-motion/low-power
devices keep the image fallback. No shadow maps or new model assets were added.
Mouse attention now uses critically damped eye/head/shoulder responses, with the
eyes leading and a slower return after pointer exit. Holding the pointer still
retains the pose without an ongoing render loop. Eye patches are reprojected onto
the curved pot surface during gaze and blinks, avoiding pupils intersecting the
eye whites or pot. Existing mesh counts, neutral proportions and colors are unchanged.
The upper body has gentle shoulder settling, arm-depth gestures and weight shifts;
both feet remain grounded. Three short idle variations replace a repeated glance.
Speech gestures use a slower amplitude envelope than the mouth to avoid arm jitter.
Run `node tests/voice-motion.browser.mjs` against the local preview server to
verify framing, state motion, idle sleep, interaction, mobile and fallback.
The 2026-10-21 attention revision passed 43 local voice/audio/motion/provider
tests. Eye tests raycast both pupils through gaze extremes, head pitch/yaw and
blinks; browser pixel checks verify both pupils at four pointer corners on
desktop and mobile, retained gaze after a three-second hold, and rendering sleep.
These animation checks do not capture a microphone or call a live voice model.

Keep credentials in an ignored local environment file or the server process
environment, never in `NEXT_PUBLIC_*`, source code, browser storage or chat.

| Variable | Purpose |
| --- | --- |
| `GEMINI_LIVE_API_KEY` | Explicit voice credential; no automatic fallback to the site's existing key |
| `GEMINI_LIVE_BILLING_ACK=true` | Explicit local billing acknowledgement |
| `GEMINI_LIVE_MODEL` | Defaults to `gemini-3.8-live` |
| `GEMINI_LIVE_MAX_SECONDS` | 10-180 seconds; default 180 |
| `GEMINI_LIVE_MAX_CALLS` | 1-12 attempts per rolling day, per local process; default 12 |
| `GEMINI_LIVE_TRIAL_LEDGER` | Optional private local receipt file; total attempt limit survives hot reloads/restarts without daily renewal |
| `GEMINI_LIVE_MAX_ESTIMATED_USD` | Optional browser usage-metadata cutoff, capped at USD 0.25/call; conservative estimate, not a provider billing cap |
| `GEMINI_LIVE_MAX_OUTPUT_TOKENS` | 64-512 per response; default 512 |
| `VOICE_PREVIEW_PORT` | Default 3118 |

```sh
node scripts/dev-voice.mjs
```

Open `http://127.0.0.1:3118/?openChat=1`, then click Phone once.
The script enables the development flags and binds to loopback only. Without an
explicit voice key and billing acknowledgement, the interface remains available
but calls are disabled. HTTPS is required outside localhost; production is disabled
even if these flags are accidentally set.

Minimizing the call window preserves audio but pauses 3D rendering. Closing the
window, unmounting, closing the tab, or hiding the page ends the call. This is
intentional for the local preview. Navigation to a different page can unmount the
widget and end the call; continuous cross-page calling is not part of this step.

## Performance and Safety

- The phone click primes audio playback synchronously before loading the call UI.
  Availability is checked first; microphone permission is obtained before reserving
  an attempt. The window connects once and never automatically retries on hangup,
  provider errors, permission denial, or an unavailable allowance.
- A short "Mr. Pot is connecting..." status accompanies setup. After setup, the
  relay sends one fixed greeting prompt in the same Google session, with no extra
  TTS service or browser-supplied prompt. Greeting audio counts against all existing
  output/time/usage limits and can be interrupted normally.
- Voice code loads only after opening the voice control; no idle microphone or connection.
- Three.js/model code loads only inside the call window. The initial wave settles after about 3.4 seconds; ready/ended poses then render on demand. Active animation is capped at 24fps, DPR at 1.5. Minimized windows and covered transcript views pause the renderer. There are no shadow maps or postprocessing. Closing disposes geometry, renderer and context.
- Reduced-motion, low-memory/save-data devices and WebGL failures retain the original full-body PNG. Hidden pages stop animation and end capture.
- AudioWorklet batches 16 kHz PCM in 100 ms packets. Output is scheduled PCM playback.
- The playback meter updates at most 12.5 times/second without React rerenders.
- Page text is read on demand, capped at 6,000 characters; no DOM polling or screen images.
- Tokens expire at the call limit, allow one session and lock the model/configuration.
- Connection timeout, bounded playback queue, send backpressure and tool-call limits.
- Hangup cancels fetch, stops tracks/output, closes AudioContext/socket and invalidates pending actions.
- Loopback and same-origin checks; no provider error bodies or credentials returned to clients.
- Without a trial ledger, quotas are process-local and reset on restart. Approved personal trials use a private receipt file so a reload/restart does not renew the allowance; invalid/unwritable receipts fail closed. These are single-server preview controls, not production abuse protection or a provider-enforced dollar budget.

## Verification

### Renewed Local Trial, 2026-10-21

The owner explicitly approved one verification call and three personal calls,
up to 120 seconds each and an estimated total below USD 1, without changing
billing or deploying. Google is the default; Qwen remains disabled pending its
separate handshake investigation. The new real test used one 60-second token,
received input/output captions and 5.36 seconds of real PCM audio without a
provider error. Its stricter education-content assertion failed, so it is not a
complete passing E2E result. A separate public MCP read returned both university
facts correctly. No second paid verification call was attempted.

The personal runtime reserves three attempts in an approval-specific receipt
file, constrains tokens to 120 seconds/512 output tokens, and applies a conservative
USD 0.25 per-call usage-metadata cutoff. Browser controls remain best-effort;
these estimates are not the provider invoice or a cloud-enforced dollar cap.
GET status reports remaining attempts and disables Start when exhausted.

```sh
node --test tests/voice.test.mjs tests/voice-audio.test.mjs tests/voice-motion.test.mjs
node tests/voice.browser.mjs
```

The browser suite uses a fake Google provider but real browser AudioWorklet,
capture and playback APIs. It blocks unrelated external traffic. Screenshots go
to `/tmp/mr-pot-voice-*.png`. The Playwright import currently uses the local Codex
runtime path; configure that import when running outside this workstation.

The earlier 2026-10-21 call-room revision passed 24 unit tests plus desktop/mobile
browser checks. Its public MCP read was separately verified against the live
endpoint and returned both Syracuse and Liverpool degrees. The compact-window
revision adds tests for canonical-name instructions, bounded state poses, delayed
audio completion and interrupted replies (29 unit tests passed), plus passing
mocked-provider desktop/390px/320px browser checks for the floating layout,
canvas pixels, movement, bounded frame rate, minimize/resume, focus restoration,
captions, interruption, mute, navigation and resource cleanup. Scoped lint passes
with only pre-existing ChatWidget warnings. Real model
pronunciation and conversation quality still require a new approved live test;
mocked provider responses cannot verify them. The two personal trials have been
used, and the existing local process reports voice as unavailable. No trial quota
or billing limit was reset. The real test below predates these revisions.

An explicitly approved real Google test on 2026-10-21 recognized synthetic speech,
returned captions plus 5.87 seconds of PCM audio, played it in the browser, and
released all audio resources on hangup. Only one real voice session was opened.
A preceding token request was rejected before any audio session; the raw REST
schema was corrected to `bidiGenerateContentSetup` instead of the SDK-only
`liveConnectConstraints` field. The successful test used a 60-second token,
55-second watchdog, one-call guard and 256 output tokens. Its conservative cost
estimate was USD 0.0244; actual invoiced usage was not available.

`tests/voice.live.browser.mjs --approved-single-call` is opt-in and paid. Do not
rerun without explicit approval. It reads the existing local key into the test
server process only, uses `/tmp/mr-pot-voice-input.wav` as synthetic speech, and
shuts down the credential-bearing server afterward. The ordinary preview does
not inherit this one-time authorization.

Manual validation still needed: real microphone/acoustic echo, conversational
quality in Chinese, interruption timing with human speech, and Safari/iOS audio
behavior. A mocked provider or synthetic microphone does not prove those.

## References

- [Google Live API](https://ai.google.dev/gemini-api/docs/live-api)
- [Live WebSocket event reference](https://ai.google.dev/api/live)
- [REST auth_tokens schema](https://ai.google.dev/api/generate-content#auth_tokens.create)
- [Google Live pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [Three.js](https://threejs.org/docs/)

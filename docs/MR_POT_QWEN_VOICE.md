# Mr. Pot: Qwen Voice

Qwen is the owner-approved production voice provider. The provider is selected
on the server, never by visitors. The original Google transport remains available
for an explicit operator rollback; errors never trigger an automatic paid fallback.

## Production And Private History

The existing Cloud Run relay uses `VOICE_PROVIDER=qwen`, `QWEN_LIVE_API_KEY`,
`QWEN_LIVE_WORKSPACE_ID`, and `VOICE_RECORD_TRANSCRIPTS=true`. Credentials stay in
Secret Manager. The existing single-instance, scale-to-zero service is reused.
The browser keeps its normalized relay protocol, so no provider key is issued to it.

The durable platform allowance remains **5 calls per day, 40 per month, one
active call, and 120 seconds per call**. Input/output audio, model output tokens,
tool calls, and conservative usage cutoffs remain enforced in the server. Local
unlimited settings are not read by the production relay. Existing counters are
not reset during deployment.

Provider text transcripts are written to the existing private `conversation` and
`message` tables, one conversation per call. Stable message UUIDs support idempotent
checkpoint updates and retries. Completion, interruption, provider, model, sequence,
and public page path are retained; audio recordings and browser identity claims are
not stored. A generated answer is not a claim that the caller heard it in full.
Hangup stops audio immediately and gives the relay time to flush text. Process
termination can still leave the last checkpoint incomplete; this is not exactly-once
delivery. Storage failures end the call rather than silently continuing unrecorded.

The existing protected `/admin/conversations` page shows voice calls alongside
agent activity, with each call's full transcript expandable. Local testing is labeled
separately (`voice-local`). Neither anonymous users nor ordinary authenticated users
receive direct database access. The 30-day admin query window is **not** a database
retention policy; deletion requests use the site's privacy contact.

## Owner-Approved Direction

The owner approved the Qwen conversation quality after personal testing. The
local phone entry now always uses the configured Qwen provider; the call window
does not expose model selection or switch to Google after errors or exhaustion.
The same default is now supported by the production relay, with its original
platform-wide safeguards retained.

The owner subsequently approved unlimited personal local testing. Set
`QWEN_LIVE_UNLIMITED_LOCAL=true` explicitly in the development server process to
remove both call-count and conversation-duration caps. This override works only
on the loopback development relay; production limits remain unchanged.
Old trial receipts are left untouched. Setup/one-use ticket expiry, single-call
exclusivity, origin validation, payload limits and hangup cleanup still apply.
Actual API usage can incur charges, and provider/account limits still apply.

The 3D stage now alternates three speech gestures across replies, retains the
gesture phase through short playback gaps, and adds a small acknowledgement nod,
thought-to-recall pose, shoulder breathing and smooth audio-driven mouth motion.
Model geometry, proportions, eye surfaces, stage size and camera remain unchanged.
Rendering stays capped at 24 fps and DPR 1.5, pauses when hidden, and retains the
static reduced-motion/low-power fallback. Local motion tests use synthetic levels
and do not open a microphone or call a model.

## Verified Local Trial (2026-10-22)

- Following owner account setup, the provider accepted the connection and returned
  real audio. `AccessDenied.Unpurchased` no longer occurred in the latest tests.
- The first real response could not answer the education question. Its exact
  profile-loading status was not captured. The relay now refuses to start without
  approved public facts, prewarms the public MCP profile at local startup, and
  records profile readiness/count/latency without logging the facts themselves.
- One separately approved retest passed: synthetic speech asked which universities
  Yuqi attended; Qwen answered Syracuse University and the University of Liverpool.
  Public facts were confirmed in the outgoing setup. The response generated 4.56
  seconds of audio and the provider reported 1,982 total tokens. This is usage,
  not a billing receipt or a claim of zero cost.
- Browser playback, captions, audio-reactive animation, and hangup cleanup passed.
  The microphone tracks, audio contexts and provider connection closed. Only one
  provider connection was used in that retest; there were no automatic retries.
- The initial local owner preview used port 3124, default Qwen, and a separate
  receipt ledger allowing two calls of at most 60 seconds. Those historical
  receipts remain intact; the later owner-approved unlimited mode is separate.
  Failed profile loads do not start a provider session.
- No payment, quota, billing, production-provider or account settings were changed
  during this implementation. Long-form quality and natural Chinese conversation
  remain for the owner to evaluate before any production switch.

The relay recognizes untyped gateway errors, sends only an allowlisted error
code to the browser, and closes immediately. Provider messages, request IDs and
credentials are not forwarded. All outgoing events have unique IDs; audio rates
are explicitly configured as 16 kHz input and 24 kHz output.

## Earlier Account Setup (2026-10-21, Historical)

- The owner completed Alibaba Cloud sign-in. A dedicated Singapore workspace
  key was created with explicit approval, scoped only to
  `Qwen3.8-Omni-Flash-Realtime`. The existing key was left unchanged.
- The console showed 1,000,000 remaining trial tokens, expiring 2026-12-20,
  with Free Quota Only / auto-stop enabled. This is a total grant, not a daily
  allowance. Quota and billing must be rechecked before further live use.
- Credentials are in `.env.voice-qwen.local`, ignored by Git, mode `0600`.
  Both enable and trial-ack flags remain false. No card was bound, no top-up
  or purchase was made, and nothing was deployed.
- Two separately approved, single-attempt live browser tests used synthetic
  speech, never the owner's microphone. Both ended before audio input/output.
  The second received HTTP 101 and `session.created`, then closed with WebSocket
  code 1006 after about 2.8 seconds, before `session.updated`. The audit log showed
  status 200 with no usage or error details. This does not establish successful
  inference, model quality, zero billed cost, or a payment-related cause.
- The adapter now waits for `session.created` before sending configuration,
  following the official WebSocket example. Local mock regression tests pass,
  but the live failure remains unresolved. Do not silently retry or switch keys.
- At that point the owner's two 60-second calls had not been consumed or enabled. The
  two one-use verification markers remain in `/tmp`; another agent-driven live
  attempt requires fresh explicit approval. Restarting does not grant approval.

## Account Setup

1. Register an Alibaba Cloud international account yourself, including password,
   verification and terms. Do not purchase a Token Plan or Coding Plan for this test.
2. Open Model Studio in Singapore. Confirm the chosen realtime model is available,
   has remaining trial quota, and **Free Quota Only** is enabled and effective.
   Without that protection, usage can automatically become pay-as-you-go.
3. Create a dedicated Model Studio key scoped to the chosen realtime model. Keep
   the key and workspace ID in an ignored local environment file or process env.
   Never put the key in chat, source code, NEXT_PUBLIC variables or browser storage.
4. Explicitly approve the local trial before setting `QWEN_LIVE_TRIAL_ACK=true`.
   The code does not independently verify the cloud account's quota or billing state.

| Server Variable | Meaning |
| --- | --- |
| `QWEN_LIVE_ENABLED=true` | Enable local provider |
| `QWEN_LIVE_API_KEY` | Dedicated server-only Model Studio key |
| `QWEN_LIVE_WORKSPACE_ID` | Singapore workspace ID used in the official API host |
| `QWEN_LIVE_TRIAL_ACK=true` | Explicit trial approval after checking billing/quota |
| `QWEN_LIVE_MODEL` | Default `qwen3.8-omni-flash-realtime`; also allows 3.5 Flash/Plus realtime |
| `QWEN_LIVE_UNLIMITED_LOCAL=true` | Explicit development-only override; no call-count or conversation-duration cap |
| `QWEN_LIVE_MAX_SECONDS` | Default and maximum 60 seconds for bounded trials; ignored in unlimited local mode |
| `QWEN_LIVE_MAX_CALLS` | Default and maximum 2 attempts for bounded trials; ignored in unlimited local mode |
| `QWEN_LIVE_TRIAL_LEDGER` | Approval-scoped receipt file; preserves the call cap across local restarts |
| `NEXT_PUBLIC_VOICE_DEFAULT_PROVIDER=qwen` | Use the local Qwen protocol in development; production uses the server-selected relay provider |
| `VOICE_RECORD_TRANSCRIPTS=true` | Save provider text to the existing private conversation database; requires server-side Supabase credentials |

Once live verification succeeds, explicitly enable the approved runtime and run
`node --env-file=.env.voice-qwen.local scripts/dev-voice.mjs` on an unused
`VOICE_PREVIEW_PORT`, open the Chat
Widget header Phone button. Configure `NEXT_PUBLIC_VOICE_DEFAULT_PROVIDER=qwen`
before starting the local server; visitors do not choose the provider. The existing
production provider remains separately configured in Cloud Run. No fallback silently changes
provider or charges another account.

## Flow And Controls

```text
Phone button -> local POST -> require approved public profile -> one-use 30s ticket (reserve attempt in bounded mode)
Browser PCM -> same-origin local WebSocket -> Qwen realtime (Singapore)
Qwen audio/captions/tools -> local relay -> existing player / Mr. Pot / transcript
```

The relay sends the key only as an upstream Authorization header to the fixed
Singapore workspace domain. It waits for `session.created` before sending the
locked configuration, then waits for `session.updated` before forwarding microphone audio.
It binds to loopback, checks origin and host, locks
model/session configuration, disables search, limits payloads/rates/backpressure,
and stops the provider socket on disconnect (or deadline in bounded mode). No provider URL or key
is returned to the browser; errors are redacted. Tools are limited to profile,
public-page reading and click-to-confirm navigation. A page change ends the call.

Google and Qwen share the audio resource lifecycle, public evidence, animation,
floating window and bounded transcript. Provider events are translated by the
Qwen adapter. No model geometry or homepage performance behavior was changed.

For bounded trials, use a single local preview process with an approval-scoped receipt file. Without
that file the counter is process-local; do not restart to renew an exhausted trial
without new approval. Corrupt or unwritable receipt files fail closed. These are local preview
controls, not production abuse protection or a guaranteed dollar budget.

## Verification

```sh
node --test tests/voice.test.mjs tests/voice-audio.test.mjs tests/voice-motion.test.mjs tests/voice-qwen.test.mjs
node --test tests/voice-history.test.mjs tests/voice-history-view.test.mjs tests/voice-qwen-transport.test.mjs tests/voice-relay.test.mjs
node tests/voice.browser.mjs
node tests/voice-qwen.browser.mjs
VOICE_E2E_UNLIMITED_LOCAL=true node tests/voice-qwen.browser.mjs
```

The Qwen browser test uses real local HTTP/WebSocket/audio playback and a fake
provider with external requests blocked. It cannot establish model quality,
pronunciation, real provider compatibility, network latency or available quota.
The latest real-call result is recorded above. The live fixture first checks
public profile readiness, then uses a one-use marker and a 60-second hard cutoff;
its diagnostics contain fixed lifecycle stages and numeric close codes, not
credentials or raw provider error bodies.

## Official References

- [Realtime API](https://www.alibabacloud.com/help/en/model-studio/realtime)
- [Client events](https://www.alibabacloud.com/help/en/model-studio/client-events)
- [Server events](https://www.alibabacloud.com/help/en/model-studio/server-events)
- [API keys](https://www.alibabacloud.com/help/en/model-studio/get-api-key)
- [Free quota and Free Quota Only](https://www.alibabacloud.com/help/en/model-studio/new-free-quota)
- [Model Studio activation error](https://www.alibabacloud.com/help/en/model-studio/error-code)

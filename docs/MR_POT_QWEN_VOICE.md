# Mr. Pot: Local Qwen Voice Trial

Local only. The existing Google trial is not renewed or reused. Real Qwen
conversation is **not yet verified**; keep the local provider disabled until
the upstream setup failure below is resolved.

## Account And Live Verification (2026-10-21)

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
- The owner's two 60-second calls have **not** been consumed or enabled. The
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
| `QWEN_LIVE_MAX_SECONDS` | Default and maximum 60 seconds |
| `QWEN_LIVE_MAX_CALLS` | Default and maximum 2 attempts in this process |

Once live verification succeeds, explicitly enable the approved runtime and run
`node --env-file=.env.voice-qwen.local scripts/dev-voice.mjs` on an unused
`VOICE_PREVIEW_PORT`, open the Chat
Widget header Phone button, and select Qwen in the call header. The existing
Google provider remains separately configured. No fallback silently changes
provider or charges another account.

## Flow And Controls

```text
Explicit Start -> local POST -> approved public profile + one-use 30s ticket
Browser PCM -> same-origin local WebSocket -> Qwen realtime (Singapore)
Qwen audio/captions/tools -> local relay -> existing player / Mr. Pot / transcript
```

The relay sends the key only as an upstream Authorization header to the fixed
Singapore workspace domain. It waits for `session.created` before sending the
locked configuration, then waits for `session.updated` before forwarding microphone audio.
It binds to loopback, checks origin and host, locks
model/session configuration, disables search, limits payloads/rates/backpressure,
and stops the provider socket on deadline or disconnect. No provider URL or key
is returned to the browser; errors are redacted. Tools are limited to profile,
public-page reading and click-to-confirm navigation. A page change ends the call.

Google and Qwen share the audio resource lifecycle, public evidence, animation,
floating window and bounded transcript. Provider events are translated by the
Qwen adapter. No model geometry or homepage performance behavior was changed.

The two-attempt counter is process-local and resets on restart. Do not restart
to renew an exhausted trial without new approval. These are local preview
controls, not production abuse protection or a guaranteed dollar budget.

## Verification

```sh
node --test tests/voice.test.mjs tests/voice-audio.test.mjs tests/voice-motion.test.mjs tests/voice-qwen.test.mjs
node tests/voice.browser.mjs
node tests/voice-qwen.browser.mjs
```

The Qwen browser test uses real local HTTP/WebSocket/audio playback and a fake
provider with external requests blocked. It cannot establish model quality,
pronunciation, real provider compatibility, network latency or available quota.
A successful real call is still required; the two approved attempts above did
not pass. The live fixture uses a one-use marker and a 60-second hard cutoff;
its diagnostics contain fixed lifecycle stages and numeric close codes, not
credentials or raw provider error bodies.

## Official References

- [Realtime API](https://www.alibabacloud.com/help/en/model-studio/realtime)
- [Client events](https://www.alibabacloud.com/help/en/model-studio/client-events)
- [Server events](https://www.alibabacloud.com/help/en/model-studio/server-events)
- [API keys](https://www.alibabacloud.com/help/en/model-studio/get-api-key)
- [Free quota and Free Quota Only](https://www.alibabacloud.com/help/en/model-studio/new-free-quota)

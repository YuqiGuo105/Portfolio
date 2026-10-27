# Shared AI Spend Guard

## Status

**Active for the new local Fast chat and dictation paths only, not a
platform-wide monthly spending cap.** After explicit approval on October 26,
2026 (America/Denver), the policy in the existing Blog project was enabled with
the original $8 monthly admission limit. No auto-reload or production service
routing has been enabled. Historical provider charges have not been reconciled
into the baseline; this ledger cannot yet enforce the requested $10 aggregate
ceiling across all existing API usage.

The local voice launcher selects the verified Qwen realtime provider. The
server relay now uses Qwen when `VOICE_PROVIDER` is omitted; explicit Google
configuration remains supported, with no automatic fallback. This does not
change any deployed environment variable.

The selected low-cost text candidate is `qwen3.7-flash-2026-07-15`, with thinking
disabled. The original voice-only key correctly rejected it. On October 26,
2026, a separately authorized text key was created with only this snapshot in
its model allowlist. It is stored in ignored `.env.ai-text.local` with mode 0600,
now loaded server-side by the local homepage launcher, but not deployed.

Four live probes through the local gateway adapter passed: public education
facts, Chinese JSON, an unknown private fact, and incremental text streaming.
The conservative usage estimate was $0.000163 against a $0.02 test ceiling.
These are basic compatibility checks, not a complete agent/safety evaluation or
a homepage end-to-end test. The production text-agent default is unchanged.
The new loopback-only Fast chat and dictation paths reserve through the shared
ledger. After activation, a real 2.23-second synthetic WAV transcription
returned HTTP 200 in about 3.1 seconds, and a Chinese education question through
the homepage widget streamed a completed answer naming Syracuse and Liverpool.
The answer did not supply graduation dates, so this does not establish complete
profile-field coverage. Physical microphone capture was not part of this check.
Both ledger reservations settled: 10,000 microdollars conservatively charged for
dictation (no usage receipt), and 194 microdollars estimated for chat. There were
no open reservations; remaining admission budget was $7.989806, not an invoice
balance. An $8 reservation was then correctly denied with `monthly_limit` in a
rolled-back transaction, without making a provider request or changing the
approved policy. The focused 34-test regression suite also passed.

## Ledger

`supabase/migrations/20261027035313_shared_ai_spend_guard.sql` provides a
service-role-only, RLS-protected ledger. Amounts are integer USD microdollars.

- One policy-row lock serializes reservations across hosts and providers.
- Baseline spend, settled usage, and all outstanding reservations count toward
  an $8 monthly admission limit, leaving $2 of the requested $10 as a buffer.
- Reserve before a paid request; no reservation means no provider request.
- Unknown usage retains the full reservation. There is no expiry refund.
- Duplicate reservation IDs are rejected. Settlement is idempotent.
- Outstanding reservations survive month rollover; late settlements also
  count against the current month. Overruns pause new requests.
- The month uses UTC. This is deliberately conservative accounting, not a
  replica of provider billing calendars or invoices.

## Model Gateway

`services/voice/modelGateway.mjs` reuses the voice service process and exposes
only the internal `/ai/v1beta/models/...` routes. It requires a distinct
`AI_GATEWAY_TOKEN` in the `x-goog-api-key` header. Provider keys stay on the
gateway; Java services receive only this internal token.

Configuration names (values must never be committed):

- `AI_GATEWAY_TOKEN`: at least 32 characters, separate from provider keys.
- `AI_SPEND_SUPABASE_URL`, `AI_SPEND_SERVICE_ROLE_KEY`: shared ledger access.
- `QWEN_TEXT_API_KEY`, `QWEN_LIVE_WORKSPACE_ID`: text-only Qwen credentials.
- `GEMINI_API_KEY`: Google provider credential held by the gateway.

The adapter preserves the existing Java Gemini text/stream response contract.
It permits only priced models and bounded input/output, disables hidden
thinking, rejects unpriced tools/media, and never retries or switches providers.
It completes accounting before ending the HTTP response. Storage failure keeps
the durable reservation charged.

The Qwen quote uses the highest published input/output tier, even when a short
request qualifies for the cheaper tier. Google WAV input is restricted to the
existing mono 16 kHz PCM format, at most 60 seconds. Do not switch embeddings to
a different model simply to fit this allowlist: existing vectors require a
separate migration/reindex plan.

## Rollout Gates

1. Done: separate restricted text key and four basic live compatibility probes.
   Still required: complete agent, safety/intent, and tool-flow evaluation before
   changing the text-agent default.
2. Wire both production and local realtime transports to the shared ledger.
   Keep unknown/interrupted usage charged; budget protection must also cover
   explicitly unlimited local calls. Direct Google browser tokens must not
   bypass the relay.
3. Route generation, safety, intent, dictation, embeddings, RAG/search indexers,
   and the copilot classifier through the gateway. Verify attachment and Deep
   search compatibility or explicitly disable unsupported paid features.
4. Remove direct provider credentials from callers; disable optional alternate
   provider paths. Otherwise a shared cap can be bypassed.
5. Before claiming platform-wide coverage, reconcile existing month-to-date
   charges from both providers, seed the baseline conservatively, and test true
   concurrent connections on Postgres. The migration is installed and the $8
   policy is enabled only for the new local paths described above.
6. Run local and deployed end-to-end tests, including denied budget, missing
   credentials, duplicate requests, disconnects, and database outages.
7. Only then enable provider auto-reload with separately agreed recharge limits.

Provider console budgets are defense in depth, not an instantaneous guarantee.
In this investigation the Alibaba monthly account budget was set to $3 with
stop-service enabled, and the existing Google project cap was $5. Reporting
delays, tax, unrelated uses of the accounts/keys, and charges before rollout are
not made safe by local code. Google auto-reload remains off.

## Verification

```sh
node --test tests/voice-relay.test.mjs tests/voice-local-config.test.mjs \
  tests/ai-spend.test.mjs tests/ai-model-gateway.test.mjs
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js \
  node --test tests/ai-spend.database.mjs
```

The database test uses PGlite for SQL, privileges, and ledger behavior. It does
not substitute for a multi-connection production Postgres concurrency test.

`tests/ai-text.live.mjs` is an explicit paid probe, excluded from normal tests.
It requires `--approved-usd=0.02`, uses only the restricted text key, never retries
or falls back, and writes a persistent reservation receipt under `/private/tmp`.
The same receipt prevents repeated executions from exceeding the approved
aggregate amount. Do not remove/reset it to obtain more paid attempts without
new approval. Its local test-only budget is not the production shared ledger.

## Pricing References

Checked October 26, 2026. Recheck before enabling a new model or changing rates.

- [Alibaba pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)
- [Qwen realtime limits and billing](https://www.alibabacloud.com/help/en/model-studio/realtime)
- [Google pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Google billing](https://ai.google.dev/gemini-api/docs/billing)
- [Alibaba budget management](https://www.alibabacloud.com/help/en/model-studio/budget-management)

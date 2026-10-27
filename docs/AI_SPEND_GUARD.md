# Shared AI Spend Guard

## Status

**Active for production Fast chat (intent, safety and generation), dictation,
and their local counterparts, not a platform-wide monthly spending cap.** After explicit approval on October 26,
2026 (America/Denver), the policy in the existing Blog project was enabled with
the original $8 monthly admission limit. The production Java agent now routes
these requests through the authenticated Qwen gateway. Auto-reload remains off.
Historical provider charges have not been reconciled
into the baseline; this ledger cannot yet enforce the requested $10 aggregate
ceiling across all existing API usage.

Production and the local voice launcher select the verified Qwen realtime provider. The
server relay now uses Qwen when `VOICE_PROVIDER` is omitted; explicit Google
configuration remains supported, with no automatic fallback. This does not
make realtime calls part of the monthly ledger: the existing production
five-call daily limit and 120-second call limit remain separate protections.

The selected low-cost text candidate is `qwen3.7-flash-2026-07-15`, with thinking
disabled. The original voice-only key correctly rejected it. On October 26,
2026, a separately authorized text key was created with only this snapshot in
its model allowlist. Its local copy is stored in ignored `.env.ai-text.local`
with mode 0600. After separate approval on October 27, the production copy was
stored in Secret Manager with secret-scoped access only for the relay runtime.
The Java agent receives the independent internal gateway token, not that key.

Four live probes through the local gateway adapter passed: public education
facts, Chinese JSON, an unknown private fact, and incremental text streaming.
The conservative usage estimate was $0.000163 against a $0.02 test ceiling.
These are basic compatibility checks, not a complete agent/safety evaluation or
a homepage end-to-end test. These were the initial local checks; production
verification is recorded below.
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

1. Done: restricted text key, adapter compatibility probes, Java regression
   tests, and production homepage education Q&A, navigation and dictation.
   This is focused recovery verification, not an exhaustive model evaluation.
2. Wire both production and local realtime transports to the shared ledger.
   Keep unknown/interrupted usage charged; budget protection must also cover
   explicitly unlimited local calls. Direct Google browser tokens must not
   bypass the relay.
3. Done for agent generation, safety, intent and dictation. Public knowledge
   recovery uses current-source lexical search without paid embeddings.
   Embedding/indexer and copilot paths still need migration. Deep research and
   attachment understanding are explicitly disabled before any model work.
4. Remove direct provider credentials from callers; disable optional alternate
   provider paths. Otherwise a shared cap can be bypassed.
5. Before claiming platform-wide coverage, reconcile existing month-to-date
   charges from both providers, seed the baseline conservatively, and test true
   concurrent connections on Postgres. The migration is installed and the $8
   policy covers only the guarded paths described above.
6. Run local and deployed end-to-end tests, including denied budget, missing
   credentials, duplicate requests, disconnects, and database outages.
7. Only then enable provider auto-reload with separately agreed recharge limits.

Provider console budgets are defense in depth, not an instantaneous guarantee.
In this investigation the Alibaba monthly account budget was set to $3 with
stop-service enabled, and the existing Google project cap was $5. Reporting
delays, tax, unrelated uses of the accounts/keys, and charges before rollout are
not made safe by local code. Google auto-reload remains off.

## Production Recovery (October 27)

The production route preserves Java intent, safety, orchestration,
navigation, and history; it changes only the model transport:

1. Java `GEMINI_BASE_URL` points to the existing relay's `/ai/v1beta` endpoint.
   `GEMINI_API_KEY` receives the independent `AI_GATEWAY_TOKEN`, not a provider
   credential. Explicitly set the regular text models to the pinned Qwen model.
2. `SPEECH_MODEL=qwen3.8-omni-flash-realtime` selects recognition-only Qwen
   dictation in that adapter. It reserves from the same monthly ledger before
   opening the provider socket, and retains the reservation when usage is not
   reported. Java's existing audio validation and JSON response remain intact.
3. `KNOWLEDGE_LEXICAL_ONLY=true` avoids paid embeddings while preserving the
   current-source eligibility contract. The additive
   `20261027150402_current_knowledge_lexical_recovery.sql` migration was applied
   and checked: only `service_role` may execute it. It excludes stale, private,
   unpublished, and unapproved records; it does not query the legacy index.
4. The relay has the approved restricted text key and a separate internal
   gateway token. `AGENT_DEEP_PATH_ENABLED=false` and
   `AGENT_ATTACHMENTS_ENABLED=false` are enforced server-side. The widget reads
   `/api/rag/capabilities` once when opened, fails closed on errors, and marks
   these features temporarily unavailable without changing widget dimensions.
   No provider fallback or automatic retry is introduced.

Production checks on `https://www.yuqi.site`:

- The homepage answered a Chinese education question with Syracuse University
  and the University of Liverpool, with sources and a completed run.
- A chat request to visit My Blogs opened the matching website guide.
- A 2.23-second synthetic WAV returned HTTP 200 with the recognized university
  question in about 4.3 seconds through Next.js, Java and the Qwen relay. This
  does not test a user's physical microphone or browser permission settings.
- Deep and attachment requests ended as unavailable before run admission;
  production capability flags returned `false` for both.
- New text and transcription ledger reservations settled with no open holds.
- The earlier production voice probe returned actual speech, a correct
  education answer, and a completed conversation with three persisted messages.

Voice now checks current approved profile evidence before reserving a daily
call. A cold profile fetch has a bounded 10-second deadline and concurrent
requests share that read. Failure does not spend the daily allowance or open a
paid model connection; stale cached evidence is never served after expiry.
This change does not remove the five-call daily or 120-second production limits.

## Verification

```sh
node --test tests/voice-relay.test.mjs tests/voice-local-config.test.mjs \
  tests/ai-spend.test.mjs tests/ai-model-gateway.test.mjs
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js \
  node --test tests/ai-spend.database.mjs
```

The database test uses PGlite for SQL, privileges, and ledger behavior. It does
not substitute for a multi-connection production Postgres concurrency test.

`tests/knowledge-lexical.database.mjs` checks the lexical RPC against isolated
PGlite fixtures, including changing access, publication, hashes, and versions.
`tests/voice.production.integration.mjs` is an explicit single-call production
probe, not part of automatic tests. It requires `--approved-single-call`, a
synthetic `VOICE_TEST_WAV`, and a unique `VOICE_APPROVAL_MARKER`. It uses the
public session endpoint and its normal quota, never reads a microphone, stops
within 55 seconds, and verifies actual PCM output plus the history-close
acknowledgement. It does not substitute for browser capture/playback checks.

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

# Local Assistant

Use the dedicated launcher for text chat, microphone dictation and Qwen calls:

```sh
npm run dev:assistant -- --check
npm run dev:assistant -- --unlimited-local --detach
```

The default address is `http://127.0.0.1:3118/`. Set `VOICE_PREVIEW_PORT` for a different port. The server binds only to loopback. Plain `next dev` does not install the local Qwen WebSocket bridge.

The launcher loads the standard Next.js development environment plus ignored `.env.agent.local`, `.env.voice-qwen.local`, and `.env.ai-text.local` files. Qwen requires separate text and voice keys, a workspace ID and explicit local approval flags. Credentials remain server-side; keep local secret files owner-readable only and never commit them.

The loopback-only development override routes microphone dictation to Qwen's
input transcription and Fast public chat to the restricted Qwen text model.
Dictation never sends `response.create`, retries, or stores recordings. Fast
chat uses owner-approved public MCP profile evidence and public catalog search;
it preserves the widget's existing streamed response and client history flow.
It is not a replacement for the Java workflow engine: Deep mode, attachments,
privileged actions, and agent run traces are not implemented in this local
adapter. Deployed routing remains unchanged.

Both new paths require the shared server-side spending policy to be enabled.
When it is paused or inaccessible they fail closed, before contacting Qwen.
The chat displays a distinct budget-paused, budget-exhausted or budget-check
error. Failed streams are marked `Request failed`, not `Completed`; raw
provider errors are never displayed or added to subsequent prompt history.
Following explicit approval on October 26, the $8/month policy is enabled.
Real Qwen transcription through `/api/rag/transcribe` passed using a synthetic
WAV, and a Chinese education question completed through the homepage widget.
Both requests settled in the ledger, and an over-budget reservation was denied.
This did not test physical microphone capture or every supported profile field.
The existing Qwen call bridge is configured but has not yet been migrated to
this new monthly ledger. Older production paths and historical provider spend
are not covered, so this is not yet a platform-wide $10 guarantee. Auto-reload
remains off. Deploying this code does not enable the local override in
production or switch the deployed text/transcription provider.

`--unlimited-local` removes only the local call-count and call-duration limits. Provider charges still apply. Production quota, authentication, origin and payload protections are unchanged. `--check` validates configuration without making a model request. An occupied port is reported before starting a second server.

Keep the checkout in a persistent workspace directory, not an OS temporary directory. Detached logs are written to `/tmp/portfolio-voice-local-3118.log` (with the chosen port substituted).

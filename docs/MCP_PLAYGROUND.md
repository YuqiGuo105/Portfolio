# Public MCP playground

The `/mcp-guide#playground` examples make real, anonymous JSON-RPC `tools/call`
requests to the existing stateless public `https://www.yuqi.site/mcp` endpoint.
They do not use an LLM, run a publish operation, or need an administrator session.

## Request boundary

`POST /api/mcp/playground` accepts exactly `{ "scenario": "projects" }`,
`{ "scenario": "kubernetes" }`, or `{ "scenario": "publishing" }`.
The browser cannot supply tool names, arguments, destinations, or credentials.

| Scenario | Fixed read-only tool | Output |
| --- | --- | --- |
| projects | `search_portfolio` | Top 3 distributed-systems project matches |
| kubernetes | `search_articles` | Top 3 Kubernetes technical articles |
| publishing | `get_project` | Content Intelligence Platform and its authored publication contract |

Publishing steps are parsed from the original project's Stage / Responsibility /
Guarantee table, not generated. If that table changes or is unavailable, the UI
shows a partial result and links to the source instead of inventing a workflow.
No raw upstream HTML is rendered. Restricted records expose public metadata and
sign-in links only; their bodies are not included. Trace output is a field-allowlisted
excerpt, not a raw upstream dump. Only canonical project/article source URLs pass.

## Limits and failure handling

- One upstream tool call per run, no automatic retries or calls on page load.
- Existing shared Valkey limiter: 6 runs/IP/minute and 60 total runs/minute.
  Its existing in-process fallback applies during cache outages or when unconfigured;
  that fallback is per instance, not a deployment-wide quota.
- Same-origin browser requests, JSON-only bodies, 1 KB body limit.
- Fixed public endpoint; redirects rejected; cookies and authorization never forwarded.
- 18-second upstream deadline; 128 KB response cap; 30-second function budget.
- Client cancellation propagates; matching JSON-RPC response ends an SSE read
  without waiting for socket closure. The browser also has a 22-second deadline.
- Results are not cached. Time shown is actual server-side tool elapsed time.
- Empty, partial, unavailable, rate-limited, timeout, and cancelled states are distinct.

## Verification

`node --test tests/mcp-playground.test.mjs` covers protocol parsing, terminal SSE,
source validation, restricted-body exclusion, fixed tool arguments, method/origin
checks, quotas, cancellation, timeout, and failure sanitization.

Browser verification must additionally run all three scenarios against the live
public tools; check sources, folded trace, stop/retry behavior, keyboard selection,
desktop/mobile overflow, and unchanged guide screenshots before release.

Run `node scripts/verify-mcp-playground.mjs http://127.0.0.1:3104` with Playwright
and Chrome installed. A shared Playwright runtime can be supplied through
`PLAYWRIGHT_MODULE`. Pass the production origin for the post-deployment smoke test.
Only the three live examples reach the server; failure cases use browser-local
response injection. Screenshots go to `PLAYGROUND_ARTIFACTS` (default
`/tmp/mcp-playground-verification`).

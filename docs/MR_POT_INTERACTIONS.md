# Mr. Pot page controls and execution records

Page-control and public execution-record contracts. Deployment verification is
recorded separately from local test results.

## Preview

Open `/mr-pot-lab` in development mode. The page exercises real page controls
without calling a model; its example execution record is explicitly a fixture.
The lab returns 404 in production mode.

Available actions:

| Action | Effect | Boundary |
| --- | --- | --- |
| `open_project` | Navigate to a project UUID | Existing published-content permissions apply |
| `diagram_step` | Open a workflow and select its numbered message | Five known workflows; target validates actual step count |
| `globe_city` | Move the globe camera to an approximate city center | No geolocation, visitor lookup or flag creation |
| `terminal_command` | Open the site terminal and run a command | Seven exact read-only commands; never an OS shell |

The agent classifies explicit requests into a validated `browser_actions` SSE
proposal. The browser validates it again, executes at most four actions in order,
and reports actual results. Suggested actions require a click. A failed action
stops the remaining plan; Stop next actions prevents further steps but does not
undo navigation or cancel a command already running. The widget lives above page
routes so navigation does not reset the conversation. Admin pages reject actions.

No arbitrary JavaScript, selectors, external URLs, writes or admin operations are
accepted. The existing intent-classification call is reused, without adding an
extra planning model call. Globe and terminal retain their lazy-loading behavior.
For mixed explanation-and-navigation requests, the knowledge answer is checked
before emitting actions. A failed output check never emits an action proposal.

## Execution record

This first version renders the **current answer's SSE events**, not historical
OpenSearch records. Only allowlisted stage names, status, duration and explicitly
reported usage fields enter the view. Standard answer generation includes provider
token receipts and a conservative per-step price estimate when the model's price
is known. This is not total run cost or an invoice. Evidence links are restricted to public
site/GitHub URLs. Prompts, raw arguments, internal reasoning and user identifiers
are omitted. Missing token/cost metrics are displayed as not reported, not zero.

Historical replay requires a separately authorized, session-bound read API and a
server-side public projection. There is deliberately no unauthenticated lookup
by run ID. Do not expose the existing private operations index.

## Architecture MCP

`GET /api/architecture/evolution` projects the checked-in public architecture
timeline into decisions, incidents and commit evidence. The companion MCP tool
`get_architecture_evolution` supports milestone/type filters and bounded results.
It uses a five-minute cache and does not invoke an LLM or private admin API.

The MCP guide links to public connection setup for Claude and ChatGPT. Installation
and any authorization still require confirmation in the chosen client; this is
not silent or automatic installation. Account/workspace availability may vary.

Publish the website endpoint before the MCP tool.
The Java agent change must also be running for natural-language page actions.
An unchanged remote agent will not emit the new action contract.

## Verification

- `npm run test:browser-actions`: validation, route readiness, replay privacy and
  architecture projection tests.
- `npm run test:browser-actions:e2e`: desktop/mobile controls, real local public
  history, project rendering, globe pixels, terminal and connector UI. It mocks
  answer SSE, tracking and client API calls; it is **not a real LLM end-to-end test**.
- Companion Java tests cover classifier-contract parsing and pipeline routing.
- Companion MCP tests cover SDK discovery/call, caching and response projection.

No paid provider call is required by these tests. The project-rendering check uses
the existing local server's published-content configuration; do not print or
commit credentials. `PREVIEW_URL` and `PLAYWRIGHT_MODULE` can select another local
server/runtime for the browser checks.

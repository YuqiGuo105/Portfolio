# Mr. Pot page controls and execution records

Page-control and public execution-record contracts. Deployment verification is
recorded separately from local test results.

## Preview

Open `/mr-pot-lab` in development mode. The page exercises real page controls
without calling a model; its example execution record is explicitly a fixture.
It also shows every look Mr. Pot has, one button each (see `docs/CHAT_WINDOW.md`).
The lab returns 404 in production mode.

## The guide's Mr. Pot

The figure that leads the Vibe Guide (`src/components/SiteTour.js`) is the illustration
`public/assets/images/mr-pot-tour-guide.png`, cut into parts that turn on their joints. His
face and steam are drawn over it as shapes measured from the illustration, so at rest the
picture is unchanged and in motion he can blink, look, talk and let off steam.

| File | Holds |
| --- | --- |
| `src/lib/tourPetRig.mjs` | How he moves: springs per joint, the walk, the jump, being carried, his performances. No DOM, no timers |
| `src/lib/tourPetDrawing.mjs` | The measurements of the illustration and the shapes for one frame |
| `src/components/tour/TourPetFigure.js` | The SVG; `draw(pose)` touches only attributes that changed |
| `src/components/tour/useTourPet.js` | One rig on one animation loop: every frame while he travels, every other frame at rest |
| `src/components/tour/TourPet.js` | The guide: where he stands (`placeTourPet`), dragging, the caption, the sparkle button |
| `src/components/tour/TourArrival.js` | The opening screen he walks onto |

How he gets about:

- A short way on the level is walked, with the legs in time with the ground covered. Anything
  further or steeper is a jump: a crouch, an arc, a landing that rattles the lid.
- A new chapter that leaves him on the same spot still gets a jump on the spot.
- A page that scrolls under him carries him; he only sets off again if his spot gets more than
  half a body width away.
- From the opening screen he jumps to the first section from where he stood, coming down to
  his own size on the way.
- In a visitor's hand he hangs from the pointer and stays where he is put down.
- With reduced motion he is placed and holds still.

What he does besides:

- Ten performances take turns while a visitor reads: curious, dance, stretch, tiphat (he tips his
  lid), happy, boil (the lid rattles until it lets go), balance, spin, sleepy, greet. The sparkle
  button answers with the showier ones, a flip head over heels among them.
- He bows when he has finished narrating a chapter, goes head over heels on reaching the last
  one, skips when clicked and perks up when the pointer comes to him.
- Standing still he blinks, looks at the section, the visitor or the pointer, shifts his weight,
  taps a foot, rocks on his heels, lifts his lid a crack and watches his steam.

Three things worth knowing before changing him:

- The cuts decide whether he stays whole when a part moves. The dark line between the hanging arm
  and the body is in both layers: the body keeps its side, the arm has an inner edge. The hand
  belongs to the arm alone, the chin to the head alone and the line of the belly to the body alone.
  Under everything lie a neck, skin over each hip and the start of each inner leg line: hidden at
  rest, they are what shows when a part swings away. Arms may swing far; legs turn at the hip and
  are kept within about twelve degrees. `tests/pet-motion.browser.mjs` checks who owns which pixels.

- His eyes never change shape. A lid comes down over them, and its edge is the line of a closed
  eye: curved down for a blink or a doze, up for a beam.
- The springs are advanced in steps of at most 1/120 s (`SPRING_STEP`). At rest he is stepped
  every other frame; without the shorter steps the eyelid spring overshoots further on each one
  and the eyes flutter after a blink. `tests/tour-pet.test.mjs` holds him to that.

Try every move without starting the guide on `/mr-pot-lab` (section "Mr. Pot / the guide").
Checks: `tests/tour-pet.test.mjs` runs with `npm test`; `tests/pet-motion.browser.mjs` drives a
real browser against a running dev server (`TEST_ORIGIN=http://127.0.0.1:3168/`).

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

## Site guide MCP

`src/lib/siteGuide.mjs` is the one list of the site's sections: key, anchor, name, what the
section shows and the words people use for it. The web guide's targets and the voice call's
destinations are read from it. `GET /api/site/guide` serves it (public text and links to this
site only, cached for five minutes), and the companion MCP tool `get_site_guide` serves that
endpoint to AI clients, with an optional `topic` for the section that answers a request.

The voice relay reads the guide the way any other client does, through `get_site_guide`, when
a call starts. The answer is kept for five minutes; the relay waits four seconds at most and
then works from its own copy of the list. Only the wording is taken from the answer, and only
for sections the build already knows: where a section points never comes from the network.
The relay's `voice_closed` log line says which one a call used (`guide: mcp` or `built_in`).

During a call `navigate_section` brings a section into view:

| Where the visitor is | What happens | The model is told |
| --- | --- | --- |
| The home page | The page scrolls to the section and its heading glows. The call goes on, and the dialog names the section for a few seconds | `shown` |
| Any other page | A button is offered. Following it leaves the page and ends the call, as before | `offered_waiting_for_user` |

Only a scroll happens without a click: the address does not change and no page is loaded.
A relayed call ends when the page changes, which is why the home page's own sections are the
only ones shown in place.

Release order: the website first (the endpoint, and a browser that understands
`mode: "show"`), then the MCP tool, then the voice relay. Until the tool is published the
relay works from its own copy of the list; an older relay keeps offering the button.

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

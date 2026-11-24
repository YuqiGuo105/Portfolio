# Chat window

How the Mr. Pot chat window is put together, and how to look at every state of it without a model.

## Preview

```sh
npm run dev:chat
```

Opens `http://127.0.0.1:3168/` with a stand-in assistant: canned answers, no keys, no model calls, nothing stored. Voice input records for real and returns a canned transcript; attached files go nowhere.

| Type this | To see |
| --- | --- |
| `介绍一下 Yuqi 和他的社交账号` | A list of links as aligned rows with icons, sources, the guide offered on the action line |
| `How is the platform built?` | Headings, a numbered list, a table, a quote, a code block |
| `Show me his projects` | Links to pages of this site |
| `带我逛一下` | The guide as a message of its own |
| `Show it on the page` | Page controls offered with an answer |
| `Use a tool`, `Slow test`, `Error test` | A tool call, the progress line, a failed answer |
| Deep mode, any question | The steps of a Deep answer while it works, then in the record under the answer |

`CHAT_PREVIEW_LINE=queued npm run dev:chat` (or `full`) shows the waiting-line notices.

## Parts

| Part | Where |
| --- | --- |
| Window, state, streaming | `src/components/ChatWidget.js` |
| An answer's text: prose, link rows, code, tables | `src/components/chat/AnswerMarkdown.js`, `linkMeta.mjs`, `LinkGlyph.js` |
| The line while an answer is prepared | `src/components/chat/AnswerProgress.js`, `ResearchSteps.js` |
| The line under a finished answer: sources, record, guide, copy | `src/components/chat/AnswerFooter.js`, `src/lib/chatRunSummary.mjs` |
| Attached files | `src/components/chat/AttachmentChip.js`, `fileMeta.mjs` |
| Mr. Pot | `src/components/MrPotAvatar.js`, `src/lib/mrPotRig.mjs` (how he moves), `src/lib/mrPotDrawing.mjs` (how he is drawn) |
| Voice input | `src/components/VoiceInput.js` |
| Page controls | `src/components/BrowserActionPlan.js` |
| Waiting line | `src/components/chat/ChatAdmission.js` |

## Rules the layout follows

- An answer is text on the surface, not a box. Nothing is parked between the question and the answer: the plan and steps of a Deep answer show under the progress line while it works and move into the record afterwards.
- One line of actions under an answer, one panel open at a time.
- The web guide is one message. The card appears in the welcome and in a reply that is only the offer; a reply with its own text offers the guide as an action on its line.
- A bullet list in which every item is one link becomes rows: icon, name, readable address. Mixed lists stay lists.
- An attached file is the same card while it uploads, when it is ready and when it failed, so the tray does not change height.
- A finished answer can be rated. See "Rated answers" below for what is kept.

## Rated answers

Rating an answer does two things.

1. One anonymous widget action (`answer_liked`, `answer_disliked`, `answer_rating_cleared`) joins the visitor's session timeline in the admin. It carries nothing else.
2. The window posts `{ runId, verdict, sessionId, page }` to `/api/rag/answer/feedback`. No answer text leaves the browser. The route reads the run from the agent service's own history (`/api/admin/conversations`, with the internal token), checks that the run belongs to the session that is rating it, and stores a frozen copy in Supabase `chat_answer_feedback`: question, answer, route, safety checks, retrieval query and sources, models, prompt versions, tokens, cost and timings. A changed verdict replaces the earlier one; taking the rating back deletes the row.

The copy is frozen so that it stays as it was whatever happens to the agent's history later. What it does not hold, because the agent service does not record them: the text of the retrieved chunks (only their IDs) and the fully rendered prompt (only its version).

`/admin/conversations` marks rated runs, lists them under "Rated answers", and downloads them as JSONL: one line per answer with question, answer, verdict, prompt versions, models, retrieval query and sources, safety verdicts, latency and cost. That file is the regression set.

Setup: run `supabase/migrations/20261124180000_chat_answer_feedback.sql`. The rating changes only after the server confirms persistence; requests for the same answer cannot overlap. A missing table or failed request leaves the previous rating unchanged and shows an error. Anonymous rating telemetry is emitted only after success. Changing a verdict preserves the first frozen snapshot; JSONL exports include token usage and safety reasons. The route needs `AGENT_SERVICE_URL` and `AGENT_SERVICE_INTERNAL_TOKEN`, which the chat already uses. Limits: 12 ratings a minute per address; a run can be rated for 30 days, the reach of the agent's history search.

Code: `src/lib/chat/answerFeedback.mjs`, `pages/api/rag/answer/feedback.js`, `pages/api/admin/chat-feedback.js`. Tests: `tests/chat-answer-feedback.test.mjs` (the SQL part runs when `DISCOVERY_PGLITE_MODULE` points at PGlite).

## Mr. Pot

He is an SVG drawn after `chatPot.png`. Each part that moves on its own (body, lid, handles, brows, pupils, mouth, steam) is a spring pulled toward what the current look asks for, and his habits fire at random intervals, so nothing repeats on a fixed period. All of it runs on the rig's own clock: no timers, and no work while he is off screen, the tab is hidden or reduced motion is set.

| Look | When |
| --- | --- |
| `idle`, `listening`, `thinking`, `searching`, `working`, `speaking`, `success`, `error` | The state of the conversation, from `getMrPotState()`. He also listens while the message box holds text. |
| `hello` | The pointer comes over him. |
| `curious` | The first character typed into an empty message box. Every keystroke after that is a nod. |
| `surprised` | A file is dragged over the window. |
| `shy` | An answer is rated up. A dislike, a rating taken back and copying play nothing; a dislike only ends the blush if it is still showing. |
| `wink` | An answer ends by offering the web guide. |
| `sleepy` | The window has sat idle for 90 seconds. Any keystroke or pointer movement wakes him, with a small stretch. |
| `puzzled`, `sorry` | Drawn and tested, not triggered by anything. |

When he speaks, the closed smile itself opens: the lower lip drops in a round curve and the upper lip flattens, so there is no jump between closed and open. Speech runs in phrases of three to seven syllables with a breath between them, each syllable a little wider or rounder, and his head nods once per phrase, not per syllable.

A reaction plays only while he is at rest, listening, or has just finished an answer; a new answer always takes over. The launcher is the box it has always been (white, a 12px corner, the orange outline, "Mr.Pot" beside him): `styles/chatWidget.css` and the site theme draw it and `chatWidgetParts.css` only gives it its size. He is alive in it, drawn every other frame because the launcher is on every page, says hello when the button is hovered or focused, and never nods off there. `/mr-pot-lab` in development shows every look.

The drawing's window is centred on the pot itself (lid knob to base, handle to handle), not on the pot and its steam, so centring the avatar's box centres him and no size needs an offset of its own. `tests/mr-pot-avatar.browser.mjs` fails if he sits off the middle of his place in the launcher.

## Styles

Four sheets, imported in this order in `pages/_app.js`:

1. `styles/chatWidget.css`: the original sheet. Only position and base geometry still come from it.
2. `styles/chatWidgetModern.css`: colours (`--cwm-*`), window, header, bubbles, message box.
3. `styles/chatWidgetAnswer.css`: everything inside an answer.
4. `styles/chatWidgetParts.css`: launcher, attached files, drop target, notices, Deep steps, page controls, key terms.

Sheets 2 to 4 start every selector with `#__chat_widget_root#__chat_widget_root`. The site theme styles every `<button>`, `<p>`, `<code>`, `<blockquote>` and list on the page; the doubled id is what outranks it, and the tests fail a selector without it. New buttons need their size, padding, `::before` and hover colour spelled out for the same reason. The launcher's `display`, position and margin are left to the page, because the site terminal hides it and dragging moves it.

## Tests

- `tests/chat-answer.test.mjs`, `tests/chat-modern.test.mjs` (in `npm test`): link rows, the record, Deep steps, file cards, the style rules above, contrast.
- `tests/mr-pot-motion.test.mjs` (in `npm test`): every look stays inside the drawing, the mouth stays small, thinking never settles into a loop, reactions give way to answers, reduced motion holds still.
- Browser checks, each against a running preview: `chat-sources`, `chat-reasoning-layout`, `chat-stream`, `chat-compact-layout`, `chat-input`, `chat-drop`, `chat-math`, `mr-pot-avatar` (`tests/*.browser.mjs`), for example

```sh
CHAT_TEST_URL=http://127.0.0.1:3168 node tests/chat-sources.browser.mjs
```

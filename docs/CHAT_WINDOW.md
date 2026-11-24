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
| Voice input | `src/components/VoiceInput.js` |
| Page controls | `src/components/BrowserActionPlan.js` |
| Waiting line | `src/components/chat/ChatAdmission.js` |

## Rules the layout follows

- An answer is text on the surface, not a box. Nothing is parked between the question and the answer: the plan and steps of a Deep answer show under the progress line while it works and move into the record afterwards.
- One line of actions under an answer, one panel open at a time.
- The web guide is one message. The card appears in the welcome and in a reply that is only the offer; a reply with its own text offers the guide as an action on its line.
- A bullet list in which every item is one link becomes rows: icon, name, readable address. Mixed lists stay lists.
- An attached file is the same card while it uploads, when it is ready and when it failed, so the tray does not change height.

## Styles

Four sheets, imported in this order in `pages/_app.js`:

1. `styles/chatWidget.css`: the original sheet. Only position and base geometry still come from it.
2. `styles/chatWidgetModern.css`: colours (`--cwm-*`), window, header, bubbles, message box.
3. `styles/chatWidgetAnswer.css`: everything inside an answer.
4. `styles/chatWidgetParts.css`: launcher, attached files, drop target, notices, Deep steps, page controls, key terms.

Sheets 2 to 4 start every selector with `#__chat_widget_root#__chat_widget_root`. The site theme styles every `<button>`, `<p>`, `<code>`, `<blockquote>` and list on the page; the doubled id is what outranks it, and the tests fail a selector without it. New buttons need their size, padding, `::before` and hover colour spelled out for the same reason. The launcher's `display`, position and margin are left to the page, because the site terminal hides it and dragging moves it.

## Tests

- `tests/chat-answer.test.mjs`, `tests/chat-modern.test.mjs` (in `npm test`): link rows, the record, Deep steps, file cards, the style rules above, contrast.
- Browser checks, each against a running preview: `chat-sources`, `chat-reasoning-layout`, `chat-stream`, `chat-compact-layout`, `chat-input`, `chat-drop`, `chat-math` (`tests/*.browser.mjs`), for example

```sh
CHAT_TEST_URL=http://127.0.0.1:3168 node tests/chat-sources.browser.mjs
```

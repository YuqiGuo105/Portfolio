# The chat's waiting line

The assistant answers a limited number of people at once and has a daily spending limit. Without
a line, whoever sends a message at the right moment gets through and everyone else fails at
random. The line makes it first come, first served.

## How it works

- Opening the chat asks for a **place**. There is a fixed number of places; a place lasts for a
  set time and a set number of messages, and that many messages are reserved from the day's
  allowance when the place is given. Someone who holds a place is not cut off part-way by people
  arriving later.
- When every place is taken, later visitors **wait in arrival order**. The chat shows how many
  people are ahead and a rough wait, and starts by itself when their turn comes. They can write
  their question while they wait; it is not sent until they hold a place.
- When the day's allowance cannot cover another place, newcomers are told that today's places are
  taken and are pointed to the message form. Unused messages go back to the allowance when a
  place ends, so a place may open again later the same day.
- Closing the chat while waiting gives the spot back. A visitor who stops checking in drops out
  of the line after 25 seconds; one who is promoted has 45 seconds to show up.
- The owner (a signed-in admin) never waits.

The rules are one pure function, `applyAdmission` in `src/lib/chat/admission.mjs`. The state is a
single small document changed with compare-and-set: in Valkey when it is configured, otherwise in
the memory of one process. If the store cannot be reached the message goes through: a broken line
must not take the chat down.

A visitor is one browser (the widget's device id). The network is kept only as a short salted
hash, so one network cannot take many places by inventing ids.

## Where it applies

`POST /api/rag/admission` is what the widget talks to. `POST /api/rag/answer/stream` checks the
place before a message is passed to the agent service and counts the message. Voice, the web
guide and the other chat endpoints are not behind the line; the agent service's own daily budget
remains the hard limit for everything.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `CHAT_PLACES` | 30 | Places at once. The agent service answers about 32 requests at a time. |
| `CHAT_PLACE_SECONDS` | 600 | How long a place is held. |
| `CHAT_PLACE_MESSAGES` | 15 | Messages per place. |
| `CHAT_DAILY_MESSAGES` | 900 | Messages a day that places may reserve in total. Keep it under what the agent's daily budget covers (about 1,000 standard replies at 2 USD). |
| `CHAT_LINE_LIMIT` | 200 | Where the line stops growing. |
| `CHAT_PLACES_PER_NETWORK` | 3 | Places plus spots in line one network may hold. |
| `CHAT_ADMISSION` | on | `off` removes the line. |

Tests: `node --test tests/chat-admission.test.mjs`. To see it locally:
`CHAT_PLACES=1 CHAT_PLACE_SECONDS=30 npm run dev:talk`, then open the chat on the home page in two
browser windows (a private window counts as a second visitor).

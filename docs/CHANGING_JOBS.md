# Changing jobs

The site learns the current employer from one place: the work history (the `experience` table).
The current role is the row whose period ends in "Current" or "Present", for example
`Dec 2024 - Current`. No file, setting or prompt names an employer.

## What to do

Open **/admin/experience** and fill in "I changed jobs": the last month at the old company, then
the new company, title and first month. That is the whole change. Leave the new role empty if
you have left and not started anywhere yet; add it later with the same form.

The form makes two edits and publishes them:

1. the old role's period gets its end month (`Dec 2024 - Mar 2027`);
2. the new role is added as the open-ended one (`Mar 2027 - Current`).

Subscribers who follow job updates are emailed about the new role only if the box is ticked.
The old role ending is never announced.

## What follows by itself

| Where | What changes | When |
| --- | --- | --- |
| Home page introduction | "I am a {title} at {company}" | at once (page regenerated), otherwise within 5 minutes |
| Home page "about" paragraph | the paragraph written for one employer is replaced by a general sentence built from the new role | same |
| Structured data (JSON-LD `worksFor`, `jobTitle`) | new employer; left out between jobs | same |
| `/llms.txt` | "a backend software engineer at {company}" | within an hour (its cache) |
| Referral form on `/talk` and the home Contact section | "Ask for a referral at {company}"; closed between jobs | at once |
| Referral requests already received | kept, marked "a previous employer" in `/admin/referrals` | at once |
| Site search | the two roles are re-indexed | seconds to minutes (indexing job) |
| Assistant (Mr. Pot) and the MCP `get_profile` tool | answers come from the re-indexed work history | seconds to minutes (indexing job) |
| Keyword fallback search of the assistant | employer names come from the work history at query time | at once |

Publishing is what queues the search and assistant indexing. `/admin/jobs` shows those jobs; a
role can be published again by saving it in the "Roles" list on `/admin/experience`.

## What does not follow, and needs a look

- The home page "about" paragraph: after a change it shows a correct general sentence. A
  paragraph written for the new role has to be written (it is content, in `pages/index.js`).
- An employer home page for structured data: add it to `EMPLOYER_URLS` in
  `src/lib/currentRole.mjs`, or the employer is published by name only.
- The résumé (`/cv`), the private application profile, LinkedIn and GitHub: these are separate
  documents. The site does not rewrite them.
- Old chat answers stored as "legacy" knowledge records name past employers. They are not used
  for answers (only active, reviewed records are), so nothing has to be done; they can be
  archived on `/admin/knowledge`.
- Whether to take referral requests at the new company from day one: the switch on
  `/admin/referrals` pauses the form without a deploy.

## If the work history is edited somewhere else

Editing the `experience` table directly (for example in the Supabase table editor) changes the
site within five minutes, because pages read the table. It does **not** queue the search and
assistant indexing, so the assistant can keep the old text. Save the role once on
`/admin/experience` to publish it, or use "Re-read work history" on `/admin/referrals` to
regenerate the pages at once.

## Trying it locally

`npm run dev:talk`, then http://127.0.0.1:3147/admin/experience-preview. The preview keeps a
made-up work history in memory: record a change there and open `/talk`, `/` and
`/admin/referrals-preview` to see them follow. `TALK_COMPANY="Some Company" npm run dev:talk`
starts the preview at another employer, `TALK_COMPANY=none` between jobs.

# Local media placement review

The source baseline is production commit `341684f`. The media-service frontend
has been brought over from the existing local media work, not rebuilt as a new
backend. No production content or database schema is modified in this checkout.

- Home: the reference HTML's dark `Watch the 60-second intro` button directly
  below the introduction. The redundant portrait badge has been removed. Clicking loads
  the captioned intro in a separate floating modal. The portrait remains unchanged.
  No `Watch demos` link under projects.
- `/demos`: retained as a direct review route, not the homepage entry.
- Project covers: opt-in, muted six-second preview on a fine-pointer hover.
  Leaving, hiding the tab or leaving the viewport unmounts the video. Touch,
  reduced-motion and data-saving users keep the original cover.
- Article detail: an inline video for that article, click-to-play, plus chapter
  buttons. Existing database media references are resolved through `media_public`
  for project and tech-blog pages. The life-blog integration is not in this release.
- `/admin/media`: the existing authenticated upload, processing and retry UI.
- `/admin/media-preview`: local-only read-only view of the same library UI,
  populated with the intro, five project samples and three technical blog samples.
  No admin session is bypassed. Life has no new sample videos or hover previews.

Portfolio Platform uses the original real-page recording. The revised samples are:

- Open Source (6s): actual GitHub overview captures for eight merged PRs, 0.75
  seconds each, showing titles and Merged badges rather than code diffs. Each
  chapter has an Open PR link. GitHub API confirmed YuqiGuo105 as author and
  `merged: true` on 2026-11-23: RxJava #8399; Google ADK Java #1381 and #923;
  Kubernetes Java Client #4868, #4751 and #4746; Spring AI Alibaba #4491;
  Google LangExtract #385.
- Content Intelligence (24s): a locally rendered architecture animation of publishing,
  the Postgres/outbox transaction, relay, Kafka and independent search/RAG projections,
  ending with search results and a source-grounded AI answer. The content and answer
  are illustrative, not a real production publish or a live AI call. The architecture
  follows the project's stored article and admin-service architecture specification.
- TalkNest (14s): an edited sequence of captures from the actual running application at
  `https://talknest-refresh.onrender.com/`, using its interactive preview mode. Sample
  messages stay in that tab; call controls have no live connection, camera or microphone.
  It no longer shows GitHub. This is not an uninterrupted screen recording.
- Subscription (10s): the approved footage, poster and hover file remain byte-identical.
- Technical blogs (24s each): GitHub operations, Docker/Kubernetes and E2E testing.
  These are explicitly labeled concept animations, not recordings of real deployments.
  Each has its own article player, chapters and six-second cover preview.
  The whole homepage technical-blog card triggers the preview, including its text
  area; copy and decorative overlays clear during playback. Life is unchanged.

The 60-second intro incorporates the new segments and updated English captions.
No real message, referral, subscription or call was sent. Original project covers remain.
The `LOCAL_DEMOS` mapping is a development review fixture, disabled in production;
it is not a production media publishing mechanism.

The Open Source article update is a local JSON publication draft with grouped,
concise contribution summaries. It preserves the original case studies and Mermaid
diagrams. The development loader only overlays the matching database revision;
production and hosted previews cannot apply it. No database article was updated.

The loopback recording server blocks mutations and production admin APIs. The
local library review is not an upload-to-transcode E2E test or a production
deployment. The original media-service worktree and its test output are retained.

## Playback quality

All nine full-length local samples have genuine 720p, 480p and 360p MP4 variants.
Article players, the intro and local library preview share one custom player:
central play, chapter-segmented progress, time, captions when available, an in-frame
quality menu, picture-in-picture and fullscreen where supported by the browser.
Auto selects an existing MP4 rendition using viewport size and available network /
data-saving hints. This is not continuous throughput-based HLS adaptation.
Only the selected rendition is mounted after play; alternate files are not prefetched.
Switching preserves time, play/pause state and rate on the same video element.
Hover previews remain lightweight and control-free. They do not download full renditions.

The generators are `scripts/render-media-revisions.mjs` and
`scripts/render-tech-blog-demos.mjs`. They use the installed FFmpeg and
the bundled Node canvas package (override `FFMPEG_PATH` / `CANVAS_MODULE` if needed).
`--stills` renders review images only; `--manifest-only` refreshes rendition metadata
without encoding. The compatibility build script invokes this generator, so it cannot
accidentally restore the obsolete source-code clips. The GitHub API verification
and article draft update are in `scripts/update-local-contributions.mjs`.

## Verification for this revision

- 50 media, placement, library, footer, header and article draft tests pass. The five changed player/hover
  components pass focused lint without warnings; homepage lint retains existing
  image and text warnings. The production build passes.
- Chrome: intro is exactly 60 seconds; captions show; pause, Escape, close and
  focus return work without opening the portrait's GitHub link.
- FFprobe validates dimensions and duration of all 27 selected rendition files.
  Content Intelligence is 24 seconds, Open Source and its hover clip are 6 seconds, TalkNest 14 seconds,
  technical blogs 24 seconds each, intro 60 seconds.
- Chrome: switching the playing intro to 360p loads a 640x360 file and keeps
  playing. Switching back to 720p while paused retains exactly 13.9553 seconds.
  The 320px TalkNest player automatically selects its real 360p rendition;
  selecting 480p loads an 854x480 file and retains the paused state.
- Contribution article checked at 390px and 320px without horizontal overflow.
  The 320px intro dialog fits the viewport; quality choices stay within the player.
  Escape first closes the quality menu without closing the modal; a subsequent
  Escape closes the modal and returns focus to the main launch button.
- Chrome: a pointer click on the homepage blog description triggers its hover
  clip, clears the copy overlay, and plays the actual file. Leaving the card stops
  it; the Life tab has no video. The portrait has no intro badge on desktop/mobile.
- Fullscreen was rejected by the controlled browser and shows an explicit
  unavailable status. Native fullscreen and picture-in-picture remain unverified
  in this environment. Existing local stories/monitoring requests return 503;
  these are separate from the media paths and were not changed.
- All three technical blog players loaded in Chrome with 24-second duration;
  local media library shows nine assets and opens the contribution player.
- Intro is about 2.13 MB at 720p, 1.19 MB at 480p and 0.78 MB at 360p. Content
  Intelligence, TalkNest and Open Source are 416 KB, 301 KB and 455 KB at 720p.
  The three technical blog clips are 172 KB, 233 KB and 191 KB at 720p.
  Encoding happens offline; no animation runtime or extra cloud calls are added.

## Production release

`scripts/publish-approved-media.mjs` explicitly uploads the approved source videos
through the authenticated media API, waits for processed HLS, uploads the reviewed
presentation renditions, and attaches only READY assets to `media_presentations`.
It requires an explicit release confirmation and keeps credentials out of its
checkpoint. Production pages read the public READY-only catalog during SSR/ISR;
they never enable the local fixture flag. Cloud deployment and browser acceptance
must be verified separately from the successful local E2E and production build.

# Introduction upload handoff

## Administrator flow

Open `/admin/media-intro` from Media library. Sign in with the existing Google
administrator account, create a request, select a video and approve **Upload &
replace Introduction**. A Google account alone does not grant administrator access.

The browser uploads directly to the existing signed storage URLs. After upload
completion, the existing media worker transcodes and validates the file. The
existing recovery scheduler then replaces `yuqi-intro` only when the asset is READY.
The browser and AI conversation can close after upload completion. The homepage's
existing five-minute revalidation remains unchanged.

## External AI flow

An authorized ADMIN MCP client calls `media.prepare_presentation_upload` with a
stable UUID `requestId`, placementKey `yuqi-intro`, and title. It receives a job ID
and protected browser upload URL. Retry with the same payload and UUID to recover
the same request. `media.get_presentation_job` and `media.list_presentation_jobs`
report progress; `media.cancel_presentation_job` cancels the replacement, retaining
the uploaded asset.

Clients with a stale tool catalog can use the stable `/admin/media-intro` entry
returned by `connection.check`. A reconnect can refresh their tool list, but is
not needed to use the browser upload path. Website sign-in does not bypass the
external client's separate OAuth consent. Neither a job URL nor its UUID is an
authentication credential.

## Safety and operations

- Request lifetime: 24 hours; at most 20 unexpired pending requests.
- Upload approval requires a verified administrator JWT, not an internal MCP actor
  header. Server-side role authorization is checked again before publishing.
- Revision conflicts, failed processing, cancellation, expiry and revoked admin
  access leave the current Introduction unchanged.
- The prior asset is retained. Publishing and its audit are transactional;
  duplicate completion or recovery does not republish the same job.
- The new table has RLS enabled and no PUBLIC/anon/authenticated Data API access.
- No new server, credential or scheduler. Processing uses the existing pipeline
  and limits. Uploading/transcoding still incurs the existing storage/compute costs.
- Only an open, visible pending-job admin page polls status. The public homepage
  gains no polling or new media downloads from this capability.

## Delete a processed video's original

In `/admin/media` select a video, or open its current Introduction in
`/admin/media-intro`, then choose **Delete original**. The server checks that it
is READY, has a complete playback manifest and has no active processing jobs.
Confirming removes only the private uploaded source from active storage. Playback
renditions, captions, article references, placement history and `yuqi-intro` stay
unchanged. Re-transcoding requires another upload; this action cannot be undone in
the application. Storage-provider retention can delay final erasure.

Authorization and eligibility are checked again on confirmation. A conflicting
edit requires a fresh check; a failed deletion can be retried against the same
source. The operation is audited. The action performs no requests until clicked
and adds no visitor-side polling. It requires the admin API's original-deletion
capability; local/read-only media previews do not expose it.

## Verification

The Java `MediaPresentationJobsTest` covers permissions, idempotency, conflict,
expiry, cancellation, revocation and audit rollback. The `media-e2e` profile uses
real PostgreSQL, Kafka, multipart object storage and FFmpeg/libvips, plus the same
JavaScript uploader used by the browser, to verify upload, retries, transcode,
READY and automatic replacement. Browser UI checks are additional, not a substitute
for this pipeline test. This capability release does not replace production media.

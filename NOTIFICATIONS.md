# Notifications

Next.js owns the subscription dialog, website inbox and browser Service Worker.
The standalone `portfolio-notification-service` owns preferences, publication
events, email delivery and encrypted Web Push delivery.

## Reading invitation

On the homepage, **15 seconds of foreground reading OR reaching My Background OR 25% scroll progress**
qualifies. The heading (`#tour-background`) must reach the upper 75% of the viewport
after scrolling; this stays aligned when images or mobile layout change page
length. The 25% fallback also works if the heading is delayed or unavailable.
Public blogs and project pages keep **15 seconds OR 25% scroll progress**.
The scroll threshold is evaluated immediately on scroll, without waiting for a
pause or debounce. Continued scrolling cannot defer an eligible invitation.
Restored scroll positions are checked on initialization and each timer tick.
Hidden overlays do not block the invitation.
Time spent in hidden tabs, search, chat, a tour or form editing does not count.
Admin, authentication, CV and private life-blog routes are excluded.

Actually mounting the dialog saves a seven-day cooldown in
`portfolioSubscriptionPrompt:v1`. Existing locally stored subscribers are skipped.
When storage is unavailable, suppression lasts for the current document. The bell
can always open the form manually. The invitation never submits a subscription
or requests browser permission automatically.

Local development previews bypass only the cooldown by default, so refreshing
the normal homepage supports repeated tests. Use `/?subscriptionPreview=0` to
test the production cooldown policy locally. `/?subscriptionPreview=1` remains
supported. Existing-subscriber suppression remains, and all query values are
ignored in a production build. Local diagnostics include the route,
preview/cooldown/subscriber booleans, trigger reason, elapsed foreground time and
scroll percentage, never subscriber identifiers or tokens.

The mobile form uses a bottom sheet with a separately scrolling body, a visible
header/action footer, safe-area padding and a 16px email field. Its height follows
the visual viewport when a phone keyboard opens. No subscription is created
until the visitor explicitly submits the form.

## Delivery surfaces

- **Email:** the existing email worker delivers selected topics.
- **Website inbox:** the bell loads authorized `/api/notifications` data when
  opened, on focus/reconnection and every 60 seconds while visible. Subscriber
  changes update it immediately. There is no direct Supabase Realtime access.
- **Browser notifications:** a separate, explicit enable button requests browser
  permission and registers this device. Closing the page does not remove that
  registration. Browser/OS notification settings still apply.

The `WEB` preference covers inbox and eligible browser notifications. Selecting
it alone does not grant permission. Email-only subscriptions cannot register push.
Topic changes and unsubscribe are rechecked before delivery. Turning off push on
one device leaves email/inbox unchanged. On iOS/iPadOS, push requires a supported
Home Screen web app. Unsupported contexts show an explanation, not false success.

## Configuration

Next.js requires these server-only environment variables:

```text
NOTIFICATION_SERVICE_URL=https://<notification-service>
NOTIFICATION_SERVICE_TOKEN=<same value as backend INTERNAL_API_TOKEN>
```

The browser calls same-origin `/api/subscriptions*`, `/api/notifications*` and
`/api/push/*`. The proxy injects `X-Internal-Token`. Responses are not cached.
Supabase public/service-role keys are not used by the notification UI.

Push additionally requires backend migration `V8__browser_push.sql` and:

```text
WEB_PUSH_PUBLIC_KEY=<base64url uncompressed P-256 public key>
WEB_PUSH_PRIVATE_KEY=<base64url P-256 private scalar>
WEB_PUSH_SUBJECT=mailto:<operational contact>
```

Store one stable VAPID key pair in the backend secret management system. Only the
public key is returned by `/api/push/config`; never use `NEXT_PUBLIC_*` for the
private key. Existing registrations depend on that key pair, so rotation needs
planning. Missing keys disable push without disabling email/inbox.

See the backend `WEB_PUSH.md` for rollout requirements. Frontend-only deployment
does not enable push. The existing five-minute recovery job also drains browser
push, waking the scale-to-zero backend even when nobody has the website open.

## Flow and security

```text
Explicit subscription -> subscriber credentials -> prepare Service Worker
Enable click -> browser permission -> PushManager subscription
  -> token-verified device registration -> UI confirms enabled

Public content event -> selected WEB recipients -> durable per-device delivery
  -> encrypted provider request -> Service Worker -> system notification
  -> notification click opens same-origin content
```

`/notifications/sw.js` handles push/click events only. It has no fetch handler and
does not cache pages/APIs. Payloads contain public previews, not email addresses,
credentials or administrator alerts. Endpoint/key tables have RLS and no anonymous
grants. Subscriber tokens remain bearer credentials in localStorage, matching the
existing subscription design. Never log them or expose them in screenshots.

## Verification

```bash
npm test
TEST_ORIGIN=http://127.0.0.1:3105 node tests/subscription-prompt.browser.mjs
TEST_ORIGIN=http://127.0.0.1:3105 node tests/browser-push.browser.mjs
```

Set `PLAYWRIGHT_MODULE_PATH` when Playwright is not installed in the project.
Browser tests use isolated profiles and mocked subscription/provider APIs. They
do not email or push real subscribers. The closed-page test uses real Chrome
Service Worker/notification APIs with a local CDP push event after closing the
website. It verifies browser behavior, not real-provider delivery.

A release still needs an authorized real-device test: register only the owner's
test device, close the page, send one targeted public preview, check the delivery
ledger and observe the system notification. Never broadcast fake publications
or insert fake production inbox records as default tests.

`SENT` means provider acceptance, not a read receipt or proof of OS display.
Permissions, Focus/Do Not Disturb and browser policies can suppress display.
Closing a page and forcibly terminating a browser are not equivalent guarantees.

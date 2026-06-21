# Notification System (frontend integration)

The notification UI in this repo is **just the components and Next.js proxy routes**. All backend logic — REST APIs, Kafka consumer, email dispatch, Supabase writes — lives in the standalone Spring Boot service at [`portfolio-notification-service`](../portfolio-notification-service).

## 1. Env vars (Vercel + local `.env`)

Add to `.env.local` and to the Vercel project:

```bash
# Already present in your .env
NEXT_PUBLIC_SUPABASE_URL=https://iyvhmpdfrnznxgyvvkvx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# NEW — server-side only, never prefix with NEXT_PUBLIC_
NOTIFICATION_SERVICE_URL=https://portfolio-notification-service-xxxx.run.app

# NEW — shared secret. MUST equal the Spring service's INTERNAL_API_TOKEN env.
# Generate once with: openssl rand -hex 32
# This is read ONLY in pages/api/* (server-side); it never reaches the browser.
NOTIFICATION_SERVICE_TOKEN=replace-with-32-byte-hex-random-string
```

The browser never talks to Spring directly. All UI calls hit `/api/subscriptions*` and `/api/notifications*` on Vercel; those proxy to `NOTIFICATION_SERVICE_URL` and inject `X-Internal-Token` from `NOTIFICATION_SERVICE_TOKEN`. The Spring service rejects (`401`) every request that doesn't carry a constant-time-matching header value, and fails closed (`503`) if its own `INTERNAL_API_TOKEN` is unset.

## 2. Mount the components

In `src/layout/Header.js` (or wherever your nav lives):

```jsx
import { useState } from "react";
import NotificationBell from "../components/NotificationBell";
import SubscribeDialog from "../components/SubscribeDialog";

export default function Header() {
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  return (
    <header>
      {/* …existing nav… */}
      <NotificationBell onOpenSubscribe={() => setSubscribeOpen(true)} />
      <button onClick={() => setSubscribeOpen(true)}>Subscribe</button>
      <SubscribeDialog open={subscribeOpen} onClose={() => setSubscribeOpen(false)} />
    </header>
  );
}
```

That's it. Behavior:

- `SubscribeDialog` POSTs to `/api/subscriptions` (proxied to Spring), which returns `subscriberId` + `subscriberToken`. Both are stored in `localStorage` under key `portfolioSubscriber:v1`.
- `NotificationBell` reads localStorage, calls `GET /api/notifications`, subscribes to Supabase Realtime INSERTs on `notification_recipients` filtered by `subscriber_id`, and refetches whenever a new WEB recipient row appears.
- Clicking an item or the ✓ button calls `PATCH /api/notifications/{recipientId}/read`.

## 3. Supabase Realtime

The Spring service migration enables Realtime on `notification_recipients` automatically:

```sql
alter publication supabase_realtime add table public.notification_recipients;
```

The notification bell uses `supabase.channel(...).on("postgres_changes", …)` from `@supabase/supabase-js` (already in the project).

## 4. Local dev against the Spring service

```bash
# Terminal 1: Spring service
cd ../portfolio-notification-service
./mvnw spring-boot:run

# Terminal 2: Next.js
cd ../Portfolio
echo 'NOTIFICATION_SERVICE_URL=http://localhost:8080' >> .env.local
echo 'NOTIFICATION_SERVICE_TOKEN=local-dev-internal-token' >> .env.local
npm run dev
```

## 5. Verifying end-to-end

1. Open `http://localhost:3000`, click **Subscribe**, complete the dialog.
2. Confirm the bell appears in the header.
3. Insert a fake notification straight into Supabase:
   ```bash
   SUPABASE_DB_URL='postgres://postgres:PASS@db.<ref>.supabase.co:5432/postgres?sslmode=require' \
   SUBSCRIBER_ID='<id-from-localStorage>' \
   bash ../portfolio-notification-service/scripts/insert-fake-notification.sh
   ```
4. The bell badge should bump to **1** within a few seconds (via Supabase Realtime).
5. Or send a real Kafka event:
   ```bash
   KAFKA_BROKERS=... KAFKA_USERNAME=... KAFKA_PASSWORD=... \
     bash ../portfolio-notification-service/scripts/send-test-event.sh
   ```

## 6. Security notes for this repo

- `SUPABASE_SERVICE_ROLE_KEY` is **not** used by any of the new code. It stays server-side for the existing admin features.
- The notification components only use `NEXT_PUBLIC_SUPABASE_ANON_KEY` for Realtime — never service-role.
- `subscriberToken` is treated as a bearer credential: stored in `localStorage`, sent over HTTPS, never logged.
- See the [Spring service SECURITY.md](../portfolio-notification-service/SECURITY.md) for the full threat model.

> **Reminder:** the `SUPABASE_SERVICE_ROLE_KEY` and Gmail app password from your existing `.env` were shared in chat during planning. Rotate both before this change goes to prod.

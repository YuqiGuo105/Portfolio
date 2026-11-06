# Contact form protection

Browser submissions to `/api/contact` require a server-verified Cloudflare
Turnstile token. The token must be successful, unexpired, issued for an allowed
hostname, and bound to `contact_submit`. Missing configuration and provider
errors fail closed. Production rejects Cloudflare's public test secret keys.

The widget loads when the contact form approaches the viewport or receives
focus, not at initial page load. Submission failures preserve the message;
expired/consumed tokens are refreshed. There is no automatic email retry.

## Production configuration

| Variable | Scope |
| --- | --- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Public site key, available at build time |
| `TURNSTILE_SECRET_KEY` | Vercel server-only secret |
| `TURNSTILE_ALLOWED_HOSTS` | Defaults to `yuqi.site,www.yuqi.site` |
| `CONTACT_ALLOWED_ORIGINS` | Defaults to the HTTPS origins of those two hosts |
| `CONTACT_MCP_TOKEN` | Dedicated random secret of at least 32 characters; Vercel and MCP gateway only |

Create a Managed Turnstile widget restricted to the production hostnames.
Do not use production secrets on previews. Local development accepts only
loopback origins by default; automated tests mock verification and mail delivery.
Never deploy a verification bypass or the public test keys to production.

## MCP compatibility

`contact.email_owner` still requires the gateway's existing authentication,
explicit confirmation and durable idempotency key. Only this tool attaches
`X-Portfolio-Contact-Token` from server configuration. The Next.js handler
compares it in constant time and exempts authenticated requests from Turnstile,
not from rate limiting. A body field such as `source=mcp` does not grant access.
Malformed or incorrect service credentials are rejected, not downgraded to web.

Provision the same dedicated secret in Vercel and GCP Secret Manager. Grant
only the gateway runtime service account access to this new GCP secret. Deploy
the authenticated gateway first (the old website tolerates the additional
header), then deploy the website with both Turnstile settings present.

## Limits and audit

The existing contact rate limit defaults to five requests per ten minutes,
with separate scopes for web IPs and the trusted gateway. Its Valkey fallback
remains process-local when no shared store is configured; this is not a strict
cluster-wide quota. Turnstile tokens are single-use; client-side duplicate-click
protection complements, but does not replace, MCP durable idempotency.

`contact_submission` logs contain a server-generated request ID, verified
source, outcome and bounded reason code. They never include message text,
email addresses, raw IPs, verification tokens or SMTP exception details. Runtime
log retention is still determined by the hosting plan. This focused release
does not add persistent message quarantine or probabilistic content filtering.

## Verification

- `npm run test:contact`: API guards, authenticated MCP exemption, replay/error
  cases, safe errors, field limits and multilingual messages; no real emails.
- `CONTACT_TEST_URL=http://127.0.0.1:3140 PLAYWRIGHT_MODULE_PATH=/path/to/playwright/index.mjs node tests/contact-form.browser.mjs`:
  browser integration using a local dev server with a nonempty public test site
  key, mocked Turnstile and the real handler with an in-memory mail sink.
- Check both an authenticated MCP submission and a manually verified browser
  submission after deployment. A blocked anonymous POST does not prove the
  successful delivery paths work.

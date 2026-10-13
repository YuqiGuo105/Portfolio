# Admin MCP OAuth signing

## Incident

On 2026-10-13, Supabase Auth returned HTTP 500 from `/oauth/token` after successful
consent. The recorded error was `HS256 is not supported for ID token signing`.
Clients requesting `openid` encountered a token-response parsing error such as
`missing field access_token`. Login and consent had succeeded, but the token
exchange had not. Codes and states must not be copied into logs or replayed.

## Migration order

1. Deploy admin-service and agent-service verification supporting ES256/RS256
   using the configured project's JWKS, with legacy HS256 retained. The Node MCP
   server already supports both. Keep `SUPABASE_URL` and `SUPABASE_AUTH_ISSUER`
   pointed at the same project; never derive a JWKS URL from untrusted tokens.
2. In Supabase Settings > JWT Signing Keys, migrate the legacy key if needed and
   activate an ES256 standby key. Do **not** reset the legacy JWT secret, revoke
   old signing keys, replace API keys, or change admin-role policy.
3. Start a fresh client authorization with PKCE and `openid email profile`.
   Verify `/oauth/token` returns 200, then perform an authenticated, read-only
   admin MCP tool call. Seeing a public JWKS alone is not proof: standby keys
   are published before they become the active signer.
4. Verify old sessions and normal admin login still work. Inspect recent Auth
   errors and Cloud Run health. Roll back signing activation to the previous
   key if a consumer fails; never remove signature or role validation.

As a temporary client-side workaround before migration, request only `email
profile` (without `openid`). This does not replace the permanent signing fix.

## Browser handoff

`/oauth/consent` shows **Authorization approved**, not **Connected**. The final
button forwards the original one-time code and state to the provider-validated
client callback; neither is persisted in browser storage. The page uses
`no-referrer`, no external client logo, and no analytics on private auth routes.
Denial still returns `access_denied`; expired requests require a new client flow.
Client names come from authorization metadata, never a fixed app name. Missing
names use "your AI client"; long names wrap on narrow screens.

The connecting app owns its localhost callback page (including Codex). Its
"Authentication complete" message does not prove successful token exchange and
cannot be restyled by yuqi.site.

## Regression checks

- `npm run test:oauth`
- `OAUTH_PREVIEW_URL=http://127.0.0.1:3113 node tests/oauth-consent.browser.mjs`
  with a local server configured for `https://oauth-preview.example.test` and a
  dummy public key. All accounts, OAuth responses and callbacks are intercepted.
- Backend tests use generated ES256/RS256/HS256 tokens and a local JWKS endpoint.
  They cover old sessions, bad signatures, issuer/audience mismatch, expiry,
  ID-token rejection, JWKS caching, and managed-admin authorization.

References: [Supabase signing keys](https://supabase.com/docs/guides/auth/signing-keys),
[OAuth flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows).

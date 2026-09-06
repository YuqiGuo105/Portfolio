# Existing-account Google Login

Google login uses Supabase OAuth with PKCE. Password login remains available.
The login dialog and admin login page share the same policy preflight and safe
redirect handling; only the admin callback additionally verifies the managed
admin role. OAuth does not grant administrator privileges.

## Required Production Configuration

In Supabase Authentication > Sign In / Providers:

- Enable Google using the existing provider credentials.
- Disable **Allow new users to sign up** (`disable_signup: true`). This is the
  authoritative restriction, including direct OAuth requests bypassing the UI.
- Keep anonymous sign-in disabled.
- Keep nonce checks enabled and do not enable manual identity linking.

In URL Configuration, allow the exact production callbacks
`https://www.yuqi.site/auth/callback` and
`https://www.yuqi.site/admin/callback`, including their redirect query strings
under the project's existing redirect allowlist. Avoid broad wildcard domains.
Development origins must be configured separately.

Supabase can link a Google identity to an existing account with the same verified
email. Accounts with a different email do not become existing accounts simply
because they share a name. Do not manually create accounts during this flow.

`GET /api/auth/login-policy` exposes only provider/signup booleans, never an
account lookup. The UI fails closed when Google is disabled, signup is enabled,
or Auth settings cannot be read. This preflight does not replace Auth enforcement.

Callback pages own code exchange; SDK automatic URL detection is disabled only
on those paths to prevent duplicate code redemption. Errors do not render raw
provider messages, and redirects are restricted to local paths.

## Verification

Run `node --test tests/google-auth.test.mjs`. Before release, verify the production
Auth settings, existing-account Google login, an unregistered Google account's
rejection without a new `auth.users` row, and non-admin denial at Admin MCP.
Never claim a mocked OAuth test substitutes for these live checks.

References: [General configuration](https://supabase.com/docs/guides/auth/general-configuration),
[Identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking).

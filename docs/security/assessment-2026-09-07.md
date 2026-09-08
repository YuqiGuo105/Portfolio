# Security Assessment: 2026-09-07

Status: **not production-security approved**. This is a targeted assessment,
not an OWASP ASVS certification or a complete penetration test.

Scope: Portfolio frontend at commit `55eff21`, selected server API guards,
production Supabase permission metadata and advisors, production dependency
lockfile, and unauthenticated production HTTP checks. Changes are isolated on
`fix/security-access-boundaries`; unrelated UI and README edits are excluded.

## Findings

| Priority | Evidence | Status |
| --- | --- | --- |
| Critical | Internal tables including `admin_users`, conversation data, audit records and workflow tables have RLS disabled and effective read/write grants to `anon` and `authenticated`. An HTTP admin login guard does not protect direct Supabase Data API access. | Production remediation blocked pending explicit owner approval. |
| High | `rebuild_visitor_pin_cells()` is a publicly executable SECURITY DEFINER function that truncates and rebuilds an aggregate table. | Revoke public execution in the pending SQL remediation. |
| High | `agentServiceProxy.js` recovered ADMIN privileges from an environment allowlist when the managed role service rejected or failed. The stories API used a separate email-only guard. | Fixed locally; not deployed. |
| High | `npm audit --omit=dev` reports 23 affected production packages: 2 critical, 9 high, 8 moderate, 4 low. Next.js and Swiper are the critical package entries. | Upgrade and compatibility testing outstanding. Advisory severity does not prove every vulnerable path is reachable. |
| Review | Four public views execute with their owner's rights; other public tables lack RLS. Supabase advisor totals: 52 ERROR, 27 WARN, 7 INFO. INFO entries for RLS with no policy can be deliberate deny-by-default protections. | Review each intended public read contract before altering it. |
| Review | Legacy `chat` Storage bucket is public and permits HTML/XML and broad file types. Current `chat-agent-private` and `career-resumes` buckets are private with size/type limits. | Inventory legacy objects/references and storage policies before changing visibility. No files were retrieved or removed. |
| Medium | Live responses for tested protected endpoints lack an explicit private/no-store policy. No CSP was observed on the homepage. | Local no-store headers and limited CSP baseline added. The CSP does not yet restrict script sources. |
| Review | Auth advisor flags long email OTP expiry and missing leaked-password protection. | Review provider configuration and plan availability; not changed. |

## Local Changes

- Centralize admin role lookup through `/api/admin/users/me`. Reject unavailable
  configuration, redirects, timeouts and upstream errors; never fall back to an
  old email allowlist. A valid EDITOR/PUBLISHER role does not pass an ADMIN guard.
- Use the same guard for stories and the other protected operator APIs.
- Disable caching on sensitive API/OAuth routes and chat streams; set CSP
  `base-uri`, `object-src` and `frame-ancestors` protections without claiming a
  full script-src policy. Hide the framework identification header.
- Remove browser-side writes to the legacy `Chat` table. The agent backend
  remains responsible for conversation persistence.

## Pending Production Database Change

`internal-data-hardening.sql` targets 43 explicitly named internal tables and
four functions. It enables deny-by-default RLS and revokes direct access from
`PUBLIC`, `anon` and `authenticated`. It does not delete records or change public
article/project tables. Existing owner/JDBC and `service_role` access is retained
and checked transactionally. It aborts if a table is missing, an unexpected RLS
policy exists, a lock cannot be obtained promptly, or expected service privileges
are absent after revocation.

The change was **not applied**: the safety gate requires explicit approval for
the production blast radius. A service that incorrectly relies on a browser
role to access internal data would stop working after this change. The legacy
browser `Chat` insert is one known example and has been removed locally.

Before execution, snapshot ACLs and policy metadata. After approval, apply in a
transaction, verify denied access with both browser roles, verify allowed backend
access, and smoke-test content reads, chat persistence, admin role checks,
notifications and analytics. Do not reopen anonymous access as a routine rollback;
repair any discovered server integration with its intended server credential.

## Verification

- `npm run test:security`: 27 passing assertions/tests including guard integration
  with mocked identity/role services, revoked roles, outages and forged body roles.
- `npm run build`: passed. Existing lint warnings and font-download optimization
  warnings remain; no build error.
- `node tests/security-http.local.mjs`: passed against the production build.
  Three admin routes return 401 with private/no-store and CSP headers, no
  framework header; homepage returns 200. The temporary loopback server was stopped.
- Scanned 113 generated browser assets against the three configured secret values
  present in the selected server-secret allowlist; no matches. This is not a
  complete historical or heuristic secret scan.
- Read-only live checks: homepage 200; `/mcp/admin`, conversations, visitors and
  stories API endpoints return 401 without a token. HSTS is present.
- Supabase catalog checks confirm effective grants, lack of policies on the
  scoped internal tables, existing service privileges, and JDBC connections using
  the table owner. No user records were read or modified to prove access.
- Production migration, authenticated production E2E, dependency upgrades,
  WAF/rate-limit testing, disaster recovery, and full ASVS verification remain
  outstanding. No conclusion about historical unauthorized access is possible
  from this assessment; review audit/auth logs and credential exposure separately.

## Release Gates

1. Approve and verify the private-data permission remediation.
2. Validate managed admin service configuration, then deploy the local guard fixes.
3. Upgrade vulnerable dependencies in an isolated branch; verify routes, OAuth,
   rendering, rich-text editing, uploads and MCP against the resulting lockfile.
4. Add continuous dependency/secret scanning and database permission regression
   checks, least-privilege service accounts, and authenticated admin E2E checks.
5. Review MFA, token lifecycle, upload ownership/cleanup, cost-abuse limits,
   backup restore testing, and security alert handling before declaring readiness.

References: [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/),
[Supabase public RLS checks](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public),
[Supabase view permissions](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view),
[Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

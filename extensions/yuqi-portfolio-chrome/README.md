# Yuqi Portfolio Companion

Manifest V3 Chrome side-panel extension for the portfolio platform.

## Current scope

- Reads title, canonical URL context, description, and explicitly selected text only on `https://www.yuqi.site/*`.
- Opens the public portfolio, protected Admin console, Visitor Rules, and MCP Operations routes.
- Delegates authentication, authorization, audit, and write confirmation to the existing server-side platform.
- Stores no admin secret, service-role key, database credential, or long-lived access token.

## Load locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this `extensions/yuqi-portfolio-chrome` directory.
5. Pin the extension and click it to open the side panel.

Run contract tests with:

```bash
npm test
```

## Planned MCP phase

The extension is intentionally a secure shell for later online operations:

1. Start authorization through the existing portfolio login page using OAuth 2.1 Authorization Code + PKCE.
2. Keep the short-lived access token in `chrome.storage.session`, never in source or sync storage.
3. Connect to `https://www.yuqi.site/mcp/admin` over Streamable HTTP.
4. Discover tools from the canonical gateway catalog rather than duplicating tool definitions in the extension.
5. Execute read tools directly; stage write tools as preview + explicit confirmation + idempotency key.
6. Show correlation ID, operation timeline, and final delivery/projection status after execution.

Server-side role checks remain authoritative even if the extension UI is modified by a user.

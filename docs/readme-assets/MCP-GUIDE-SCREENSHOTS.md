# MCP guide screenshots

The guide at `/mcp-guide` uses the following image assets under
`public/assets/images/mcp-guide/`:

| Image | Source | Purpose |
| --- | --- | --- |
| `claude-public-tools.png` | Existing `claude-yuqi-portfolio-connector.png` in this README asset directory | Public endpoint and seven read-only tools |
| `codex-plugin.png` | Existing `codex-yuqi-portfolio-plugin.png` in this README asset directory | Selecting the installed Codex plugin |
| `admin-sign-in.png` | Live `https://www.yuqi.site/admin/login`, captured with Computer Use on 2026-09-08 | Sign-in before authorization; empty fields, no credentials |
| `claude-admin-write-permissions.png` | Live Claude connector details, captured with Computer Use on 2026-09-08 | Write/delete tools expanded, showing available operations and per-tool approval settings |

The sign-in image is a screenshot of the real login page, not a consent-page
mockup. The guide describes consent separately. Capturing these images did not
change connector permissions or approve a new administrator connection.

Keep captions synchronized with the actual endpoint shown. Refresh screenshots
when the relevant client interface changes. Tool counts for the protected
endpoint can vary with the authorized role and deployed tool manifest.

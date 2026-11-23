# Platform monitoring registry

The canonical configuration is `monitoring/services.yaml` in
`YuqiGuo105/portfolio-admin-service`. Its CI validates and generates Alloy and
Grafana configuration. The website reads only that fixed public URL server-side;
adding a service using `jvm` or `health` does not require a frontend release.

`src/lib/server/monitoringRegistry.mjs` strictly validates the public projection,
strips endpoints/access fields, coalesces concurrent reads, caches for five
minutes and bounds the response to 64 KiB / 2.5 seconds. Last-known data is usable
for at most 15 minutes during outages; no hardcoded public fallback on cold start.
The static catalog is retained only for old client payloads and isolated tests.

Both metrics APIs use this public allowlist. All 20 existing aggregate/history
queries are scoped to public jobs; the browser still polls one summary endpoint
at its original cadence. Hover details remain two bounded, cached queries on
demand. Missing or stale samples are NO DATA, not healthy/idle or proof of an
application outage. Health probes never call AI, MCP tools, or transcoding jobs.

Run `npm run test:monitoring`. Registry tests exercise new IDs, hidden services,
timeouts, coalescing, injection rejection and removal of private metadata.
Private endpoint permission changes require separate approval in the collector
repository; a YAML display flag never grants access.

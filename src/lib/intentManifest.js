/**
 * Tool manifest loader.
 *
 * Resolution order:
 *  1. INTENT_MANIFEST_URL env var  — fetched on demand, cached for 5 min.
 *     This is the path you'll switch to once the MCP gateway exposes
 *     /tools/list. The remote document must be the same shape as the
 *     bundled mcp-tools.manifest.json.
 *  2. Bundled mcp-tools.manifest.json on disk — MVP fallback.
 *
 * The router NEVER inlines tool keywords or per-tool regex. The manifest
 * is the single source of truth for what tools exist.
 */
import fs from "node:fs";
import path from "node:path";

const TTL_MS = 5 * 60 * 1000;
let cache = { manifest: null, ts: 0 };

function readBundledManifest() {
  // Resolve relative to this file so it works from both pages/api and tests.
  const here = path.dirname(new URL(import.meta.url).pathname);
  const filePath = path.join(here, "mcp-tools.manifest.json");
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

async function fetchRemoteManifest(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`manifest HTTP ${r.status}`);
  return r.json();
}

function normalize(manifest) {
  if (!manifest || !Array.isArray(manifest.tools)) {
    throw new Error("Invalid manifest: missing tools[]");
  }
  return {
    version: manifest.version || "unknown",
    tools: manifest.tools.map((t) => ({
      name: String(t.name),
      domain: t.domain || null,
      description: String(t.description || ""),
      inputSchema: t.inputSchema || { type: "object", properties: {}, required: [] },
      riskLevel: t.riskLevel || "READ_ONLY",
      requiresConfirmation: !!t.requiresConfirmation,
      requiredRole: t.requiredRole ?? null,
    })),
  };
}

export async function loadManifest() {
  const now = Date.now();
  if (cache.manifest && now - cache.ts < TTL_MS) return cache.manifest;

  const url = process.env.INTENT_MANIFEST_URL;
  let manifest;
  if (url) {
    try {
      manifest = await fetchRemoteManifest(url);
    } catch (err) {
      console.warn("[intentManifest] remote fetch failed, falling back to bundled:", err.message);
      manifest = readBundledManifest();
    }
  } else {
    manifest = readBundledManifest();
  }

  cache = { manifest: normalize(manifest), ts: now };
  return cache.manifest;
}

export function findTool(manifest, name) {
  if (!manifest || !name) return null;
  return manifest.tools.find((t) => t.name === name) || null;
}

/**
 * Compact public view of the manifest that gets handed to the classifier
 * LLM. We hide nothing — but we strip `$schema`, comments, defaults, and
 * descriptions of obvious properties to keep prompt size reasonable.
 */
export function manifestForLLM(manifest) {
  return {
    version: manifest.version,
    tools: manifest.tools.map((t) => ({
      name: t.name,
      domain: t.domain,
      description: t.description,
      inputSchema: t.inputSchema,
      riskLevel: t.riskLevel,
      requiresConfirmation: t.requiresConfirmation,
      requiredRole: t.requiredRole,
    })),
  };
}

/**
 * Deterministic post-LLM validator.
 *
 * The LLM is never trusted. After it produces a RouteDecision, this module
 * checks the decision against the manifest with no natural-language logic:
 *
 *   - routeKind must be one of the four allowed values
 *   - targetTool (if any) must exist in the manifest
 *   - riskLevel and requiresConfirmation are FORCED to the manifest values
 *     (never trusted from the LLM — prevents prompt-injection bypass)
 *   - toolArguments are type-checked against inputSchema.properties
 *   - missing required fields are computed authoritatively
 *   - confidence below threshold demotes to GENERAL_CHAT
 *
 * Returns { ok, decision, errors } where `decision` is the cleaned,
 * trustworthy version of the input.
 */
import { findTool } from "./intentManifest.js";

const VALID_ROUTES = new Set([
  "KB_QA",
  "MCP_TOOL",
  "GENERAL_CHAT",
  "CLARIFICATION_NEEDED",
]);
const VALID_RISK = new Set(["READ_ONLY", "WRITE", "RISKY_WRITE"]);

const CONFIDENCE_FLOOR = 0.55;

function checkType(val, type) {
  if (type === "string") return typeof val === "string";
  if (type === "integer") return Number.isInteger(val);
  if (type === "number") return typeof val === "number" && Number.isFinite(val);
  if (type === "boolean") return typeof val === "boolean";
  if (type === "object") return val && typeof val === "object" && !Array.isArray(val);
  if (type === "array") return Array.isArray(val);
  return true; // unknown type — don't reject
}

function validateArgsAgainstSchema(args, schema) {
  const errors = [];
  const missing = [];
  if (!schema || schema.type !== "object") return { errors, missing };
  const props = schema.properties || {};
  const required = Array.isArray(schema.required) ? schema.required : [];

  const present = new Set(Object.keys(args || {}));
  for (const r of required) if (!present.has(r)) missing.push(r);

  for (const [k, v] of Object.entries(args || {})) {
    const spec = props[k];
    if (!spec) continue; // unknown extra key — ignore (we'll let the executor decide)
    if (spec.type && !checkType(v, spec.type)) {
      errors.push(`arg.${k}: expected ${spec.type}, got ${typeof v}`);
      continue;
    }
    if (Array.isArray(spec.enum) && !spec.enum.includes(v)) {
      errors.push(`arg.${k}: ${JSON.stringify(v)} not in enum ${JSON.stringify(spec.enum)}`);
    }
    if (spec.type === "integer") {
      if (typeof spec.minimum === "number" && v < spec.minimum)
        errors.push(`arg.${k}: ${v} < min ${spec.minimum}`);
      if (typeof spec.maximum === "number" && v > spec.maximum)
        errors.push(`arg.${k}: ${v} > max ${spec.maximum}`);
    }
  }
  return { errors, missing };
}

export function validateRouteDecision(rawDecision, manifest) {
  const errors = [];
  const d = rawDecision && typeof rawDecision === "object" ? { ...rawDecision } : {};

  // --- routeKind -----------------------------------------------------------
  let routeKind = String(d.routeKind || "").toUpperCase();
  if (!VALID_ROUTES.has(routeKind)) {
    errors.push(`invalid routeKind=${JSON.stringify(d.routeKind)}`);
    routeKind = "GENERAL_CHAT";
  }

  // --- confidence floor ----------------------------------------------------
  const confidence =
    typeof d.confidence === "number" && Number.isFinite(d.confidence)
      ? Math.max(0, Math.min(1, d.confidence))
      : 0;

  // --- targetTool sanity ---------------------------------------------------
  let targetTool = typeof d.targetTool === "string" ? d.targetTool : null;
  let toolSpec = null;
  if (targetTool) {
    toolSpec = findTool(manifest, targetTool);
    if (!toolSpec) {
      errors.push(`unknown tool ${JSON.stringify(targetTool)}`);
      targetTool = null;
      // A bad tool name means we can't trust the route either — degrade.
      if (routeKind === "MCP_TOOL" || routeKind === "CLARIFICATION_NEEDED") {
        routeKind = "GENERAL_CHAT";
      }
    }
  }
  if ((routeKind === "MCP_TOOL" || routeKind === "CLARIFICATION_NEEDED") && !targetTool) {
    errors.push(`${routeKind} requires targetTool`);
    routeKind = "GENERAL_CHAT";
  }

  // --- confidence demotion -------------------------------------------------
  // For MCP routes we want a real signal before paying for a tool call.
  if (routeKind === "MCP_TOOL" && confidence < CONFIDENCE_FLOOR) {
    errors.push(`confidence ${confidence} < ${CONFIDENCE_FLOOR} for MCP_TOOL — demoting to CLARIFICATION_NEEDED`);
    routeKind = "CLARIFICATION_NEEDED";
  }

  // --- toolArguments + missing ---------------------------------------------
  const toolArguments =
    d.toolArguments && typeof d.toolArguments === "object" && !Array.isArray(d.toolArguments)
      ? d.toolArguments
      : {};
  let missingArguments = [];
  if (toolSpec) {
    const { errors: argErrors, missing } = validateArgsAgainstSchema(
      toolArguments,
      toolSpec.inputSchema,
    );
    for (const e of argErrors) errors.push(e);
    missingArguments = missing;
    if (missingArguments.length > 0 && routeKind === "MCP_TOOL") {
      routeKind = "CLARIFICATION_NEEDED";
    }
  }

  // --- riskLevel + requiresConfirmation FORCED from manifest ---------------
  // We never trust the LLM's claim about how dangerous a tool is — the
  // manifest decides. This is the prompt-injection-proof layer.
  let riskLevel = "READ_ONLY";
  let requiresConfirmation = false;
  let requiredRole = null;
  if (toolSpec) {
    riskLevel = VALID_RISK.has(toolSpec.riskLevel) ? toolSpec.riskLevel : "READ_ONLY";
    requiresConfirmation = !!toolSpec.requiresConfirmation;
    requiredRole = toolSpec.requiredRole ?? null;
  }

  // --- normalized strings --------------------------------------------------
  const language = typeof d.language === "string" ? d.language.slice(0, 8) : "en";
  const normalizedQuery =
    typeof d.normalizedQuery === "string" ? d.normalizedQuery.trim().slice(0, 500) : "";
  const clarificationQuestion =
    routeKind === "CLARIFICATION_NEEDED" && typeof d.clarificationQuestion === "string"
      ? d.clarificationQuestion.trim().slice(0, 500)
      : null;

  const decision = {
    routeKind,
    targetTool,
    confidence,
    language,
    normalizedQuery,
    toolArguments,
    missingArguments,
    riskLevel,
    requiresConfirmation,
    requiredRole,
    clarificationQuestion,
  };

  return { ok: errors.length === 0, decision, errors };
}

export const _internals = { CONFIDENCE_FLOOR };

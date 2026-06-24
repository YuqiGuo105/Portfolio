#!/usr/bin/env node
/**
 * Verification script for /api/intent/route — covers both bug-report cases:
 *   Case A: single message with all 3 contact fields → must return MCP_TOOL with filled args
 *   Case B: turn 1 = contact info, turn 2 = "send it" → must still fill args from history
 *
 * Usage:
 *   GEMINI_API_KEY=... node test-intent-route.mjs
 *   GEMINI_API_KEY=... ROUTER_URL=https://www.yuqi.site/api/intent/route node test-intent-route.mjs
 *
 * Exit 0 = all cases passed, non-zero = at least one failed.
 */

import { loadManifest } from "./src/lib/intentManifest.js";
import { validateRouteDecision } from "./src/lib/intentValidator.js";

const ROUTER_URL = process.env.ROUTER_URL || "http://localhost:3000/api/intent/route";

const CASES = [
  {
    name: "A · single message with all contact fields",
    body: {
      input: "name: Yuqi Guo\nemail: yuqi.guo17@gmail.com\nMessage: Hello world",
      recentMessages: [],
    },
    expect: {
      routeKind: "MCP_TOOL",
      targetTool: "contact.email_owner",
      hasArgs: ["name", "email", "message"],
    },
  },
  {
    name: "B · two-turn flow: provide fields, then 'send it'",
    body: {
      input: "send it",
      recentMessages: [
        {
          role: "user",
          content:
            "name: Yuqi Guo\nemail: yuqi.guo17@gmail.com\nMessage: Hello world",
        },
        {
          role: "assistant",
          content: "Got it. Want me to send that to the owner?",
        },
      ],
    },
    expect: {
      routeKind: "MCP_TOOL",
      targetTool: "contact.email_owner",
      hasArgs: ["name", "email", "message"],
    },
  },
  {
    name: "C · two-turn flow in Chinese",
    body: {
      input: "发送",
      recentMessages: [
        {
          role: "user",
          content:
            "name: Yuqi Guo\nemail: yuqi.guo17@gmail.com\nmessage: 你好",
        },
      ],
    },
    expect: {
      routeKind: "MCP_TOOL",
      targetTool: "contact.email_owner",
      hasArgs: ["name", "email", "message"],
    },
  },
  {
    name: "D · really missing fields → must clarify (not invent)",
    body: {
      input: "I want to contact the owner",
      recentMessages: [],
    },
    expect: {
      routeKind: "CLARIFICATION_NEEDED",
      targetTool: "contact.email_owner",
    },
  },
];

function fail(msg) {
  console.error("  ❌", msg);
  return false;
}

function pass(msg) {
  console.log("  ✅", msg);
  return true;
}

async function runOne(c, manifest) {
  console.log(`\n▶ ${c.name}`);
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(ROUTER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c.body),
    });
  } catch (err) {
    return fail(`fetch failed: ${err.message}`);
  }
  if (!res.ok) {
    return fail(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const decision = await res.json();
  const ms = Date.now() - t0;
  console.log(`  ⏱  ${ms}ms · validator=${decision.trace?.validation}`);
  console.log(`  decision:`, {
    routeKind: decision.routeKind,
    targetTool: decision.targetTool,
    confidence: decision.confidence,
    toolArguments: decision.toolArguments,
    missingArguments: decision.missingArguments,
  });

  let ok = true;
  if (decision.routeKind !== c.expect.routeKind) {
    ok = fail(
      `routeKind: expected ${c.expect.routeKind}, got ${decision.routeKind}`,
    );
  } else {
    pass(`routeKind = ${decision.routeKind}`);
  }
  if (c.expect.targetTool && decision.targetTool !== c.expect.targetTool) {
    ok = fail(
      `targetTool: expected ${c.expect.targetTool}, got ${decision.targetTool}`,
    );
  } else if (c.expect.targetTool) {
    pass(`targetTool = ${decision.targetTool}`);
  }
  if (c.expect.hasArgs) {
    for (const k of c.expect.hasArgs) {
      const v = decision.toolArguments?.[k];
      if (typeof v !== "string" || !v.trim()) {
        ok = fail(
          `toolArguments.${k} missing or empty (got ${JSON.stringify(v)})`,
        );
      } else {
        pass(`toolArguments.${k} = ${JSON.stringify(v).slice(0, 60)}`);
      }
    }
  }
  return ok;
}

(async () => {
  // Sanity: confirm the local manifest + validator behave correctly with a
  // simulated Gemini response BEFORE hitting the network — proves the
  // validator is not the bug.
  console.log("── Validator sanity check ──");
  const manifest = await loadManifest();
  const simulated = {
    routeKind: "MCP_TOOL",
    targetTool: "contact.email_owner",
    confidence: 0.95,
    language: "en",
    normalizedQuery: "send contact message",
    toolArguments: {
      name: "Yuqi Guo",
      email: "yuqi.guo17@gmail.com",
      message: "Hello world",
    },
    missingArguments: [],
    riskLevel: "WRITE",
    requiresConfirmation: true,
    clarificationQuestion: null,
  };
  const { decision, errors } = validateRouteDecision(simulated, manifest);
  if (decision.routeKind === "MCP_TOOL" && decision.missingArguments.length === 0) {
    pass(`validator correctly keeps MCP_TOOL when all args are present`);
  } else {
    fail(
      `validator regressed: routeKind=${decision.routeKind} missing=${JSON.stringify(decision.missingArguments)} errors=${JSON.stringify(errors)}`,
    );
    process.exit(1);
  }

  console.log(`\n── End-to-end against ${ROUTER_URL} ──`);
  let allOk = true;
  for (const c of CASES) {
    const ok = await runOne(c, manifest);
    allOk = allOk && ok;
  }

  console.log(`\n${allOk ? "✅ ALL PASSED" : "❌ SOME FAILED"}`);
  process.exit(allOk ? 0 : 1);
})();

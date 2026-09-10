import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RESPONSE_LANGUAGE_POLICY } from "../src/lib/responseLanguagePolicy.mjs";

test("fallback language contract gives current message and explicit requests precedence", () => {
  assert.match(RESPONSE_LANGUAGE_POLICY, /explicit output-language request/);
  assert.match(RESPONSE_LANGUAGE_POLICY, /Re-evaluate the language on every turn/);
  assert.match(RESPONSE_LANGUAGE_POLICY, /Do not default mixed-language questions to English/);
  assert.match(RESPONSE_LANGUAGE_POLICY, /Preserve proper names, code, equations, IDs, links/);
});

test("both general and portfolio fallback prompts use the shared contract", () => {
  const source = readFileSync(new URL("../pages/api/rag/answer/stream.js", import.meta.url), "utf8");
  assert.equal((source.match(/^    RESPONSE_LANGUAGE_POLICY,$/gm) || []).length, 2);
  assert.doesNotMatch(source, /prefer English/);
  assert.match(source, /text: question/);
});

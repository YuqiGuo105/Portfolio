import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../pages/admin/visitors.js", import.meta.url), "utf8");

test("visitor sections use the intended default disclosure states", () => {
  assert.match(source, /const \[queryExpanded, setQueryExpanded\] = useState\(true\);/);

  const intelligenceStart = source.indexOf("function VisitorIntelligence");
  const intelligenceEnd = source.indexOf("function JourneyExplorer", intelligenceStart);
  const intelligence = source.slice(intelligenceStart, intelligenceEnd);
  assert.match(intelligence, /const \[expanded, setExpanded\] = useState\(false\);/);
  assert.match(intelligence, /controls="visitor-intelligence-content"/);
  assert.match(intelligence, /hidden=\{!expanded\}/);

  const alertsStart = source.indexOf("function VisitorAlerts");
  const alertsEnd = source.indexOf("function DisclosureButton", alertsStart);
  const alerts = source.slice(alertsStart, alertsEnd);
  assert.match(alerts, /const \[expanded, setExpanded\] = useState\(false\);/);
  assert.match(alerts, /controls="visitor-behavior-alerts-content"/);
});

test("visitor records expose a server-backed bot classification filter", () => {
  const apiSource = fs.readFileSync(new URL("../pages/api/admin/visitors.js", import.meta.url), "utf8");

  assert.match(source, /bot: "ALL"/);
  assert.match(source, /aria-label="Likely people only"/);
  assert.match(source, /event\.target\.checked \? "EXCLUDE" : "ALL"/);
  assert.match(source, /label="Traffic type"/);
  assert.match(source, /value: "EXCLUDE", label: "Likely people only"/);
  assert.match(source, /value: "ONLY", label: "Detected bots"/);
  assert.match(apiSource, /"bot"/);
});

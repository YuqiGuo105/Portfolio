import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3082";
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/api/admin/users/me")) {
        return route.fulfill({ json: { email: "operator@example.com", role: "ADMIN", permissions: ["admin.read"], owner: true } });
      }
      if (url.pathname.endsWith("/api/admin/visitor-intelligence")) {
        return route.fulfill({ json: {
          totalEvents: 135,
          policy: { version: 1 },
          funnel: [{ key: "home", label: "Homepage", description: "Loaded the main portfolio page", visitors: 43, fromStartRate: 1 }],
          attribution: [{ sourceType: "direct", source: "Direct", visitors: 36, events: 122, qualityScore: 8 }],
          topContent: [{ path: "/mcp-guide", title: "/mcp-guide", type: "page", visitors: 7, events: 15 }],
          cohort: { visitors: 36, returningVisitors: 6, returningRate: 0.17, multiStepVisitors: 6, multiStepRate: 0.17, averageEventsPerVisitor: 1.7 },
          highIntent: [],
          recentJourneys: [],
        } });
      }
      if (url.pathname.endsWith("/api/admin/visitor-alerts")) {
        return route.fulfill({ json: { rules: [], incidents: [], summary: { total: 0, notified: 0, pendingNotification: 0 } } });
      }
      if (url.pathname.endsWith("/api/admin/visitors")) {
        return route.fulfill({ json: {
          items: [],
          summary: { totalEvents: 0, uniqueVisitors: 0, countries: 0, cities: 0 },
          page: { number: 0, size: 50, totalElements: 0, totalPages: 0 },
        } });
      }
      if (url.pathname.includes("/auth/v1/")) {
        return route.fulfill({ json: { user: { id: "ui-test", email: "operator@example.com" } } });
      }
      if (url.pathname.includes("/rest/v1/")) return route.fulfill({ json: [] });
      return route.continue();
    });

    const storageKey = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
    const jwt = [
      { alg: "HS256", typ: "JWT" },
      { sub: "ui-test", exp: Math.floor(Date.now() / 1000) + 3600 },
    ].map((value) => Buffer.from(JSON.stringify(value)).toString("base64url")).join(".") + ".test-signature";
    await context.addInitScript(({ key, token }) => {
      localStorage.setItem(key, JSON.stringify({
        access_token: token,
        refresh_token: "test-only",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user: { id: "ui-test", email: "operator@example.com" },
      }));
    }, { key: storageKey, token: jwt });

    const page = await context.newPage();
    await page.goto(`${origin}/admin/visitors`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Visitor logs", exact: true }).waitFor();

    const intelligenceToggle = page.locator('[aria-controls="visitor-intelligence-content"]');
    const alertsToggle = page.locator('[aria-controls="visitor-behavior-alerts-content"]');
    const recordsToggle = page.locator('[aria-controls="visitor-event-query-content"]');
    assert.equal(await intelligenceToggle.getAttribute("aria-expanded"), "false");
    assert.equal(await alertsToggle.getAttribute("aria-expanded"), "false");
    assert.equal(await recordsToggle.getAttribute("aria-expanded"), "true");
    assert.equal(await page.locator("#visitor-intelligence-content").isVisible(), false);
    assert.equal(await page.locator("#visitor-behavior-alerts-content").isVisible(), false);
    assert.equal(await page.locator("#visitor-event-query-content").isVisible(), true);

    await intelligenceToggle.click();
    await page.getByText("Funnel", { exact: true }).waitFor();
    assert.equal(await intelligenceToggle.getAttribute("aria-expanded"), "true");
    await intelligenceToggle.click();
    assert.equal(await page.locator("#visitor-intelligence-content").isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `/private/tmp/visitor-disclosures-${width}.png`, fullPage: true });
    console.log(JSON.stringify({ width, passed: true }));
    await context.close();
  }
} finally {
  await browser.close();
}

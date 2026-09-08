import assert from 'node:assert/strict'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const base = process.env.CHAT_TEST_URL || 'http://127.0.0.1:3062'
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    page.setDefaultTimeout(20000)
    page.on('pageerror', error => console.log('Page error:', error.message))
    page.on('response', response => { if (response.status() >= 400 && response.url().includes('/_next/')) console.log('Asset failed:', response.status(), response.url()) })
    let scenario = 'eof'
    let releasePending
    await page.route('**/*', async route => {
      const req = route.request()
      const url = new URL(req.url())
      if (url.pathname.endsWith('/answer/stream')) {
        if (scenario === 'pending') {
          await new Promise(resolve => { releasePending = resolve })
          return route.abort().catch(() => {})
        }
        const body = scenario === 'eof'
          ? 'data: {"stage":"routing","payload":{"route":"WEB_GUIDE"}}\n\n'
          : scenario === 'error' ? 'data: {"stage":"error","message":"fixture failure"}\n\n'
          : 'data: {"stage":"answer_final","payload":{"answer":"Fixture completed."}}'
        return route.fulfill({ contentType: 'text/event-stream', body })
      }
      // No live model requests or persistent test conversations.
      if (url.hostname.endsWith('supabase.co') && req.method() !== 'GET') return route.abort()
      return route.continue()
    })
    await page.goto(`${base}/?openChat=1`, { waitUntil: 'domcontentloaded' })
    const input = page.getByRole('textbox', { name: 'Message input', exact: true })
    const send = page.getByRole('button', { name: 'Send message', exact: true })
    for (scenario of ['eof', 'error', 'final', 'pending', 'final']) {
      await input.fill('Explain the platform monitoring workflow.')
      await send.click()
      if (scenario === 'pending') {
        await page.getByRole('button', { name: 'Stop generating', exact: true }).click()
        releasePending?.()
      }
      await send.waitFor({ state: 'visible' })
      assert.equal(await page.getByRole('button', { name: 'Stop generating', exact: true }).count(), 0)
      await input.fill('Next question')
      assert.equal(await send.isEnabled(), true)
    }
    await page.screenshot({ path: `/private/tmp/chat-stream-recovery-${width}.png` })
    console.log(JSON.stringify({ width, cases: 5, composerRecovered: true, liveModelCalled: false }))
    await page.close()
  }
} finally { await browser.close() }

import assert from 'node:assert/strict'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const origin = process.env.CHAT_TEST_URL || 'http://127.0.0.1:3097'
const browser = await chromium.launch({ channel: 'chrome', headless: true })

try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.route('**/*', async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.pathname.endsWith('/answer/stream')) {
        const events = [
          { stage: 'reasoning_step', payload: { label: 'Understand the question', detail: 'Intent identified', completed: true } },
          { stage: 'reasoning_step', payload: { label: 'Search portfolio knowledge', detail: 'Relevant evidence found', completed: true } },
          { stage: 'reasoning_step', payload: { label: 'Verify the response', detail: 'Claims checked', completed: true } },
          { stage: 'answer_final', payload: { answer: 'Fibonacci numbers form a well-known sequence.' } },
          { stage: 'done' },
        ]
        return route.fulfill({
          contentType: 'text/event-stream',
          body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
        })
      }
      if (url.hostname.endsWith('supabase.co') && request.method() !== 'GET') return route.abort()
      return route.continue()
    })

    await page.goto(`${origin}/?openChat=1`, { waitUntil: 'domcontentloaded' })
    const panel = page.locator('#__chat_widget_root .bot-container')
    await panel.waitFor()
    await page.getByRole('textbox', { name: 'Message input', exact: true }).fill('Explain Fibonacci numbers.')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await panel.getByText('Fibonacci numbers form a well-known sequence.', { exact: true }).waitFor()

    const reasoning = panel.locator('.cw-reasoning').last()
    const toggle = reasoning.locator('.cw-reasoning-toggle')
    const subtitle = reasoning.locator('.cw-reasoning-subtitle')
    await reasoning.getByText('3 phases completed', { exact: true }).waitFor()
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')

    const geometry = await page.evaluate(() => {
      const reasoning = document.querySelector('#__chat_widget_root .cw-reasoning')
      const toggle = reasoning.querySelector('.cw-reasoning-toggle')
      const subtitle = reasoning.querySelector('.cw-reasoning-subtitle')
      const answer = reasoning.nextElementSibling
      const panelRect = reasoning.getBoundingClientRect()
      const toggleRect = toggle.getBoundingClientRect()
      const subtitleRect = subtitle.getBoundingClientRect()
      const answerRect = answer.getBoundingClientRect()
      const toggleStyle = getComputedStyle(toggle)
      return {
        panelBottom: panelRect.bottom,
        toggleBottom: toggleRect.bottom,
        subtitleBottom: subtitleRect.bottom,
        answerTop: answerRect.top,
        toggleHeight: toggleRect.height,
        lineHeight: toggleStyle.lineHeight,
        overflow: toggleStyle.overflow,
      }
    })

    assert.ok(geometry.subtitleBottom <= geometry.panelBottom + 0.5, 'subtitle stays inside reasoning panel')
    assert.ok(geometry.toggleBottom <= geometry.panelBottom + 0.5, 'toggle stays inside reasoning panel')
    assert.ok(geometry.answerTop >= geometry.panelBottom, 'answer starts after reasoning panel')
    assert.ok(geometry.toggleHeight >= 50, 'two-line toggle keeps enough vertical space')
    assert.notEqual(geometry.lineHeight, '58px', 'global theme line-height is overridden')
    assert.equal(geometry.overflow, 'visible')
    assert.deepEqual(pageErrors, [])
    await page.screenshot({ path: `/private/tmp/chat-reasoning-layout-${width}.png` })
    console.log(JSON.stringify({ width, geometry, passed: true }))
    await page.close()
  }
} finally {
  await browser.close()
}

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

    // Nothing is parked between the question and the finished answer: the steps a Deep answer
    // reported are in the record under it.
    assert.equal(await panel.locator('.cw-working, .cw-reasoning, .todo-container').count(), 0)
    const answer = panel.locator('.cw-msg-row.cw-bot').last()
    assert.equal(await answer.locator('.cw-bubble-bot > :first-child').innerText(), 'Fibonacci numbers form a well-known sequence.')
    const toggle = answer.getByRole('button', { name: /^How this answer was produced/ })
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
    await toggle.click()
    const record = answer.locator('.cw-panel')
    await record.getByText('Research', { exact: true }).waitFor()
    assert.deepEqual(await record.locator('.cw-step.is-done .cw-step-label').allInnerTexts(),
      ['Understand the question', 'Search portfolio knowledge', 'Verify the response'])
    assert.deepEqual(await record.locator('.cw-step-detail').allInnerTexts(), ['Intent identified', 'Relevant evidence found', 'Claims checked'])

    const geometry = await page.evaluate(() => {
      const root = document.querySelector('#__chat_widget_root')
      const record = [...root.querySelectorAll('.cw-panel')].at(-1)
      const scroller = root.querySelector('.bot-messages')
      const steps = [...record.querySelectorAll('.cw-step')].map(step => step.getBoundingClientRect())
      const toggle = [...root.querySelectorAll('.cw-act[aria-expanded="true"]')].at(-1)
      return {
        recordFits: record.scrollWidth <= record.clientWidth + 1 && scroller.scrollWidth <= scroller.clientWidth + 1,
        stepsStack: steps.every((rect, index) => index === 0 || rect.top >= steps[index - 1].bottom - 0.5),
        toggleHeight: toggle.getBoundingClientRect().height,
        lineHeight: getComputedStyle(toggle).lineHeight,
      }
    })
    assert.ok(geometry.recordFits, 'the record stays inside the conversation')
    assert.ok(geometry.stepsStack, 'steps do not overlap')
    assert.ok(geometry.toggleHeight >= 30 && geometry.toggleHeight <= 36, 'the action keeps its own height')
    assert.notEqual(geometry.lineHeight, '58px', 'global theme line-height is overridden')
    assert.deepEqual(pageErrors, [])
    await page.screenshot({ path: `/private/tmp/chat-reasoning-layout-${width}.png` })
    console.log(JSON.stringify({ width, geometry, passed: true }))
    await page.close()
  }
} finally {
  await browser.close()
}

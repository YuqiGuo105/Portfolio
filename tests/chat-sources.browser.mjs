import assert from 'node:assert/strict'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const base = process.env.CHAT_TEST_URL || 'http://127.0.0.1:3081'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    let turn = 0
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.pathname.endsWith('/answer/stream')) {
        turn++
        const events = turn === 1 ? [
          { stage: 'sources_found', payload: { sources: [{ title: 'Platform architecture', url: 'https://www.yuqi.site/project/example', snippet: 'Verified architecture excerpt.' }] } },
          { stage: 'related_links', payload: { links: [{ title: 'Related engineering article', url: 'https://www.yuqi.site/blog/example' }] } },
        ] : []
        events.push({ stage: 'answer_final', payload: { answer: `Verified answer ${turn}.`, runId: 'fixture-run-private' } }, { stage: 'done' })
        return route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') })
      }
      if (url.hostname.endsWith('supabase.co') && request.method() !== 'GET') return route.abort()
      return route.continue()
    })
    await page.goto(`${base}/?openChat=1`, { waitUntil: 'domcontentloaded' })
    const panel = page.locator('#__chat_widget_root .bot-container')
    await panel.waitFor()
    const send = async () => {
      await page.getByRole('textbox', { name: 'Message input', exact: true }).fill('Explain the platform.')
      await page.getByRole('button', { name: 'Send message', exact: true }).click()
    }
    await send()
    await panel.getByText('Verified answer 1.', { exact: true }).waitFor()
    const sources = panel.locator('details.answer-sources')
    const toggle = sources.locator(':scope > summary')
    assert.equal(await sources.evaluate(element => element.open), false)
    assert.equal(await sources.locator('ol').isVisible(), false)
    assert.match(await toggle.innerText(), /Sources\s*2/)
    assert.equal(await panel.getByText('Run details', { exact: true }).count(), 0)
    await page.screenshot({ path: `/private/tmp/chat-sources-collapsed-${width}.png` })
    await toggle.focus()
    await page.keyboard.press('Enter')
    assert.equal(await sources.locator('ol').isVisible(), true)
    assert.equal(await sources.locator('a').count(), 2)
    const excerpt = sources.locator('li details')
    assert.equal(await excerpt.evaluate(element => element.open), false)
    await excerpt.locator('summary').click()
    assert.equal(await excerpt.locator('blockquote').isVisible(), true)
    assert.equal(await sources.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true)
    await page.screenshot({ path: `/private/tmp/chat-sources-expanded-${width}.png` })
    await toggle.click()
    assert.equal(await sources.locator('ol').isVisible(), false)
    await send()
    await panel.getByText('Verified answer 2.', { exact: true }).waitFor()
    assert.equal(await sources.count(), 1, 'Answers without sources have no empty disclosure')
    assert.equal(await sources.evaluate(element => element.open), false)
    console.log(JSON.stringify({ width, passed: true, liveModelCalled: false }))
    await page.close()
  }
} finally { await browser.close() }

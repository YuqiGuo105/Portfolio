import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const origin = process.env.CHAT_TEST_URL || 'http://127.0.0.1:3112'
const output = process.env.CHAT_ARTIFACT_DIR || '/private/tmp/chat-compact-layout'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })

try {
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 600], [390, 844], [320, 568]]) {
    const page = await browser.newPage({ viewport: { width, height }, isMobile: width < 768, hasTouch: width < 768 })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url())
      if (url.pathname.endsWith('/answer/stream')) {
        const answer = Array.from({ length: 12 }, (_, i) => `### Section ${i + 1}\n\nA compact chat should keep messages readable and the composer visible.`).join('\n\n')
        return route.fulfill({ contentType: 'text/event-stream', body: [
          { stage: 'answer_final', payload: { answer } }, { stage: 'done' },
        ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') })
      }
      if (request.method() !== 'GET') return route.fulfill({ json: { ok: true } })
      return route.continue()
    })
    await page.goto(`${origin}/?openChat=1`, { waitUntil: 'domcontentloaded' })
    const panel = page.locator('#__chat_widget_root .bot-container')
    await panel.waitFor()
    await page.waitForFunction(width => {
      const rect = document.querySelector('.bot-container')?.getBoundingClientRect()
      return rect && Math.abs(rect.width - (width >= 768 ? 440 : width)) < 1 && rect.height <= 500
    }, width)
    const initial = await panel.boundingBox()
    assert.ok(initial.height <= Math.min(500, height * 0.62) + 1)
    assert.ok(initial.x >= 0 && initial.y >= 0 && initial.x + initial.width <= width + 1 && initial.y + initial.height <= height)
    const avatar = panel.locator('.cw-pot-avatar')
    assert.equal(Math.round((await avatar.boundingBox()).width), width < 520 ? 56 : 64, 'avatar proportions are untouched')
    await page.screenshot({ path: `${output}/${width}-compact.png` })

    const input = page.getByRole('textbox', { name: 'Message input', exact: true })
    await input.fill('Explain the platform architecture.')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await panel.getByRole('heading', { name: 'Section 12', exact: true }).waitFor()
    const geometry = await panel.evaluate(root => {
      const messages = root.querySelector('.bot-messages'), composer = root.querySelector('.input-area')
      return { panel: root.getBoundingClientRect().toJSON(), messages: messages.getBoundingClientRect().toJSON(),
        composer: composer.getBoundingClientRect().toJSON(), overflow: messages.scrollHeight > messages.clientHeight,
        horizontalOverflow: messages.scrollWidth > messages.clientWidth + 1 || composer.scrollWidth > composer.clientWidth + 1 }
    })
    assert.ok(geometry.overflow, 'long responses scroll inside the smaller window')
    assert.equal(geometry.horizontalOverflow, false)
    assert.ok(geometry.messages.bottom <= geometry.composer.top + 1)
    assert.ok(geometry.composer.bottom <= geometry.panel.bottom + 1 && geometry.composer.height >= 40)
    assert.ok(geometry.messages.height > 150, 'readable message area remains available')
    assert.equal(Math.round(geometry.panel.height), Math.round(initial.height), 'long answers do not expand the window')
    await input.fill('A follow-up question')
    assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isEnabled(), true)
    await page.screenshot({ path: `${output}/${width}-response.png` })

    if (width === 1440) {
      for (const [edge, dx, dy] of [['left', -60, 0], ['top', 0, -40]]) {
        await panel.hover()
        const handle = await panel.locator(`.cw-resize-${edge}`).boundingBox()
        const x = handle.x + (edge === 'left' ? 10 : handle.width / 2)
        const y = handle.y + (edge === 'top' ? 10 : handle.height / 2)
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.mouse.move(x + dx, y + dy, { steps: 6 })
        await page.mouse.up()
      }
      const resized = await panel.boundingBox()
      assert.ok(resized.width > initial.width + 40 && resized.height > initial.height + 20, 'manual enlargement still works')
      await page.getByRole('button', { name: 'Minimize chat', exact: true }).click()
      await page.getByRole('button', { name: 'Chat Bot Mr.Pot', exact: true }).click()
      await page.waitForFunction(() => Math.round(document.querySelector('.bot-container').getBoundingClientRect().width) === 440)
    }
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ width, height, panel: initial, scrolling: true, composerVisible: true, errors }))
    await page.close()
  }
} finally { await browser.close() }

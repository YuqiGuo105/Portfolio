import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const base = process.env.CHAT_TEST_URL || 'http://127.0.0.1:3103'
const output = process.env.MR_POT_ARTIFACT_DIR || '/private/tmp/mr-pot-loading'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.route('**/api/track', route => route.fulfill({ json: { ok: true } }))
  await page.route('**/api/click', route => route.fulfill({ json: { ok: true } }))
  await page.route('**/api/rag/health', route => route.fulfill({ json: { status: 'UP' } }))
  await page.addInitScript(() => {
    window.potTimings = { runs: [], tasks: [] }
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) window.potTimings.tasks.push({ start: entry.startTime, duration: entry.duration })
    }).observe({ type: 'longtask', buffered: true })
    document.addEventListener('click', event => {
      if (!event.target.closest('.launch-button')) return
      const run = { start: performance.now() }
      window.potTimings.runs.push(run)
      const observer = new MutationObserver(() => {
        const avatar = document.querySelector('.cw-pot-avatar')
        if (!avatar) return
        if (!run.mounted) {
          run.mounted = performance.now() - run.start
          requestAnimationFrame(() => requestAnimationFrame(() => { run.paint = performance.now() - run.start }))
        }
        if (avatar.dataset.ready === 'true') {
          run.ready = performance.now() - run.start
          observer.disconnect()
        }
      })
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-ready'] })
    }, true)
  })
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  const launcher = page.getByRole('button', { name: 'Chat Bot Mr.Pot' })
  await launcher.waitFor()
  await page.waitForTimeout(1500)
  for (let i = 0; i < 2; i++) {
    await launcher.click()
    await page.waitForFunction(() => document.querySelector('.cw-pot-avatar')?.dataset.ready === 'true', undefined, { timeout: 60000 })
    await page.getByRole('textbox', { name: 'Message input', exact: true }).fill('Animation responsiveness check')
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${output}/open-${i}.png` })
    await page.getByRole('button', { name: 'Minimize chat' }).click()
  }
  const metrics = await page.evaluate(() => window.potTimings.runs.map(run => ({
    ...run,
    longestTask: Math.max(0, ...window.potTimings.tasks.filter(t => t.start >= run.start && t.start < run.start + run.ready + 300).map(t => t.duration)),
  })))
  console.log(JSON.stringify({ cpuThrottling: 4, metrics, errors }))
  await writeFile(`${output}/timings.json`, JSON.stringify(metrics, null, 2))
  assert.deepEqual(errors, [])
  if (!process.env.MR_POT_BASELINE) {
    assert.ok(metrics[0].paint < 1000, 'opening must paint promptly on a throttled CPU')
    assert.ok(metrics[0].ready < 1500, 'the first interactive frame must not wait for the full animation')
    assert.ok(metrics[0].longestTask < 250, 'avatar preparation must not block input for a long task')
    assert.ok(metrics[1].ready < 500, 'reopening must reuse the prepared artwork')
  }
} finally { await browser.close() }

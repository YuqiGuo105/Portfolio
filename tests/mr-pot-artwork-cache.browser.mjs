import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const renderer = await readFile(new URL('../src/lib/mrPotAnimation.mjs', import.meta.url), 'utf8')
const artwork = (await readFile(new URL('../public/assets/images/chatbot_pot_thinking.gif', import.meta.url))).toString('base64')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage()
  await page.route('https://mr-pot.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
  await page.goto('https://mr-pot.test/')
  const results = await page.evaluate(async ({ renderer, artwork }) => {
    const module = await import(`data:text/javascript;base64,${btoa(renderer)}`)
    const src = `data:image/gif;base64,${artwork}`
    const makeCanvas = () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 384; return canvas
    }
    const [a, b, reference] = [makeCanvas(), makeCanvas(), makeCanvas()]
    const fetchOriginal = window.fetch
    let fetches = 0, ticks = 0
    window.fetch = (...args) => { fetches++; return fetchOriginal(...args) }
    const timer = setInterval(() => ticks++, 0)
    let first, second, reopened, firstCount, firstTicks, cacheFetches
    try {
      [first, second] = await Promise.all([module.loadPotRenderer(a, src), module.loadPotRenderer(b, src)])
      firstCount = first.render.frameCount
      firstTicks = ticks
      await first.finished
      reopened = await module.loadPotRenderer(b, src)
      cacheFetches = fetches
    } finally {
      window.fetch = fetchOriginal
      clearInterval(timer)
    }
    const originals = await module.decodePotFrames(src)
    const direct = module.createPotRenderer(reference, originals)
    let matching = 0
    for (let i = 0; i < originals.length; i++) {
      first.render(module.POT_REST, i)
      second.render(module.POT_REST, i)
      direct(module.POT_REST, i)
      if (a.toDataURL() === b.toDataURL() && a.toDataURL() === reference.toDataURL()) matching++
    }
    originals.forEach(frame => frame.close())
    // A failed fetch must not poison the shared entry for a subsequent retry.
    window.fetch = () => Promise.resolve(new Response('', { status: 503 }))
    let failed = false
    try { await module.loadPotRenderer(a, `${src}#retry`) } catch { failed = true }
    finally { window.fetch = fetchOriginal }
    const retry = await module.loadPotRenderer(a, `${src}#retry`)
    await retry.finished
    return { firstCount, firstTicks, cacheFetches, matching, finalCount: reopened.render.frameCount, failed, retryCount: retry.render.frameCount }
  }, { renderer, artwork })
  console.log(JSON.stringify(results))
  assert.equal(results.firstCount, 1, 'a clean first frame is usable before the full atlas is ready')
  assert.ok(results.firstTicks >= 4, 'preparation must yield to other browser tasks')
  assert.equal(results.cacheFetches, 1, 'concurrent and repeated opens share the original artwork')
  assert.equal(results.matching, 24, 'async preparation must preserve every original rendered frame')
  assert.equal(results.finalCount, 24)
  assert.equal(results.failed, true)
  assert.equal(results.retryCount, 24, 'failed preparation remains retryable')
} finally { await browser.close() }

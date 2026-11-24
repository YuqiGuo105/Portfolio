// Mr. Pot in the real chat window: he moves, follows the conversation, and answers a rating.
// Start `npm run dev:chat` first, or point CHAT_TEST_URL at any running copy of the site.
import assert from 'node:assert/strict'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const origin = process.env.CHAT_TEST_URL || 'http://127.0.0.1:3168'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const RUN = '3f44067a-278f-4ce3-8780-2a00379dda15'

async function openSite(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options })
  const page = await context.newPage()
  const errors = [], ratings = []
  page.on('pageerror', error => errors.push(error.stack || error.message))
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname === '/api/rag/answer/feedback') { ratings.push(request.postDataJSON()); return route.fulfill({ json: { saved: true } }) }
    if (url.pathname.endsWith('/answer/stream')) {
      return route.fulfill({ contentType: 'text/event-stream', body: [
        { stage: 'run_metadata', payload: { runId: RUN } },
        { stage: 'answer_final', payload: { answer: 'The platform is a Next.js site in front of a set of Java services.' } }, { stage: 'done' },
      ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') })
    }
    if (url.pathname === '/api/rag/admission') return route.fulfill({ json: { status: 'active' } })
    if (request.method() !== 'GET' && (url.origin === new URL(origin).origin || url.hostname.endsWith('.supabase.co'))) return route.fulfill({ json: { ok: true } })
    return route.continue()
  })
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' })
  return { context, page, errors, ratings }
}
const drawing = pot => pot.locator('svg').evaluate(svg => svg.outerHTML)
const moves = async (page, pot, wait = 500) => { const before = await drawing(pot); await page.waitForTimeout(wait); return before !== await drawing(pot) }
const look = pot => pot.getAttribute('data-expression')
// How far the pot itself (lid to base, handle to handle; not his steam) sits from the middle of a frame, in pixels.
const offCentre = (page, pot, frame) => page.evaluate(([potSelector, frameSelector]) => {
  const body = document.querySelector(`${potSelector} svg [data-p="body"]`).getBoundingClientRect()
  const box = document.querySelector(frameSelector).getBoundingClientRect()
  return [(body.left + body.right) / 2 - (box.left + box.right) / 2, (body.top + body.bottom) / 2 - (box.top + box.bottom) / 2]
}, [pot, frame])
const inTheMiddle = ([x, y]) => Math.abs(x) <= 1 && Math.abs(y) <= 1
const shows = (page, selector, name) => page.waitForFunction(([target, expected]) => document.querySelector(target)?.dataset.expression === expected, [selector, name], { timeout: 4000 })

try {
  {
    const { context, page, errors, ratings } = await openSite()
    const launcher = page.getByRole('button', { name: 'Chat Bot Mr.Pot', exact: true })
    await launcher.waitFor({ timeout: 60000 })
    const small = page.locator('#__chat_widget_root .cw-pot-launch')
    await small.locator('svg').waitFor()
    await page.waitForTimeout(800)
    // The launcher is the box it has always been: white, a 12px corner, the orange outline, his
    // name beside him and no second line. Only Mr. Pot himself is new: he is alive in it.
    const box = await launcher.evaluate(el => {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect()
      return { radius: style.borderRadius, border: style.borderTopColor, fill: style.backgroundColor, width: Math.round(rect.width), height: Math.round(rect.height), text: el.textContent.trim() }
    })
    assert.deepEqual(box, { radius: '12px', border: 'rgb(255, 128, 89)', fill: 'rgb(255, 255, 255)', width: 241, height: 62, text: 'Chat Bot Mr.Pot' })
    assert.equal(await page.locator('#__chat_widget_root .launch-button :is(.cw-launch-art, .cw-launch-hint, img)').count(), 0)
    assert.equal(await moves(page, small), true, 'on the launcher he is alive')
    const inBox = await offCentre(page, '#__chat_widget_root .cw-pot-launch', '#__chat_widget_root .cw-pot-launch')
    const upright = await page.evaluate(() => {
      const pot = document.querySelector('#__chat_widget_root .cw-pot-launch').getBoundingClientRect(), button = document.querySelector('#__chat_widget_root .launch-button').getBoundingClientRect()
      return (pot.top + pot.bottom) / 2 - (button.top + button.bottom) / 2
    })
    assert.ok(Math.abs(inBox[0]) <= 1.5 && Math.abs(inBox[1]) <= 2.5 && Math.abs(upright) <= 1, `he sits in the middle of his place in the box: ${inBox}, ${upright}`)
    await launcher.hover()
    await shows(page, '#__chat_widget_root .cw-pot-launch', 'hello')
    await page.mouse.move(20, 20)

    await launcher.click()
    const pot = page.locator('#__chat_widget_root .cw-pot-header')
    await pot.locator('svg').waitFor()
    assert.equal(await pot.getAttribute('data-ready'), 'true')
    assert.equal(Math.round((await pot.boundingBox()).width), 64)
    assert.equal(await page.locator('#__chat_widget_root .bot-header canvas').count(), 0, 'he is one SVG, not a canvas')
    assert.equal(await moves(page, pot), true, 'in the window he is alive: he breathes even at rest')

    const input = page.getByRole('textbox', { name: 'Message input', exact: true })
    await input.type('H')
    await shows(page, '#__chat_widget_root .cw-pot-header', 'curious')
    await input.type('ow is the platform built?', { delay: 20 })
    await shows(page, '#__chat_widget_root .cw-pot-header', 'listening')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await page.locator('#__chat_widget_root .cw-foot').waitFor()
    await shows(page, '#__chat_widget_root .cw-pot-header', 'success')

    const like = page.getByRole('button', { name: 'Good answer', exact: true })
    const dislike = page.getByRole('button', { name: 'Not helpful', exact: true })
    assert.deepEqual([await like.getAttribute('aria-pressed'), await dislike.getAttribute('aria-pressed')], ['false', 'false'])
    const size = await like.boundingBox()
    assert.ok(size.width >= 32 && size.height >= 32 && size.height <= 40, `the site theme does not stretch the buttons: ${size.width}x${size.height}`)
    await like.click()
    assert.equal(await like.getAttribute('aria-pressed'), 'true')
    await shows(page, '#__chat_widget_root .cw-pot-header', 'shy')
    // Praise is the one thing in the footer he answers. A dislike only ends the blush, and
    // neither it, nor taking it back, nor copying plays anything.
    const seen = await page.evaluateHandle(() => {
      const pot = document.querySelector('#__chat_widget_root .cw-pot-header'), looks = []
      new MutationObserver(() => looks.push(pot.dataset.expression)).observe(pot, { attributes: true, attributeFilter: ['data-expression'] })
      return looks
    })
    await dislike.click()
    assert.deepEqual([await like.getAttribute('aria-pressed'), await dislike.getAttribute('aria-pressed')], ['false', 'true'], 'one verdict at a time')
    await shows(page, '#__chat_widget_root .cw-pot-header', 'idle')
    await dislike.click()
    assert.equal(await dislike.getAttribute('aria-pressed'), 'false', 'pressing the chosen one takes it back')
    await page.getByRole('button', { name: 'Copy the answer', exact: true }).click()
    await page.mouse.move(640, 300)
    await page.waitForTimeout(1500)
    assert.deepEqual(await seen.jsonValue(), ['idle'], 'no other look plays for a dislike, a rating taken back or a copy')
    // Each verdict reaches the site with the run's ID and the page, and nothing of the answer.
    await page.waitForFunction(() => true)
    assert.deepEqual(ratings.map(rating => [rating.runId, rating.verdict, rating.page]), [[RUN, 'up', '/'], [RUN, 'down', '/'], [RUN, null, '/']])
    assert.ok(ratings.every(rating => /^[A-Za-z0-9_.:-]{8,80}$/.test(rating.sessionId) && Object.keys(rating).sort().join() === 'page,runId,sessionId,verdict'))
    assert.deepEqual(errors, [])
    await context.close()
  }
  {
    const { context, page, errors } = await openSite({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Chat Bot Mr.Pot', exact: true }).click()
    const pot = page.locator('#__chat_widget_root .cw-pot-header')
    await pot.locator('svg').waitFor()
    await page.waitForTimeout(600)
    assert.equal(await moves(page, pot, 900), false, 'with reduced motion he holds still')
    const inBox = await offCentre(page, '#__chat_widget_root .cw-pot-header', '#__chat_widget_root .cw-pot-header')
    assert.ok(inTheMiddle(inBox), `at rest he is in the middle of his own box: ${inBox}`)
    const beside = await page.evaluate(() => {
      const body = document.querySelector('#__chat_widget_root .cw-pot-header svg [data-p="body"]').getBoundingClientRect()
      const title = document.querySelector('#__chat_widget_root .bot-header .cw-title').getBoundingClientRect()
      return (body.top + body.bottom) / 2 - (title.top + title.bottom) / 2
    })
    assert.ok(Math.abs(beside) <= 2, `and level with his name beside him: ${beside}`)
    await page.getByRole('textbox', { name: 'Message input', exact: true }).fill('How is the platform built?')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await page.locator('#__chat_widget_root .cw-foot').waitFor()
    await page.getByRole('button', { name: 'Good answer', exact: true }).click()
    await shows(page, '#__chat_widget_root .cw-pot-header', 'shy')
    assert.equal(await look(pot), 'shy', 'but he still changes face')
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log(JSON.stringify({ passed: true, checks: ['launcher is the original box with him alive in it', 'centred in the launcher and in the header', 'header avatar is a live SVG', 'curious on the first key', 'listening while typing', 'success after an answer', 'like plays shy', 'dislike and copy play nothing', 'rating can be taken back', 'each verdict is sent with the run ID only', 'reduced motion holds still'] }))
} finally {
  await browser.close()
}

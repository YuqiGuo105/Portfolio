import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const base = process.env.CHAT_TEST_URL || 'http://127.0.0.1:3098'
const output = process.env.MR_POT_ARTIFACT_DIR || join(tmpdir(), 'mr-pot-original-preview')
const rendererCode = await readFile(new URL('../src/lib/mrPotAnimation.mjs', import.meta.url), 'utf8')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })

try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: Number(process.env.CHAT_TEST_DPR || 1),
    })
    const page = await context.newPage()
    page.setDefaultTimeout(30000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      const fetchOriginal = window.fetch.bind(window)
      window.fetch = (input, options = {}) => {
        if (!String(input).includes('/answer/stream')) return fetchOriginal(input, options)
        return Promise.resolve(new Response(new ReadableStream({ start(controller) {
          window.emitAvatarEvent = event => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
          options.signal?.addEventListener('abort', () => { try { controller.close() } catch {} }, { once: true })
        } }), { headers: { 'Content-Type': 'text/event-stream' } }))
      }
    })
    await page.route('**/*', route => {
      const req = route.request(), url = new URL(req.url())
      if (url.pathname === '/__test-pot-renderer.mjs') return route.fulfill({ contentType: 'text/javascript', body: rendererCode })
      if (url.pathname === '/api/rag/health') return route.fulfill({ json: { status: 'UP' } })
      if (url.hostname.endsWith('supabase.co') && req.method() !== 'GET') return route.abort()
      if (['/api/track', '/api/click'].includes(url.pathname)) return route.fulfill({ json: { ok: true } })
      return route.continue()
    })
    await page.goto(`${base}/?openChat=1`, { waitUntil: 'domcontentloaded' })
    const avatar = page.locator('#__chat_widget_root .cw-pot-avatar')
    await avatar.waitFor()
    await page.waitForFunction(() => document.querySelector('.cw-pot-avatar')?.dataset.ready === 'true')
    assert.equal(await page.locator('#cw-guide-tab').count(), 0, 'the rejected guide redesign is not part of the avatar change')
    assert.equal(await avatar.locator('svg:not(.lucide)').count(), 0, 'only small status accessories may use icons; the pot uses its original artwork')
    assert.equal(await avatar.locator('img').getAttribute('src'), '/assets/images/chatbot_pot_thinking.gif')
    const rendering = await avatar.locator('canvas').evaluate(el => ({
      smoothing: el.getContext('2d').imageSmoothingEnabled,
      quality: el.getContext('2d').imageSmoothingQuality,
      filter: getComputedStyle(el).filter,
      width: el.width,
    }))
    assert.equal(rendering.smoothing, true)
    assert.equal(rendering.quality, 'high')
    assert.equal(rendering.filter, 'none', 'neither blur nor a wide drop shadow should soften the contour')
    assert.equal(rendering.width, 384, 'high-resolution facial geometry stays crisp on Retina screens')
    assert.match(await avatar.evaluate(el => getComputedStyle(el).transform), /-5\)/, 'avatar and accessories sit 5px higher together')
    assert.equal(await avatar.evaluate(el => getComputedStyle(el).width), width === 390 ? '56px' : '64px')
    assert.equal(await page.locator('[data-nextjs-dialog]').count(), 0)
    await page.evaluate(() => { document.body.classList.remove('light-skin'); document.body.classList.add('dark-skin') })
    const fidelity = await page.evaluate(async () => {
      const { createPotRenderer, decodePotFrames, POT_REST } = await import('/__test-pot-renderer.mjs')
      const original = document.querySelector('.cw-pot-avatar img')
      const frames = await decodePotFrames(original.src)
      const canvas = document.createElement('canvas'), expected = document.createElement('canvas')
      canvas.width = canvas.height = expected.width = expected.height = 192
      // Compare against the GIF's real first frame, not a new illustration.
      const texture = document.createElement('canvas')
      texture.width = texture.height = 96
      texture.getContext('2d').drawImage(frames[0], 0, 0, 96, 96)
      expected.getContext('2d').imageSmoothingQuality = 'high'
      expected.getContext('2d').drawImage(texture, 0, 0, 192, 192)
      const render = createPotRenderer(canvas, frames)
      const pixels = () => canvas.getContext('2d').getImageData(0, 0, 192, 192).data
      const originalPixels = expected.getContext('2d').getImageData(0, 0, 192, 192).data
      render(POT_REST)
      const baseline = pixels()
      const bounds = data => {
        const box = [192, 192, 0, 0]
        for (let y = 52; y < 192; y++) for (let x = 0; x < 192; x++) {
          if (data[(y * 192 + x) * 4 + 3] < 128) continue
          box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y)
          box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y)
        }
        return box
      }
      let faceError = 0, faceSamples = 0, artworkChanges = 0
      baseline.forEach((value, i) => {
        const x = Math.floor(i / 4) % 192 / 2, y = Math.floor(i / 4 / 192) / 2
        if (x >= 32 && x <= 64 && y >= 46 && y <= 65) {
          faceError += Math.abs(value - originalPixels[i]); faceSamples++
        } else if (y >= 26 && value !== originalPixels[i]) artworkChanges++
      })
      const originalBounds = bounds(originalPixels), smoothBounds = bounds(baseline)
      render(POT_REST, 1)
      let frameChanges = 0
      pixels().forEach((value, i) => { if (value !== baseline[i]) frameChanges++ })
      render(POT_REST, 0)
      render({ ...POT_REST, browRight: -8, browLift: -0.5 })
      let faceChanges = 0, outsideChanges = 0
      pixels().forEach((value, i) => {
        if (value === baseline[i]) return
        const x = Math.floor(i / 4) % 192 / 2, y = Math.floor(i / 4 / 192) / 2
        if (x >= 32 && x <= 65 && y >= 45 && y <= 66) faceChanges++
        else outsideChanges++
      })
      const eyeWhite = () => {
        const d = pixels()
        let count = 0
        for (let y = 104; y < 124; y++) for (let x = 68; x < 126; x++) {
          const i = (y * 192 + x) * 4
          if (d[i] > 210 && d[i + 1] > 210 && d[i + 2] > 200) count++
        }
        return count
      }
      render(POT_REST)
      const open = eyeWhite()
      const restingEyes = canvas.toDataURL()
      render({ ...POT_REST, eyeOpen: 0.1 })
      const closed = eyeWhite()
      const legacyEyeMotionIgnored = restingEyes === canvas.toDataURL()
      // Frame-relative symmetry and gaze are checked in mr-pot-eyes.browser.mjs.
      render(POT_REST)
      const rig = pixels()
      const articulation = {}
      for (const [name, value, region] of [
        ['mouthOpen', 0.9, [42, 58, 54, 67]],
        ['blush', 0.65, [29, 57, 67, 71]],
        ['lidOpen', 1, [0, 0, 96, 48]],
        ['handleLeft', 8, [12, 36, 84, 59]],
        ['handleRight', 8, [12, 36, 84, 59]],
      ]) {
        render({ ...POT_REST, [name]: value })
        let changes = 0, outside = 0
        pixels().forEach((v, i) => {
          if (v === rig[i]) return
          changes++
          const x = Math.floor(i / 4) % 192 / 2, y = Math.floor(i / 4 / 192) / 2
          if (x < region[0] || y < region[1] || x > region[2] || y > region[3]) outside++
        })
        articulation[name] = { changes, outside }
      }
      render({ ...POT_REST, bow: 24 })
      articulation.bowBounds = bounds(pixels())
      frames.forEach(frame => frame.close())
      return { originalBounds, smoothBounds, faceError: faceError / faceSamples, artworkChanges,
        frameCount: render.frameCount, frameChanges, faceChanges, outsideChanges, open, closed,
        legacyEyeMotionIgnored, articulation }
    })
    assert.ok(fidelity.smoothBounds.every((value, i) => Math.abs(value - fidelity.originalBounds[i]) <= 1), 'contour reconstruction stays within half a source pixel of the original bounds')
    assert.ok(fidelity.faceError < 12, `only the cleaned eye region changes in the resting face: ${fidelity.faceError}`)
    assert.ok(fidelity.artworkChanges > 0, 'the low-resolution contour is refined; interior colors are checked separately')
    assert.equal(fidelity.frameCount, 24, 'all original GIF frames remain available')
    assert.ok(fidelity.frameChanges > 0, 'the original head movement is retained')
    assert.equal(fidelity.outsideChanges, 0, 'facial animation cannot repaint the pot, handles, lid, blush or silhouette')
    assert.ok(fidelity.faceChanges > 0)
    assert.equal(fidelity.closed, fidelity.open, 'eyes retain their size instead of squashing or blinking')
    assert.equal(fidelity.legacyEyeMotionIgnored, true, 'legacy eye controls cannot deform the baked eye pair')
    for (const part of ['mouthOpen', 'blush', 'lidOpen', 'handleLeft', 'handleRight']) {
      assert.ok(fidelity.articulation[part].changes > 0, `${part} visibly animates`)
      assert.equal(fidelity.articulation[part].outside, 0, `${part} cannot alter unrelated artwork`)
    }
    assert.ok(fidelity.articulation.bowBounds.every(value => value > 0 && value < 191), 'forward bow remains inside the canvas')
    const snapshots = []
    const bitmap = () => avatar.locator('canvas').evaluate(el => el.toDataURL())
    await page.waitForFunction(() => document.querySelector('.cw-pot-avatar')?.dataset.expression === 'idle')
    await page.mouse.move(0, 0)
    const restCanvas = await avatar.locator('canvas').boundingBox()
    const restHeader = await page.locator('.bot-header').boundingBox()
    const restTitle = await page.locator('.cw-title').boundingBox()
    await avatar.hover()
    const hoverGestures = new Set()
    for (let i = 0; i < 50; i++) {
      const gesture = await avatar.getAttribute('data-gesture')
      if (gesture?.startsWith('hover-')) {
        assert.equal(await avatar.getAttribute('data-frame-index'), '0', 'hover must not play the GIF left/right sway')
      }
      const animatedCanvas = await avatar.locator('canvas').boundingBox()
      const currentTitle = await page.locator('.cw-title').boundingBox()
      const currentHeader = await page.locator('.bot-header').boundingBox()
      assert.deepEqual(animatedCanvas, restCanvas, 'hover must keep the avatar size and canvas position fixed')
      assert.ok(animatedCanvas.x >= 0 && animatedCanvas.x + animatedCanvas.width <= currentTitle.x, 'hover must not overlap the name or viewport')
      assert.equal(currentTitle.x, restTitle.x, 'hover must not move the name')
      assert.equal(currentHeader.height, restHeader.height, 'hover must not change the header layout')
      if (!hoverGestures.has(gesture) && gesture?.startsWith('hover-')) {
        await page.locator('.bot-header').screenshot({ path: `${output}/${width}-${gesture}.png` })
      }
      hoverGestures.add(gesture)
      await page.waitForTimeout(100)
    }
    for (const gesture of ['hover-consider', 'hover-look-down', 'hover-ponder', 'hover-look-up']) {
      assert.ok(hoverGestures.has(gesture), `${width}: real pointer hover performs ${gesture}`)
    }
    assert.deepEqual(await avatar.locator('canvas').boundingBox(), restCanvas, 'greeting ends at the same fixed size')
    await page.waitForTimeout(1500)
    assert.doesNotMatch(await avatar.getAttribute('data-gesture'), /^(hover-|hello)/, 'stationary pointer does not loop the greeting')
    await page.mouse.move(0, 0)
    await avatar.dispatchEvent('pointerenter', { pointerType: 'touch' })
    await page.waitForTimeout(350)
    assert.doesNotMatch(await avatar.getAttribute('data-gesture'), /^(hover-|hello)/, 'touch does not trigger a hover gesture')
    const headerBox = await page.locator('.bot-header').boundingBox()
    const capture = async state => {
      await page.waitForFunction(expected => document.querySelector('.cw-pot-avatar')?.dataset.state === expected, state)
      await page.waitForTimeout(800)
      assert.equal(await avatar.getAttribute('data-state'), state)
      if (state !== 'error') {
        const effect = avatar.locator(`[data-pot-effect="${state}"]`)
        assert.ok(await effect.evaluate(el => Number(getComputedStyle(el).opacity) > .1), `${state} accessory is visible`)
        const geometry = await avatar.evaluate(root => {
          const active = root.querySelector(`[data-pot-effect="${root.dataset.state}"]`).getBoundingClientRect()
          const title = document.querySelector('.cw-title').getBoundingClientRect()
          const header = document.querySelector('.bot-header').getBoundingClientRect()
          return { right: active.right, titleLeft: title.left, top: active.top, headerTop: header.top, bottom: active.bottom, headerBottom: header.bottom }
        })
        assert.ok(geometry.right <= geometry.titleLeft, `${state} effect stays clear of the title`)
        assert.ok(geometry.top >= geometry.headerTop && geometry.bottom <= geometry.headerBottom)
      }
      const box = await page.locator('.bot-header').boundingBox()
      assert.equal(box.height, headerBox.height, 'animation cannot resize the header')
      snapshots.push({ state, image: await bitmap(), html: await avatar.evaluate(el => el.outerHTML) })
      await avatar.screenshot({ path: `${output}/${width}-${state}.png` })
      await page.locator('.cw-brand').screenshot({ path: `${output}/${width}-header-${state}.png` })
    }
    const emit = event => page.evaluate(event => window.emitAvatarEvent(event), event)
    await page.getByRole('textbox', { name: 'Message input', exact: true }).fill('Explain the platform architecture.')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await page.waitForFunction(() => typeof window.emitAvatarEvent === 'function')
    await emit({ stage: 'processing', message: 'Considering the question' })
    await capture('thinking')
    await avatar.hover()
    await page.waitForTimeout(550)
    assert.doesNotMatch(await avatar.getAttribute('data-gesture'), /^(hover-|hello)/, 'hover does not interrupt a running answer')

    const eyeMotion = await avatar.evaluate(async root => {
      const samples = [], gestures = new Set()
      for (let i = 0; i < 120; i++) {
        samples.push(root.querySelector('canvas').toDataURL())
        gestures.add(root.dataset.gesture)
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      return { samples, gestures: [...gestures] }
    })
    assert.ok(new Set(eyeMotion.samples).size > 20, 'thinking animates the original artwork')
    assert.ok(eyeMotion.gestures.length >= 3, 'thinking progresses through distinct gestures, beyond the GIF loop')

    await emit({ stage: 'retrieval', message: 'Searching portfolio knowledge' })
    await capture('searching')
    await emit({ stage: 'tool_running', message: 'Using a tool' })
    await capture('working')
    await emit({ stage: 'connecting', message: 'Connecting' })
    await capture('listening')
    await emit({ stage: 'answer_delta', payload: { delta: 'The platform connects ' } })
    await capture('speaking')
    const mouths = await avatar.evaluate(async root => {
      const values = []
      for (let i = 0; i < 12; i++) {
        values.push(root.querySelector('canvas').toDataURL())
        await new Promise(resolve => setTimeout(resolve, 70))
      }
      return values
    })
    assert.ok(new Set(mouths).size > 8, 'answering animates the face')
    await emit({ stage: 'answer_final', payload: { answer: 'The platform connects people with grounded knowledge.' } })
    await capture('success')
    await page.screenshot({ path: `${output}/${width}-chat.png` })

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForTimeout(120)
    const still = await bitmap()
    const reducedWidth = (await avatar.locator('canvas').boundingBox()).width
    await page.mouse.move(0, 0)
    await avatar.hover()
    await page.waitForTimeout(250)
    assert.equal(await bitmap(), still, 'reduced motion stops continuous movement')
    assert.equal((await avatar.locator('canvas').boundingBox()).width, reducedWidth, 'reduced motion keeps the avatar size fixed')
    assert.equal(await avatar.locator('[data-pot-effect="success"]').evaluate(el => getComputedStyle(el.parentElement).display), 'none')
    await page.getByRole('textbox', { name: 'Message input', exact: true }).fill('Try once more.')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await page.waitForTimeout(150)
    await emit({ stage: 'error', message: 'Unable to complete this response.' })
    await capture('error')
    assert.equal(await bitmap(), still, 'reduced motion preserves the cleaned resting artwork')
    assert.match(await avatar.getAttribute('aria-label'), /could not finish/, 'status remains available without animation')
    const box = await avatar.locator('canvas').boundingBox()
    const title = await page.locator('.cw-title').boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= width)
    assert.ok(box.x + box.width <= title.x, 'avatar does not overlap its title')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.waitForTimeout(100)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const hidden = await bitmap()
    await page.waitForTimeout(200)
    assert.equal(await bitmap(), hidden, 'hidden tabs pause animation')
    assert.equal(await avatar.getAttribute('data-paused'), 'true')
    await page.evaluate(() => {
      delete document.hidden
      document.dispatchEvent(new Event('visibilitychange'))
    })
    assert.deepEqual(errors, [])

    if (width === 1280) {
      await page.evaluate(snapshots => {
        const gallery = document.createElement('div')
        gallery.id = 'avatar-preview'
        Object.assign(gallery.style, { position: 'fixed', inset: '0', zIndex: '2147483647', background: '#f6f8f7', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', padding: '48px', color: '#293332' })
        for (const { state, image, html } of snapshots) {
          const item = document.createElement('div')
          item.innerHTML = html
          const rig = item.firstElementChild
          rig.style.cssText = '--pot-size:96px;display:inline-grid;margin:40px;'
          rig.dataset.paused = 'true'
          const img = document.createElement('img')
          img.className = rig.querySelector('canvas').className
          img.src = image
          rig.querySelector('canvas').replaceWith(img)
          const caption = document.createElement('p')
          caption.textContent = state
          Object.assign(caption.style, { textAlign: 'center', margin: '12px 0', font: '500 18px system-ui' })
          item.append(caption)
          gallery.append(item)
        }
        document.body.append(gallery)
      }, snapshots)
      await page.screenshot({ path: `${output}/expressions-with-effects.png` })
    }
    console.log(JSON.stringify({ width, hoverSizeStable: true, expressions: snapshots.map(x => x.state), fidelity, reducedMotion: true, backgroundPaused: true, errors }))
    await context.close()
  }
  const fallback = await browser.newPage({ viewport: { width: 390, height: 800 }, reducedMotion: 'reduce' })
  await fallback.addInitScript(() => { Object.defineProperty(window, 'ImageDecoder', { configurable: true, value: undefined }) })
  await fallback.route('**/api/track', route => route.fulfill({ json: { ok: true } }))
  await fallback.goto(`${base}/?openChat=1`, { waitUntil: 'domcontentloaded' })
  const avatar = fallback.locator('.cw-pot-avatar')
  await fallback.waitForFunction(() => document.querySelector('.cw-pot-avatar')?.dataset.ready === 'true')
  assert.equal(await avatar.getAttribute('data-artwork'), 'original-frame')
  const snapshot = () => avatar.locator('canvas').evaluate(el => el.toDataURL())
  const still = await snapshot()
  await fallback.waitForTimeout(300)
  assert.equal(await snapshot(), still, 'reduced motion is static even without ImageDecoder')
  await fallback.emulateMedia({ reducedMotion: 'no-preference' })
  await fallback.waitForFunction(() => document.querySelector('.cw-pot-avatar')?.dataset.expression === 'idle')
  await avatar.hover()
  await fallback.waitForFunction(() => document.querySelector('.cw-pot-avatar')?.dataset.gesture === 'hover-look-down')
  await fallback.waitForTimeout(450)
  assert.notEqual(await snapshot(), still, 'fallback supports the new gestures, not just a static GIF')
  await fallback.screenshot({ path: `${output}/390-fallback-greeting.png` })
  console.log(JSON.stringify({ decoderFallback: true, reducedMotionFallback: true, hoverGreeting: true }))
  await fallback.close()
} finally { await browser.close() }

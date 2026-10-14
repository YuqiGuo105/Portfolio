import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const renderer = await readFile(new URL('../src/lib/mrPotAnimation.mjs', import.meta.url), 'utf8')
const artwork = (await readFile(new URL('../public/assets/images/chatbot_pot_thinking.gif', import.meta.url))).toString('base64')
const output = process.env.MR_POT_ARTIFACT_DIR || '/private/tmp/mr-pot-lid-separation'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1152, height: 620 }, deviceScaleFactor: 2 })
  await page.route('https://mr-pot.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
  await page.goto('https://mr-pot.test/')
  const result = await page.evaluate(async ({ renderer, artwork }) => {
    const module = await import(`data:text/javascript;base64,${btoa(renderer + '\nexport { prepareFrame };')}`)
    const frames = await module.decodePotFrames(`data:image/gif;base64,${artwork}`)
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 384
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const render = module.createPotRenderer(canvas, frames)
    let leakedBody = 0, lostLid = 0, changedHandles = 0, legacyLeak = 0, lowerFaceChanges = 0
    document.body.style.cssText = 'margin:0;padding:16px;background:#f7f9fc;color:#22313a;font:13px system-ui;display:grid;grid-template-columns:repeat(6,1fr);gap:8px'
    for (let index = 0; index < frames.length; index++) {
      const preparation = module.prepareFrame(frames[index], 384, 384)
      let part = preparation.next()
      while (!part.done) part = preparation.next()
      const { head, openHead, lid, faceMount: mount } = part.value
      const pixels = layer => layer.context.getImageData(0, 0, 384, 384).data
      const original = pixels(head), separated = pixels(lid), body = pixels(openHead)
      render(module.POT_REST, index)
      const rest = context.getImageData(0, 0, 384, 384).data, closedImage = canvas.toDataURL()
      render({ ...module.POT_REST, lidBounce: 1 }, index)
      const opened = context.getImageData(0, 0, 384, 384).data
      for (let y = 0; y < 384; y++) for (let x = 0; x < 384; x++) {
        const dx = (x + 0.5) / 4 - mount.x, dy = (y + 0.5) / 4 - mount.y
        const u = 48.04 + dx * Math.cos(mount.angle) + dy * Math.sin(mount.angle)
        const v = 62.83 - dx * Math.sin(mount.angle) + dy * Math.cos(mount.angle)
        const i = (y * 384 + x) * 4
        if (v > 45.4 && separated[i + 3] > 2) leakedBody++
        if (v > 26 && v < 44.6 && Math.abs(original[i + 3] - separated[i + 3]) > 2) lostLid++
        if ((u < 25.5 || u > 70.5) && v > 45.5 && v < 54) {
          if (Math.abs(original[i + 3] - body[i + 3]) > 2) changedHandles++
        }
        // A negative control proves the former fixed y=45 cut fails on tilted frames.
        if (y >= 26 * 4 && y < 45 * 4 && v > 45.4 && original[i + 3] > 127) legacyLeak++
        if (v >= 49 && v < 76) for (let c = 0; c < 4; c++) {
          if (Math.abs(rest[i + c] - opened[i + c]) > 2) lowerFaceChanges++
        }
      }
      if ([0, 3, 6, 9, 12, 18].includes(index)) {
        const column = document.createElement('section')
        const label = document.createElement('p'); label.textContent = `Frame ${index}: closed / lifted`; column.append(label)
        for (const src of [closedImage, canvas.toDataURL()]) {
          const img = document.createElement('img'); img.src = src; img.style.cssText = 'width:100%;aspect-ratio:1;display:block'; column.append(img)
        }
        document.body.append(column)
      }
    }
    frames.forEach(frame => frame.close())
    return { frames: frames.length, leakedBody, lostLid, changedHandles, legacyLeak, lowerFaceChanges }
  }, { renderer, artwork })
  await page.screenshot({ path: `${output}/lid-separation.png` })
  console.log(JSON.stringify(result))
  assert.equal(result.frames, 24)
  assert.equal(result.leakedBody, 0, 'the lifted lid cannot contain pot body or handle pixels')
  assert.equal(result.lostLid, 0, 'the original lid silhouette is retained across the full sway cycle')
  assert.equal(result.changedHandles, 0, 'opening the lid cannot cut either handle')
  assert.equal(result.lowerFaceChanges, 0, 'opening the lid cannot change the face or lower pot')
  assert.ok(result.legacyLeak > 100, 'the regression test must catch the old horizontal crop')
} finally { await browser.close() }

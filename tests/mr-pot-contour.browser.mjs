import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const renderer = await readFile(new URL('../src/lib/mrPotAnimation.mjs', import.meta.url), 'utf8')
const artwork = (await readFile(new URL('../public/assets/images/chatbot_pot_thinking.gif', import.meta.url))).toString('base64')
const output = process.env.MR_POT_ARTIFACT_DIR || '/private/tmp/mr-pot-contour-hover'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 2 })
  await page.route('https://mr-pot.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
  await page.goto('https://mr-pot.test/')
  const result = await page.evaluate(async ({ renderer, artwork }) => {
    const current = await import(`data:text/javascript;base64,${btoa(renderer)}`)
    const previousCode = renderer.replace('function refineOutline(', 'function unusedRefineOutline(') + `
      function refineOutline(source, width, height) {
        const result = surface(width, height)
        result.context.drawImage(source.canvas, 0, 0, width, height)
        return result
      }`
    const previous = await import(`data:text/javascript;base64,${btoa(previousCode)}`)
    const frames = await current.decodePotFrames(`data:image/gif;base64,${artwork}`)
    const variants = [previous, current].map(module => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 384
      return { canvas, render: module.createPotRenderer(canvas, frames), context: canvas.getContext('2d') }
    })
    const metrics = [], samples = []
    for (let frame = 0; frame < frames.length; frame++) {
      const pixels = variants.map(({ render, context }) => {
        render(current.POT_REST, frame)
        return context.getImageData(0, 0, 384, 384).data
      })
      const stats = pixels.map(data => {
        let coverage = 0, transition = 0
        const edge = []
        for (let y = 26 * 4; y < 96 * 4; y++) for (let x = 0; x < 384; x++) {
          const a = data[(y * 384 + x) * 4 + 3]
          coverage += a / 255
          if (a > 16 && a < 239) transition++
        }
        // The long lower contour exposes the source GIF's stair-step pattern.
        for (let x = 34 * 4; x < 63 * 4; x++) {
          for (let y = 84 * 4; y > 65 * 4; y--) {
            const a = data[(y * 384 + x) * 4 + 3]
            if (a >= 128) {
              const next = data[((y + 1) * 384 + x) * 4 + 3]
              edge.push(y + (a - 128) / (a - next)); break
            }
          }
        }
        let curvature = 0
        for (let i = 1; i < edge.length - 1; i++) curvature += Math.abs(edge[i - 1] - 2 * edge[i] + edge[i + 1])
        return { coverage, transition, curvature }
      })
      let untouchedFace = true
      for (let y = 53 * 4; y < 68 * 4; y++) for (let x = 32 * 4; x < 64 * 4; x++) {
        const i = (y * 384 + x) * 4
        if (pixels[0][i + 3] !== 255 || pixels[0][i + 1] < 156) continue
        // Flat metal and the high-resolution eye pair are not blurred.
        if (pixels[1][i] !== pixels[0][i] || pixels[1][i + 1] !== pixels[0][i + 1]) untouchedFace = false
      }
      metrics.push({ frame, stats, untouchedFace })
      if ([0, 6, 18].includes(frame)) samples.push(variants.map(v => v.canvas.toDataURL()))
    }
    document.body.style.cssText = 'margin:0;padding:24px;background:#fafafa;color:#20272d;font:15px system-ui;display:grid;grid-template-columns:1fr 1fr;gap:12px'
    for (const pair of samples) for (const [index, src] of pair.entries()) {
      const panel = document.createElement('div')
      panel.style.cssText = 'display:flex;align-items:center;gap:24px;border-bottom:1px solid #ddd'
      for (const size of [240, 74]) {
        const img = document.createElement('img'); img.src = src; img.width = img.height = size; panel.append(img)
      }
      const label = document.createElement('span'); label.textContent = index ? 'Refined' : 'Before'; panel.append(label)
      document.body.append(panel)
    }
    frames.forEach(frame => frame.close())
    return {
      frames: metrics.length,
      maxCoverageChange: Math.max(...metrics.map(m => Math.abs(m.stats[1].coverage / m.stats[0].coverage - 1))),
      maxTransitionRatio: Math.max(...metrics.map(m => m.stats[1].transition / m.stats[0].transition)),
      curvatureRatio: metrics.reduce((sum, m) => sum + m.stats[1].curvature, 0) / metrics.reduce((sum, m) => sum + m.stats[0].curvature, 0),
      untouchedFace: metrics.every(m => m.untouchedFace),
    }
  }, { renderer, artwork })
  await page.screenshot({ path: `${output}/contour-comparison.png`, fullPage: true })
  console.log(JSON.stringify(result))
  assert.equal(result.frames, 24)
  assert.ok(result.maxCoverageChange < 0.04, 'silhouette coverage and proportions must be preserved')
  assert.ok(result.maxTransitionRatio < 1.2, 'edge smoothing must not create a wide fuzzy halo')
  assert.ok(result.curvatureRatio < 0.85, 'source-pixel stair steps must be measurably reduced')
  assert.equal(result.untouchedFace, true, 'flat metal and eyes must not be blurred')
} finally { await browser.close() }

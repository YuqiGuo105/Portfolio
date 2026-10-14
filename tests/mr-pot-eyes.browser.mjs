import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const renderer = await readFile(new URL('../src/lib/mrPotAnimation.mjs', import.meta.url), 'utf8')
const artwork = (await readFile(new URL('../public/assets/images/chatbot_pot_thinking.gif', import.meta.url))).toString('base64')
const output = process.env.MR_POT_ARTIFACT_DIR || '/private/tmp/mr-pot-rigid-eyes'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 820 }, deviceScaleFactor: 2 })
  await page.route('https://mr-pot.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body></body></html>' }))
  await page.goto('https://mr-pot.test/')
  const result = await page.evaluate(async ({ renderer, artwork }) => {
    const { createPotRenderer, decodePotFrames, POT_REST } = await import(`data:text/javascript;base64,${btoa(renderer)}`)
    const frames = await decodePotFrames(`data:image/gif;base64,${artwork}`)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 384
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const render = createPotRenderer(canvas, frames)
    const failures = [], tracked = []
    let checked = 0
    function eyes(mergeApertures = false) {
      const data = ctx.getImageData(0, 0, 384, 384).data
      const white = new Set()
      for (let y = 47 * 4; y < 72 * 4; y++) for (let x = 27 * 4; x < 70 * 4; x++) {
        const i = (y * 384 + x) * 4
        if (data[i] > 230 && data[i + 1] > 230 && data[i + 2] > 220 && data[i + 3] > 200) white.add(y * 384 + x)
      }
      const components = []
      while (white.size) {
        const queue = [white.values().next().value], points = []
        white.delete(queue[0])
        while (queue.length) {
          const p = queue.pop(), x = p % 384, y = Math.floor(p / 384)
          points.push({ x, y })
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const next = (y + dy) * 384 + x + dx
            if (white.delete(next)) queue.push(next)
          }
        }
        const xs = points.map(p => p.x), ys = points.map(p => p.y)
        components.push({ x: (Math.min(...xs) + Math.max(...xs) + 1) / 8,
          y: (Math.min(...ys) + Math.max(...ys) + 1) / 8,
          width: (Math.max(...xs) - Math.min(...xs) + 1) / 4,
          height: (Math.max(...ys) - Math.min(...ys) + 1) / 4, area: points.length })
      }
      if (mergeApertures) {
        // A moved pupil or closing lid can divide the remaining white aperture.
        // Measure all its antialiased fragments as one socket.
        return [components.filter(p => p.x < 48), components.filter(p => p.x >= 48)].filter(group => group.length).map(group => {
          const left = Math.min(...group.map(p => p.x - p.width / 2)), right = Math.max(...group.map(p => p.x + p.width / 2))
          const top = Math.min(...group.map(p => p.y - p.height / 2)), bottom = Math.max(...group.map(p => p.y + p.height / 2))
          return { x: (left + right) / 2, y: (top + bottom) / 2, width: right - left, height: bottom - top, area: group.reduce((sum, p) => sum + p.area, 0) }
        })
      }
      return components.sort((a, b) => a.x - b.x)
    }
    const source = document.createElement('canvas'); source.width = source.height = 96
    const sourceCtx = source.getContext('2d')
    const mounts = frames.map(frame => {
      sourceCtx.clearRect(0, 0, 96, 96); sourceCtx.drawImage(frame, 0, 0)
      const d = sourceCtx.getImageData(0, 0, 96, 96).data
      const cheeks = [0, 1].map(side => {
        let weight = 0, xsum = 0, ysum = 0
        for (let y = 58; y < 72; y++) for (let x = side ? 49 : 28; x < (side ? 70 : 47); x++) {
          const i = (y * 96 + x) * 4, red = d[i] - d[i + 1]
          if (red <= 25 || d[i] - d[i + 2] <= 20) continue
          const w = red * d[i + 3] / 255
          weight += w; xsum += (x + 0.5) * w; ysum += (y + 0.5) * w
        }
        return { x: xsum / weight, y: ysum / weight }
      })
      return { x: (cheeks[0].x + cheeks[1].x) / 2, y: (cheeks[0].y + cheeks[1].y) / 2,
        angle: Math.atan2(cheeks[1].y - cheeks[0].y, cheeks[1].x - cheeks[0].x) }
    })
    function expectedEye(side, mount, pose) {
      const dx = (side ? 57.25 : 38.75) - 48.04, dy = 57.2 - 62.83
      const x = mount.x + dx * Math.cos(mount.angle) - dy * Math.sin(mount.angle)
      let y = mount.y + dx * Math.sin(mount.angle) + dy * Math.cos(mount.angle)
      const bow = pose.bow * Math.PI / 180, tilt = pose.tilt * Math.PI / 180
      y = 45 + Math.sin(bow) * 7 + (y - 45) * Math.cos(bow)
      return { x: 48 + pose.shiftX + (x - 48) * Math.cos(tilt) - (y - 60) * Math.sin(tilt),
        y: 60 + pose.lift + (x - 48) * Math.sin(tilt) + (y - 60) * Math.cos(tilt) }
    }
    const poses = [{}, { tilt: -4 }, { tilt: 4 }, { bow: 24 }, { bow: 18, tilt: -3 },
      { shiftX: 0.55, lift: -1.3 }, { blush: 0.65 }, { browRight: -12, browLeft: 5 },
      { mouthOpen: 0.65 }, { handleLeft: 8, handleRight: 8 }, { handleLeft: -2, handleRight: 5 },
      { lidOpen: 1, mouthOpen: 0.65, handleLeft: 8, handleRight: 8 },
      { bow: 18, tilt: 3, mouthOpen: 0.5, handleLeft: 5, handleRight: 5 },
      { pupilX: -0.55, pupilY: -0.4 }, { pupilX: 0.55, pupilY: 0.4 },
      { bow: 24, pupilY: 0.4 }, { tilt: -4, pupilX: -0.55 },
      { blink: 0.3 }, { blink: 0.6, bow: 24 }, { blink: 0.3, tilt: 4, pupilX: 0.55 }]
    for (let frame = 0; frame < frames.length; frame++) for (const values of poses) {
      const pose = { ...POT_REST, ...values }
      render(pose, frame)
      const pair = eyes(Boolean(values.blink || values.pupilX || values.pupilY))
      if (pair.length !== 2) failures.push({ frame, values, reason: 'not exactly two eyes', pair })
      else {
        const [left, right] = pair
        const edgeTolerance = values.blink ? 0.5 : 0.25
        if (Math.abs(left.width - right.width) > edgeTolerance || Math.abs(left.height - right.height) > edgeTolerance
            // A thin, thresholded aperture has more subpixel coverage variance.
            || Math.abs(left.area - right.area) > Math.max(values.blink ? 8 : 0, Math.max(left.area, right.area) * (values.blink ? 0.12 : 0.08))) {
          failures.push({ frame, values, reason: 'eyes are unequal', pair })
        }
        for (let side = 0; side < 2; side++) {
          const expected = expectedEye(side, mounts[frame], pose)
          if (Math.hypot(pair[side].x - expected.x, pair[side].y - expected.y) > 0.2) failures.push({ frame, values, reason: 'eye detached from moving head', expected, actual: pair[side] })
        }
        if (!Object.keys(values).length) tracked.push({ angle: Math.atan2(right.y - left.y, right.x - left.x), x: (left.x + right.x) / 2 })
      }
      const fixed = canvas.toDataURL()
      render({ ...pose, eyeOpen: 0.1, gazeX: 0.85, gazeY: -0.65, eyeLeft: 0.2, eyeRight: 1 }, frame)
      if (canvas.toDataURL() !== fixed) failures.push({ frame, values, reason: 'independent eye animation remains' })
      checked++
    }
    const rollRange = Math.max(...tracked.map(t => t.angle)) - Math.min(...tracked.map(t => t.angle))
    const xRange = Math.max(...tracked.map(t => t.x)) - Math.min(...tracked.map(t => t.x))
    if (rollRange < 0.16 || xRange < 1.5) failures.push({ reason: 'eyes frozen while pot moves', rollRange, xRange })
    const arcs = [], apertures = []
    const prototype = CanvasRenderingContext2D.prototype
    const arc = prototype.arc, ellipse = prototype.ellipse
    try {
      prototype.arc = function (...args) { arcs.push(args.slice(0, 3)); return arc.apply(this, args) }
      prototype.ellipse = function (...args) { apertures.push(args.slice(0, 5)); return ellipse.apply(this, args) }
      render({ ...POT_REST, blink: 0.6, pupilX: 0.55, pupilY: 0.4 })
    } finally { prototype.arc = arc; prototype.ellipse = ellipse }
    const sharedGeometry = JSON.stringify(arcs) === JSON.stringify([[0, 0, 2.8], [0.55, 0.4, 1.65], [0, 0, 2.8], [0.55, 0.4, 1.65]])
      && apertures.length === 2 && JSON.stringify(apertures[0]) === JSON.stringify(apertures[1])
    if (!sharedGeometry) failures.push({ reason: 'left and right socket, pupil, and eyelid geometry must match exactly', arcs, apertures })
    let expressionChecks = 0
    for (let frame = 0; frame < frames.length; frame++) {
      render(POT_REST, frame)
      const baseline = ctx.getImageData(0, 0, 384, 384).data
      const mount = mounts[frame]
      for (const values of [{ pupilX: -0.55 }, { pupilX: 0.55, pupilY: 0.4 }, { blink: 0.3 }, { blink: 0.6 }, { blink: 1 }]) {
        render({ ...POT_REST, ...values }, frame)
        const pixels = ctx.getImageData(0, 0, 384, 384).data
        let changed = 0, outside = 0
        const c = Math.cos(mount.angle), s = Math.sin(mount.angle)
        for (let y = 0; y < 384; y++) for (let x = 0; x < 384; x++) {
          const i = (y * 384 + x) * 4
          if ([0, 1, 2, 3].every(channel => pixels[i + channel] === baseline[i + channel])) continue
          changed++
          const dx = (x + 0.5) / 4 - mount.x, dy = (y + 0.5) / 4 - mount.y
          const u = 48.04 + dx * c + dy * s, v = 62.83 - dx * s + dy * c
          if (Math.min(Math.hypot(u - 38.75, v - 57.2), Math.hypot(u - 57.25, v - 57.2)) > 3.2) outside++
        }
        if (!changed || outside) failures.push({ frame, values, reason: 'expression must only change pixels inside the fixed eye pair', changed, outside })
        if (values.blink === 1 && eyes().length) failures.push({ frame, reason: 'blink leaves a ghost eye behind' })
        expressionChecks++
      }
    }
    for (let frame = 0; frame < frames.length; frame++) {
      render(POT_REST, frame)
      const rest = ctx.getImageData(0, 0, 384, 384).data
      for (const values of [{ handleLeft: 8 }, { handleRight: 8 }, { handleLeft: -2, handleRight: -2 }]) {
        render({ ...POT_REST, ...values }, frame)
        const moved = ctx.getImageData(0, 0, 384, 384).data
        let changed = 0, outside = 0, tornCollar = 0
        moved.forEach((v, i) => {
          if (v === rest[i]) return
          changed++
          const x = Math.floor(i / 4) % 384 / 4, y = Math.floor(i / 4 / 384) / 4
          if (y < 36 || y > 59 || (x > 30 && x < 66)) outside++
        })
        const mount = mounts[frame], c = Math.cos(mount.angle), s = Math.sin(mount.angle)
        for (let y = 36 * 4; y < 59 * 4; y++) for (let x = 12 * 4; x < 84 * 4; x++) {
          const dx = (x + 0.5) / 4 - mount.x, dy = (y + 0.5) / 4 - mount.y
          const u = 48.04 + dx * c + dy * s, v = 62.83 - dx * s + dy * c
          const atCollar = (u >= 24.5 && u <= 28) || (u >= 68 && u <= 71.5)
          const alpha = (y * 384 + x) * 4 + 3
          if (atCollar && v >= 45 && v <= 55 && rest[alpha] > 250 && moved[alpha] < 230) tornCollar++
        }
        if (!changed || outside) failures.push({ frame, values, reason: 'handle motion must stay outside the face and body', changed, outside })
        if (tornCollar) failures.push({ frame, values, reason: 'handle separated from pot', tornCollar })
      }
    }
    const frozenCode = renderer.replace('const eyeMount = faceLandmarks(source)', 'const eyeMount = { x: 48.04, y: 62.83, angle: 0 }')
    const frozenModule = await import(`data:text/javascript;base64,${btoa(frozenCode)}`)
    frozenModule.createPotRenderer(canvas, frames)(POT_REST, 6)
    const frozen = eyes()
    const frozenEyesRegressionCaught = Math.abs(Math.atan2(frozen[1].y - frozen[0].y, frozen[1].x - frozen[0].x) - mounts[6].angle) > 0.025
    if (!frozenEyesRegressionCaught) failures.push({ reason: 'test missed frozen eyes' })
    document.body.style.cssText = 'margin:0;padding:24px;background:#f7f8fa;color:#20272d;font:15px system-ui;display:grid;grid-template-columns:repeat(4,1fr);gap:16px'
    for (const [label, frame, values] of [
      ['Centered', 0, {}], ['Original sway left', 6, {}], ['Original sway right', 18, {}], ['Brows only', 6, { browRight: -12, browLeft: 5 }],
      ['Slight smile', 6, { mouthOpen: 0.5, mouthWidth: 1.12 }], ['Listening', 18, { handleRight: 5, handleLeft: 1 }],
      ['Handles lift', 6, { handleLeft: 8, handleRight: 8 }], ['Happy reaction', 6, { lidOpen: 1, mouthOpen: 0.65, handleLeft: 8, handleRight: 8 }],
      ['Small pupil glance', 0, { pupilX: -0.55, pupilY: -0.4 }], ['Paired blink', 0, { blink: 1 }],
      ['Thoughtful bow', 0, { bow: 24, pupilY: 0.4, handleLeft: -2, handleRight: -2 }],
      ['Look up and smile', 0, { mouthOpen: 0.22, mouthWidth: 1.08, handleLeft: 4, handleRight: 4 }],
    ]) {
      render({ ...POT_REST, ...values }, frame)
      const item = document.createElement('div')
      item.style.cssText = 'padding:12px;text-align:center;border:1px solid #cdd2d9;border-radius:6px'
      for (const size of [192, 74]) {
        const img = document.createElement('img'); img.src = canvas.toDataURL()
        img.style.cssText = `width:${size}px;height:${size}px;display:block;margin:auto`; item.append(img)
      }
      const caption = document.createElement('p'); caption.textContent = label; item.append(caption); document.body.append(item)
    }
    frames.forEach(frame => frame.close())
    return { checked, expressionChecks, sharedGeometry, rollRange, xRange, frozenEyesRegressionCaught, failures: failures.slice(0, 10), totalFailures: failures.length }
  }, { renderer, artwork })
  await page.screenshot({ path: `${output}/rigid-eye-pair.png`, fullPage: true })
  console.log(JSON.stringify(result))
  assert.equal(result.totalFailures, 0)
} finally { await browser.close() }

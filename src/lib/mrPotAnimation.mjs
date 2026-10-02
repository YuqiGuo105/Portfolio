export const POT_REST = Object.freeze({
  tilt: 0, lift: 0, shiftX: 0, steam: 0,
  browLeft: 0, browRight: 0, browLift: 0, mouthWidth: 1, mouthHeight: 1,
  mouthOpen: 0, lidOpen: 0, blush: 0, bow: 0, handleLeft: 0, handleRight: 0,
})

function surface(width, height) {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Canvas unavailable")
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = "high"
  return { canvas, context }
}

function refineOutline(source, width, height) {
  const result = surface(width, height)
  result.context.drawImage(source.canvas, 0, 0, width, height)
  const softened = surface(width, height)
  softened.context.filter = `blur(${width / 96 * 0.7}px)`
  softened.context.drawImage(result.canvas, 0, 0)
  const pixels = result.context.getImageData(0, 0, width, height)
  const smooth = softened.context.getImageData(0, 0, width, height).data
  // Reconstruct only the dark contour at output resolution. Tighten alpha again
  // after smoothing, so pixel steps disappear without a blurred halo or soft face.
  for (let y = Math.floor(26 * height / 96); y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    const ink = Math.min(pixels.data[i + 1], smooth[i + 1])
    const weight = Math.max(0, Math.min(1, (150 - ink) / 35))
    if (Math.abs(smooth[i] - smooth[i + 1]) > 16) continue
    for (let c = 0; c < 3; c++) pixels.data[i + c] += (smooth[i + c] - pixels.data[i + c]) * weight
    if (pixels.data[i + 3] < 254 || smooth[i + 3] < 254) {
      pixels.data[i + 3] = Math.max(0, Math.min(255, (smooth[i + 3] - 76.5) * 2.5))
    }
  }
  result.context.putImageData(pixels, 0, 0)
  return result
}

// Lift original features so expressions keep the pot's artwork and proportions.
function liftFeature(source, base, x, y, width, height) {
  const part = surface(width, height)
  const pixels = source.context.getImageData(x, y, width, height)
  const clean = base.context.getImageData(x, y, width, height)
  const skin = source.context.getImageData(48, 66, 1, 1).data
  for (let i = 0; i < pixels.data.length; i += 4) {
    const r = pixels.data[i], g = pixels.data[i + 1]
    // Leave the blush and the original metal texture in place.
    if (Math.abs(r - g) > 8 || Math.abs(r - skin[0]) < 6) {
      pixels.data[i + 3] = 0
    } else {
      clean.data.set(skin, i)
    }
  }
  part.context.putImageData(pixels, 0, 0)
  base.context.putImageData(clean, x, y)
  return { ...part, x, y, width, height }
}

function clearOriginalEyes(source, base) {
  const skin = source.context.getImageData(48, 66, 1, 1).data
  // Clear the complete GIF eye, including antialiased edges in every frame.
  // A cropped pupil leaves a second iris behind when the gaze moves.
  for (const x of [33, 51]) {
    const pixels = base.context.getImageData(x, 51, 12, 13)
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (Math.abs(pixels.data[i] - pixels.data[i + 1]) <= 12) pixels.data.set(skin, i)
    }
    base.context.putImageData(pixels, x, 51)
  }
}

function faceLandmarks(source) {
  // Blush stays visible during blinks. Its neutral midpoint is (48.04, 62.83).
  const { data } = source.context.getImageData(0, 0, 96, 96)
  const cheeks = [0, 1].map(side => {
    let weight = 0, sumX = 0, sumY = 0
    for (let y = 58; y < 72; y++) for (let x = side ? 49 : 28; x < (side ? 70 : 47); x++) {
      const i = (y * 96 + x) * 4
      const red = data[i] - data[i + 1]
      if (red <= 25 || data[i] - data[i + 2] <= 20) continue
      const w = red * data[i + 3] / 255
      weight += w; sumX += (x + 0.5) * w; sumY += (y + 0.5) * w
    }
    return weight ? { x: sumX / weight, y: sumY / weight } : null
  })
  if (cheeks.some(cheek => !cheek)) return { x: 48.04, y: 62.83, angle: 0 }
  return {
    x: (cheeks[0].x + cheeks[1].x) / 2,
    y: (cheeks[0].y + cheeks[1].y) / 2,
    angle: Math.atan2(cheeks[1].y - cheeks[0].y, cheeks[1].x - cheeks[0].x),
  }
}

function drawEyes(context, mount) {
  // One identical shape per eye, baked into the GIF frame rather than animated
  // independently. Only the shared head transform can move or scale the eyes.
  context.save()
  context.translate(mount.x, mount.y)
  context.rotate(mount.angle)
  context.translate(-48.04, -62.83)
  for (const x of [38.75, 57.25]) {
    context.save()
    context.translate(x, 57.2)
    context.beginPath()
    context.arc(0, 0, 2.8, 0, Math.PI * 2)
    context.fillStyle = '#fafaf7'
    context.fill()
    context.clip()
    context.beginPath()
    context.arc(0, 0, 1.65, 0, Math.PI * 2)
    context.fillStyle = '#383636'
    context.fill()
    context.restore()
  }
  context.restore()
}

function separateHandles(source, base, mount) {
  const original = source.context.getImageData(0, 0, 96, 96)
  const clean = base.context.getImageData(0, 0, 96, 96)
  const bareSource = surface(96, 96)
  const parts = [surface(96, 96), surface(96, 96)]
  const pixels = parts.map(part => part.context.createImageData(96, 96))
  const c = Math.cos(mount.angle), s = Math.sin(mount.angle)
  // Cut only the original handle pixels, in the rolling head's local coordinates.
  for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
    const dx = x + 0.5 - mount.x, dy = y + 0.5 - mount.y
    const u = 48.04 + dx * c + dy * s, v = 62.83 - dx * s + dy * c
    if (v < 45 || v > 54 || (u >= 25.5 && u <= 70.5)) continue
    const side = u < 25.5 ? 0 : 1, i = (y * 96 + x) * 4
    pixels[side].data.set(original.data.subarray(i, i + 4), i)
    // Overlap under the fixed collar; complementary antialiased masks leave a seam.
    if (u < 23 || u > 73) {
      original.data.fill(0, i, i + 4)
      clean.data.fill(0, i, i + 4)
    }
  }
  base.context.putImageData(clean, 0, 0)
  bareSource.context.putImageData(original, 0, 0)
  parts.forEach((part, side) => {
    part.context.putImageData(pixels[side], 0, 0)
    const dx = (side ? 70.5 : 25.5) - 48.04, dy = 49 - 62.83
    part.hinge = { x: mount.x + dx * c - dy * s, y: mount.y + dx * s + dy * c }
  })
  return { parts, bareSource }
}

export async function decodePotFrames(src) {
  if (typeof ImageDecoder === "undefined") return null
  const response = await fetch(src)
  if (!response.ok) throw new Error("Mr Pot artwork unavailable")
  const decoder = new ImageDecoder({ data: await response.arrayBuffer(), type: "image/gif" })
  const frames = []
  try {
    await decoder.tracks.ready
    const count = Math.min(decoder.tracks.selectedTrack.frameCount, 60)
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i })
      try { frames.push(await createImageBitmap(image)) }
      finally { image.close() }
    }
    return frames
  } catch (error) {
    frames.forEach(frame => frame.close())
    throw error
  } finally {
    decoder.close()
  }
}

function* prepareFrame(image, width, height) {
    const source = surface(96, 96)
    source.context.drawImage(image, 0, 0, 96, 96)
    const base = surface(96, 96)
    base.context.drawImage(source.canvas, 0, 0)
    const leftBrow = liftFeature(source, base, 34, 47, 7, 5)
    const rightBrow = liftFeature(source, base, 54, 47, 8, 5)
    const mouth = liftFeature(source, base, 44, 59, 8, 5)
    clearOriginalEyes(source, base)
    const eyeMount = faceLandmarks(source)
    const head = refineOutline(base, width, height)
    head.context.scale(width / 96, height / 96)
    drawEyes(head.context, eyeMount)
    yield
    const handles = separateHandles(source, base, eyeMount)
    const bareHead = refineOutline(base, width, height)
    bareHead.context.scale(width / 96, height / 96)
    drawEyes(bareHead.context, eyeMount)
    yield
    const cheeks = surface(96, 96)
    const cheekPixels = source.context.getImageData(0, 0, 96, 96)
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
      const i = (y * 96 + x) * 4
      const red = cheekPixels.data[i], green = cheekPixels.data[i + 1]
      if (y >= 58 && y <= 69 && x >= 30 && x <= 66 && red - green > 25) {
        cheekPixels.data[i] = 236
        cheekPixels.data[i + 1] = 108
        cheekPixels.data[i + 2] = 115
      } else cheekPixels.data[i + 3] = 0
    }
    cheeks.context.putImageData(cheekPixels, 0, 0)
    // Blush must not tint or obscure either eye at the bottom edge.
    cheeks.context.globalCompositeOperation = 'destination-out'
    drawEyes(cheeks.context, eyeMount)
    cheeks.context.globalCompositeOperation = 'source-over'
    handles.parts = handles.parts.map(part => ({ ...refineOutline(part, width, height), hinge: part.hinge }))
    yield
    const lid = refineOutline(source, width, height)
    yield
    const bareLid = refineOutline(handles.bareSource, width, height)
    return { source, head, bareHead, handles, lid, bareLid, leftBrow, rightBrow, mouth, cheeks, faceMount: eyeMount }
}

export function createPotRenderer(canvas, images) {
  const frames = (Array.isArray(images) ? images : [images]).map(image => {
    const preparation = prepareFrame(image, canvas.width, canvas.height)
    let step = preparation.next()
    while (!step.done) step = preparation.next()
    return step.value
  })
  return createPreparedRenderer(canvas, { frames, complete: true })
}

const yieldForInput = () => new Promise(resolve => setTimeout(resolve, 0))
let cachedArtwork

async function prepareFrameIncrementally(image, width, height) {
  const preparation = prepareFrame(image, width, height)
  let step
  do {
    // Each layer yields so opening the dialog and typing never wait on 24 frames.
    await yieldForInput()
    step = preparation.next()
  } while (!step.done)
  return step.value
}

async function prepareArtwork(src, fallback, width, height) {
  const images = await decodePotFrames(src)
  const originals = images?.length ? images : [fallback]
  const prepared = { frames: [], complete: false, artwork: images?.length ? 'original-gif' : 'original-frame' }
  try {
    prepared.frames.push(await prepareFrameIncrementally(originals[0], width, height))
  } catch (error) {
    images?.forEach(image => image.close())
    throw error
  }
  // Display the first clean frame immediately. Keep it steady until the rest is
  // prepared, and retain one shared atlas for subsequent widget opens.
  prepared.finished = (async () => {
    try {
      for (let i = 1; i < originals.length; i++) {
        prepared.frames.push(await prepareFrameIncrementally(originals[i], width, height))
      }
    } catch {
      // A usable first frame can still perform every procedural expression.
      prepared.frames.length = 1
    } finally {
      images?.forEach(image => image.close())
      prepared.complete = true
    }
  })()
  return prepared
}

export async function loadPotRenderer(canvas, src, fallback) {
  const key = `${src}:${canvas.width}:${canvas.height}`
  if (cachedArtwork?.key !== key) {
    cachedArtwork = { key, promise: prepareArtwork(src, fallback, canvas.width, canvas.height) }
  }
  const entry = cachedArtwork
  try {
    const prepared = await entry.promise
    return { render: createPreparedRenderer(canvas, prepared), artwork: prepared.artwork, finished: prepared.finished }
  } catch (error) {
    if (cachedArtwork === entry) cachedArtwork = undefined
    throw error
  }
}

function createPreparedRenderer(canvas, prepared) {
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Canvas unavailable")
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = "high"
  const { frames } = prepared
  const frameCount = () => prepared.complete ? frames.length : 1
  let active

  function feature(part, scaleX = 1, scaleY = 1, rotation = 0, y = 0) {
    context.save()
    context.translate(part.x + part.width / 2, part.y + part.height / 2 + y)
    context.rotate(rotation * Math.PI / 180)
    context.scale(scaleX, scaleY)
    context.drawImage(part.canvas, -part.width / 2, -part.height / 2, part.width, part.height)
    context.restore()
  }

  function face(pose) {
    feature(active.leftBrow, 1, 1, pose.browLeft, pose.browLift)
    feature(active.rightBrow, 1, 1, pose.browRight, pose.browLift)
    const mouthOpen = Math.max(0, Math.min(1, pose.mouthOpen || 0))
    context.globalAlpha = 1 - Math.min(1, mouthOpen * 3)
    feature(active.mouth, pose.mouthWidth, pose.mouthHeight)
    context.globalAlpha = Math.min(1, mouthOpen * 3)
    if (mouthOpen > 0) {
      context.save()
      context.translate(active.faceMount.x, active.faceMount.y)
      context.rotate(active.faceMount.angle)
      context.translate(48 - 48.04, 61.5 - 62.83)
      context.scale(pose.mouthWidth, 1)
      context.beginPath()
      context.moveTo(-3.1, -0.6)
      context.quadraticCurveTo(0, 0.3 - mouthOpen, 3.1, -0.6)
      context.bezierCurveTo(3.1, 0.7 + 3.1 * mouthOpen, -3.1, 0.7 + 3.1 * mouthOpen, -3.1, -0.6)
      context.fillStyle = '#554743'
      context.fill()
      context.save()
      context.clip()
      context.beginPath()
      context.ellipse(0, 1.5 + 1.7 * mouthOpen, 2, 1, 0, 0, Math.PI * 2)
      context.fillStyle = '#d78b8a'
      context.fill()
      context.restore()
      context.restore()
    }
    context.globalAlpha = Math.max(0, Math.min(0.65, pose.blush || 0))
    context.drawImage(active.cheeks.canvas, 0, 0)
    context.globalAlpha = 1
  }

  function body(y, height, articulated) {
    const head = articulated ? active.bareHead : active.head
    const sx = head.canvas.width / 96, sy = head.canvas.height / 96
    context.drawImage(head.canvas, 0, y * sy, 96 * sx, height * sy, 0, y, 96, height)
  }

  function drawHandles(pose) {
    active.handles.parts.forEach((part, side) => {
      const angle = Math.max(-10, Math.min(10, (side ? pose.handleRight : pose.handleLeft) || 0))
      context.save()
      context.translate(part.hinge.x, part.hinge.y)
      context.rotate(angle * (side ? -1 : 1) * Math.PI / 180)
      context.drawImage(part.canvas, -part.hinge.x, -part.hinge.y, 96, 96)
      context.restore()
    })
  }

  function render(pose, frameIndex = 0) {
    active = frames[frameIndex % frameCount()]
    context.setTransform(canvas.width / 96, 0, 0, canvas.height / 96, 0, 0)
    context.clearRect(0, 0, 96, 96)
    context.save()
    context.translate(48 + (pose.shiftX || 0), 60 + pose.lift)
    context.rotate(pose.tilt * Math.PI / 180)
    context.translate(-48, -60)
    const lidOpen = Math.max(0, Math.min(1, pose.lidOpen || 0))
    const bow = Math.max(0, Math.min(28, pose.bow || 0)) * Math.PI / 180
    const articulated = Math.abs(pose.handleLeft || 0) + Math.abs(pose.handleRight || 0) > 0.01
    if (!lidOpen && !bow) {
      if (articulated) drawHandles(pose)
      body(26, 70, articulated)
      face(pose)
    } else {
      // Draw each original layer directly at the output resolution, without
      // repeatedly resampling the face and contour through intermediate canvases.
      const frontScale = Math.cos(bow)
      const nod = Math.sin(bow) * 7
      context.save()
      context.translate(0, 45 + nod)
      context.scale(1, frontScale)
      context.translate(0, -45)
      if (articulated) drawHandles(pose)
      body(45, 51, articulated)
      face(pose)
      context.restore()
      if (lidOpen) {
        context.globalAlpha = Math.min(1, lidOpen * 3)
        context.fillStyle = '#555552'
        context.beginPath()
        context.ellipse(48, 44.5 + nod, 22, 2.1, 0, 0, Math.PI * 2)
        context.fill()
        context.globalAlpha = 1
      }
      context.save()
      context.translate(48, 44 + nod - lidOpen * 5)
      context.rotate(-lidOpen * 10 * Math.PI / 180)
      context.scale(1, 1 + Math.sin(bow) * 0.15)
      const lid = articulated ? active.bareLid.canvas : active.lid.canvas
      context.drawImage(lid, 0, 26 * lid.height / 96, lid.width, 19 * lid.height / 96, -48, -18, 96, 19)
      context.restore()
    }
    context.drawImage(active.source.canvas, 0, 0, 96, 26,
      pose.steam * 0.4 - lidOpen, -Math.abs(pose.steam) - lidOpen * 3, 96, 26)
    context.restore()
  }
  Object.defineProperty(render, 'frameCount', { get: frameCount })
  return render
}

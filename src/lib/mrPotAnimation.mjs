export const POT_REST = Object.freeze({
  tilt: 0, lift: 0, steam: 0, gazeX: 0, gazeY: 0, eyeLeft: 1, eyeRight: 1,
  browLeft: 0, browRight: 0, browLift: 0, mouthWidth: 1, mouthHeight: 1,
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

// Lift tiny face features from the original GIF, never redraw the character.
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

function splitEye(eye, pupilX) {
  const white = surface(eye.width, eye.height)
  white.context.drawImage(eye.canvas, 0, 0)
  const pixels = white.context.getImageData(0, 0, eye.width, eye.height)
  const pupil = surface(eye.width, eye.height)
  const ink = pupil.context.createImageData(eye.width, eye.height)
  for (let y = 3; y < 8; y++) {
    for (let x = pupilX; x < pupilX + 4; x++) {
      const i = (y * eye.width + x) * 4
      if (!pixels.data[i + 3]) continue
      const opacity = Math.max(0, Math.min(1, (250 - pixels.data[i]) / 194))
      ink.data.set([56, 54, 54, Math.round(opacity * 255)], i)
      pixels.data.set([250, 250, 247, 255], i)
    }
  }
  white.context.putImageData(pixels, 0, 0)
  pupil.context.putImageData(ink, 0, 0)
  return { white, pupil }
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

export function createPotRenderer(canvas, images) {
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Canvas unavailable")
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = "high"
  const frames = (Array.isArray(images) ? images : [images]).map(image => {
    const source = surface(96, 96)
    source.context.drawImage(image, 0, 0, 96, 96)
    const base = surface(96, 96)
    base.context.drawImage(source.canvas, 0, 0)
    const left = liftFeature(source, base, 35, 52, 8, 10)
    const right = liftFeature(source, base, 53, 52, 8, 10)
    const leftBrow = liftFeature(source, base, 34, 47, 7, 5)
    const rightBrow = liftFeature(source, base, 54, 47, 8, 5)
    const mouth = liftFeature(source, base, 44, 59, 8, 5)
    return { source, base, left, right, leftBrow, rightBrow, mouth,
      eyes: [splitEye(left, 2), splitEye(right, 1)] }
  })
  const eyeFrame = surface(16, 20)
  const frame = surface(192, 192)
  frame.context.scale(2, 2)
  let active

  function feature(part, scaleX = 1, scaleY = 1, rotation = 0, y = 0, texture = part.canvas) {
    frame.context.save()
    frame.context.translate(part.x + part.width / 2, part.y + part.height / 2 + y)
    frame.context.rotate(rotation * Math.PI / 180)
    frame.context.scale(scaleX, scaleY)
    frame.context.drawImage(texture, -part.width / 2, -part.height / 2, part.width, part.height)
    frame.context.restore()
  }

  function render(pose, frameIndex = 0) {
    active = frames[frameIndex % frames.length]
    context.setTransform(canvas.width / 96, 0, 0, canvas.height / 96, 0, 0)
    context.clearRect(0, 0, 96, 96)
    if (Object.keys(POT_REST).every(key => pose[key] === POT_REST[key])) {
      context.drawImage(active.source.canvas, 0, 0, 96, 96)
      return
    }
    frame.context.clearRect(0, 0, 96, 96)
    frame.context.drawImage(active.base.canvas, 0, 0, 96, 96)
    for (const [i, eye] of [active.left, active.right].entries()) {
      eyeFrame.context.setTransform(2, 0, 0, 2, 0, 0)
      eyeFrame.context.clearRect(0, 0, 8, 10)
      eyeFrame.context.drawImage(active.eyes[i].white.canvas, 0, 0)
      eyeFrame.context.drawImage(active.eyes[i].pupil.canvas,
        Math.max(-0.85, Math.min(0.85, pose.gazeX)), Math.max(-0.65, Math.min(0.65, pose.gazeY)))
      eyeFrame.context.globalCompositeOperation = "destination-in"
      eyeFrame.context.drawImage(eye.canvas, 0, 0)
      eyeFrame.context.globalCompositeOperation = "source-over"
      feature(eye, 1, i === 0 ? pose.eyeLeft : pose.eyeRight, 0, 0, eyeFrame.canvas)
    }
    feature(active.leftBrow, 1, 1, pose.browLeft, pose.browLift)
    feature(active.rightBrow, 1, 1, pose.browRight, pose.browLift)
    feature(active.mouth, pose.mouthWidth, pose.mouthHeight)
    context.save()
    context.translate(48, 60 + pose.lift)
    context.rotate(pose.tilt * Math.PI / 180)
    context.translate(-48, -60)
    context.drawImage(frame.canvas, 0, 52, 192, 140, 0, 26, 96, 70)
    context.drawImage(active.source.canvas, 0, 0, 96, 26,
      pose.steam * 0.4, -Math.abs(pose.steam), 96, 26)
    context.restore()
  }
  render.frameCount = frames.length
  return render
}

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

const TEXTURE_SCALE = 4

function smoothArtwork(source) {
  const size = 96 * TEXTURE_SCALE
  const result = surface(size, size)
  result.context.drawImage(source, 0, 0, size, size)
  const pixels = result.context.getImageData(0, 0, size, size)
  let input = new Float32Array(pixels.data.length)
  let output = new Float32Array(input.length)
  for (let i = 0; i < input.length; i += 4) {
    const alpha = pixels.data[i + 3] / 255
    for (let c = 0; c < 3; c++) input[i + c] = pixels.data[i + c] * alpha
    input[i + 3] = pixels.data[i + 3]
  }
  // Smooth the low-resolution contour once in premultiplied color space.
  // This avoids dark fringes and works without browser-specific canvas filters.
  for (let pass = 0; pass < 4; pass++) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const at = (y * size + x) * 4
      for (let c = 0; c < 4; c++) {
        let sum = 0
        for (let offset = -2; offset <= 2; offset++) {
          const sx = pass % 2 ? x : Math.max(0, Math.min(size - 1, x + offset))
          const sy = pass % 2 ? Math.max(0, Math.min(size - 1, y + offset)) : y
          sum += input[(sy * size + sx) * 4 + c]
        }
        output[at + c] = sum / 5
      }
    }
    ;[input, output] = [output, input]
  }
  for (let i = 0; i < input.length; i += 4) {
    const alpha = input[i + 3] / 255
    for (let c = 0; c < 3; c++) pixels.data[i + c] = alpha ? input[i + c] / alpha : 0
    pixels.data[i + 3] = Math.max(0, Math.min(1, (alpha - 0.12) / 0.76)) * 255
  }
  result.context.putImageData(pixels, 0, 0)
  // Keep the original steam and tiny facial details sharp.
  result.context.clearRect(0, 0, size, 26 * TEXTURE_SCALE)
  result.context.drawImage(source, 0, 0, 96, 26, 0, 0, size, 26 * TEXTURE_SCALE)
  result.context.drawImage(source, 31, 45, 34, 21,
    31 * TEXTURE_SCALE, 45 * TEXTURE_SCALE, 34 * TEXTURE_SCALE, 21 * TEXTURE_SCALE)
  return result
}

export function createPotRenderer(canvas, image) {
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Canvas unavailable")
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = "high"
  const source = surface(96, 96)
  // drawImage uses the GIF's default frame, so all texture pieces stay aligned.
  source.context.drawImage(image, 0, 0, 96, 96)
  const base = surface(96, 96)
  base.context.drawImage(source.canvas, 0, 0)
  const left = liftFeature(source, base, 35, 52, 8, 10)
  const right = liftFeature(source, base, 53, 52, 8, 10)
  const leftBrow = liftFeature(source, base, 34, 47, 7, 5)
  const rightBrow = liftFeature(source, base, 54, 47, 8, 5)
  const mouth = liftFeature(source, base, 44, 59, 8, 5)
  const eyes = [splitEye(left, 2), splitEye(right, 1)]
  const smoothSource = smoothArtwork(source.canvas)
  const smoothBase = smoothArtwork(base.canvas)
  const eyeFrame = surface(16, 20)
  const frame = surface(96 * TEXTURE_SCALE, 96 * TEXTURE_SCALE)
  frame.context.scale(TEXTURE_SCALE, TEXTURE_SCALE)

  function feature(part, scaleX = 1, scaleY = 1, rotation = 0, y = 0, texture = part.canvas) {
    frame.context.save()
    frame.context.translate(part.x + part.width / 2, part.y + part.height / 2 + y)
    frame.context.rotate(rotation * Math.PI / 180)
    frame.context.scale(scaleX, scaleY)
    frame.context.drawImage(texture, -part.width / 2, -part.height / 2, part.width, part.height)
    frame.context.restore()
  }

  return function render(pose) {
    context.setTransform(canvas.width / 96, 0, 0, canvas.height / 96, 0, 0)
    context.clearRect(0, 0, 96, 96)
    if (Object.keys(POT_REST).every(key => pose[key] === POT_REST[key])) {
      context.drawImage(smoothSource.canvas, 0, 0, 96, 96)
      return
    }
    frame.context.clearRect(0, 0, 96, 96)
    frame.context.drawImage(smoothBase.canvas, 0, 0, 96, 96)
    for (const [i, eye] of [left, right].entries()) {
      eyeFrame.context.setTransform(2, 0, 0, 2, 0, 0)
      eyeFrame.context.clearRect(0, 0, 8, 10)
      eyeFrame.context.drawImage(eyes[i].white.canvas, 0, 0)
      eyeFrame.context.drawImage(eyes[i].pupil.canvas,
        Math.max(-0.85, Math.min(0.85, pose.gazeX)), Math.max(-0.65, Math.min(0.65, pose.gazeY)))
      eyeFrame.context.globalCompositeOperation = "destination-in"
      eyeFrame.context.drawImage(eye.canvas, 0, 0)
      eyeFrame.context.globalCompositeOperation = "source-over"
      feature(eye, 1, i === 0 ? pose.eyeLeft : pose.eyeRight, 0, 0, eyeFrame.canvas)
    }
    feature(leftBrow, 1, 1, pose.browLeft, pose.browLift)
    feature(rightBrow, 1, 1, pose.browRight, pose.browLift)
    feature(mouth, pose.mouthWidth, pose.mouthHeight)
    context.save()
    context.translate(48, 60 + pose.lift)
    context.rotate(pose.tilt * Math.PI / 180)
    context.translate(-48, -60)
    context.drawImage(frame.canvas, 0, 26 * TEXTURE_SCALE, 96 * TEXTURE_SCALE, 70 * TEXTURE_SCALE, 0, 26, 96, 70)
    context.drawImage(smoothSource.canvas, 0, 0, 96 * TEXTURE_SCALE, 26 * TEXTURE_SCALE,
      pose.steam * 0.4, -Math.abs(pose.steam), 96, 26)
    context.restore()
  }
}

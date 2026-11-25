// How the guide's Mr. Pot is drawn.
//
// The figure is the illustration in /assets/images/mr-pot-tour-guide.png, cut into parts that
// turn on their joints. His face and his steam are drawn over it as shapes: they were measured
// from the illustration, so at rest they sit exactly on the painted ones, and unlike paint they
// can blink, look around, talk and drift. Everything here is on the illustration's own grid.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const round = value => Math.round(value * 100) / 100

export const PET_ART = Object.freeze({
  href: '/assets/images/mr-pot-tour-guide.png',
  width: 1224, height: 1285,
  feet: [600, 1150],    // where he stands: leaning and squashing happen about this point
  grip: [600, 560],     // where a visitor holds him: he swings from here while carried
  neck: [600, 760], lid: [600, 425],
  middle: [606, 690],   // what he turns about when he goes head over heels
  shoulders: [[465, 785], [760, 815]], hips: [[515, 1000], [700, 1000]],
  ink: '#262525', skin: '#b5b4b4', white: '#fdfcfd', blush: '#fd8d7f', vapour: '#e9eaee', inside: '#4b4a4a',
})

// Measured from the illustration: [centre x, centre y, radius x, radius y].
export const PET_EYES = Object.freeze([
  { rim: [487.5, 577.5, 46, 55], pupil: [493.5, 578.5, 25, 33], glint: [494, 562.5, 7.5, 8], cheek: [440, 650, 38] },
  { rim: [713.5, 577.5, 46, 55], pupil: [706.5, 578.5, 25, 33], glint: [702, 562.5, 7.5, 8], cheek: [759.5, 650, 38] },
])
export const PET_BROWS = Object.freeze([
  { d: 'M452 492.5Q470 470 492 475.5', centre: [472, 482], inward: 1 },
  { d: 'M709 475.5Q731 470 749 492.5', centre: [729, 482], inward: -1 },
])
const RIM = 7.5              // width of the dark line round each eye
const MOUTH = { x: 600, y: 623.5, half: 37.5, depth: 23 }
export const PET_MOUTH_PARTS = 0.03   // below this the lips are together and the mouth is a line
const WISPS = [
  { x: 555, base: 204, length: 166, sway: 13, width: 35, phase: 0 },
  { x: 661, base: 204, length: 140, sway: 10.5, width: 31, phase: 0 },
]

/** The mouth: the painted smile when closed, an opening with lips when he talks. */
export function petMouth({ smile = 1, open = 0, wide = 1 } = {}) {
  const half = MOUTH.half * clamp(wide, 0.4, 1.3), depth = MOUTH.depth * clamp(smile, -1.2, 1.5)
  const left = round(MOUTH.x - half), right = round(MOUTH.x + half), y = MOUTH.y, reach = half * 0.41
  const curve = bottom => `C${round(left + reach)} ${round(y + bottom * 4 / 3)} ${round(right - reach)} ${round(y + bottom * 4 / 3)}`
  if (open < PET_MOUTH_PARTS) return { d: `M${left} ${y}${curve(depth)} ${right} ${y}`, filled: false }
  // The upper lip flattens as the mouth opens and the lower one drops away from it.
  const upper = depth * 0.3 * (1 - clamp(open, 0, 1)), lower = Math.max(depth, upper + 6) + clamp(open, 0, 1) * 54
  return {
    d: `M${left} ${y}Q${MOUTH.x} ${round(y + upper * 2)} ${right} ${y}C${round(right - reach)} ${round(y + lower * 4 / 3)} ${round(left + reach)} ${round(y + lower * 4 / 3)} ${left} ${y}Z`,
    filled: true,
  }
}

/** One wisp of steam: the painted S at rest, rippling upward from where it leaves the lid. */
export function petWisp(wisp, { clock = 0, lean = 0, amount = 0.8 } = {}) {
  const length = wisp.length * clamp(0.55 + 0.5625 * amount, 0.3, 1.25), steps = 12, drift = clock * 0.34
  const wave = (u, shift) => Math.sin(2 * Math.PI * (1.32 * u - 0.146 + wisp.phase - shift))
  const spine = []
  // Points crowd toward both ends, where the outline turns back on itself.
  const share = i => (1 - Math.cos(Math.PI * i / steps)) / 2
  for (let i = 0; i <= steps; i++) {
    const u = share(i)
    // The foot of the wisp stays on the lid while the ripple runs up it; a moving pot leaves the top behind.
    spine.push([wisp.x + wisp.sway * (wave(u, drift) - (1 - u) * (1 - u) * (wave(0, drift) - wave(0, 0))) + lean * u * u * 3.2, wisp.base - length * u])
  }
  const left = [], right = []
  for (let i = 0; i <= steps; i++) {
    const u = share(i), before = spine[Math.max(0, i - 1)], after = spine[Math.min(steps, i + 1)]
    const along = Math.hypot(after[0] - before[0], after[1] - before[1]) || 1
    // Thickness is measured across the wisp, not across the page, or it thins wherever it slants.
    const nx = -(after[1] - before[1]) / along, ny = (after[0] - before[0]) / along
    const half = wisp.width / 2 * Math.pow(Math.sin(Math.PI * u), 0.34)
    left.push([spine[i][0] - nx * half, spine[i][1] - ny * half]); right.push([spine[i][0] + nx * half, spine[i][1] + ny * half])
  }
  const outline = [...left, ...right.reverse()]
  // A closed curve through the midpoints of the outline, so the tips come out round.
  const mid = (a, b) => [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)]
  let d = `M${mid(outline[outline.length - 1], outline[0]).join(' ')}`
  for (let i = 0; i < outline.length; i++) {
    const next = outline[(i + 1) % outline.length]
    d += `Q${round(outline[i][0])} ${round(outline[i][1])} ${mid(outline[i], next).join(' ')}`
  }
  return `${d}Z`
}

// How far down the lid comes before its edge stops: past this the eye is shut, and the rest of the
// way only tucks the last of it out of sight.
const LID_RESTS = 0.78

// An eye never changes shape: a lid comes down over it. The edge of the lid is the dark line of a
// closed eye, curving down when he blinks or dozes and up when he beams.
function eye(shape, pose) {
  const [cx, cy, rx, ry] = shape.rim
  const wide = pose.eye > 1 ? 1 + (Math.min(pose.eye, 1.2) - 1) * 0.6 : 1, joy = clamp(pose.joy, 0, 1)
  // The last tenth of opening is the spring easing to a stop; the lid is already out of sight by then,
  // or its edge would hang on the top of the eye for a moment after every blink.
  const shut = Math.max(clamp((1 - pose.eye - 0.1) / 0.9, 0, 1), joy)
  const top = cy - ry * wide - 10, travel = cy + 36 - top
  const edge = amount => { const ends = top + amount * travel; return [ends, ends - 16 + amount * 76] }
  const [coverEnds, coverMiddle] = edge(shut)
  let [lashEnds, lashMiddle] = edge(Math.min(shut, LID_RESTS)), half = rx + 3
  lashEnds += (cy + 16 - lashEnds) * joy; lashMiddle += (cy - 46 - lashMiddle) * joy; half += (39 - half) * joy
  const px = clamp(pose.px, -10, 10), py = clamp(pose.py, -9, 9)
  const [ix, iy, irx, iry] = shape.pupil, [gx, gy, grx, gry] = shape.glint
  return {
    rim: { cx, cy, rx: round(rx * wide), ry: round(ry * wide) },
    white: { cx, cy: round(cy + 0.5), rx: round(rx * wide - RIM), ry: round(ry * wide - RIM) },
    pupil: { cx: round(ix + px), cy: round(iy + py), rx: irx, ry: iry },
    glint: { cx: round(gx + px), cy: round(gy + py), rx: grx, ry: gry },
    // The lid itself: everything above its edge, painted over the eye.
    lid: `M${cx - rx - 10} ${round(top - 6)}H${cx + rx + 10}V${round(coverEnds)}Q${cx} ${round(coverMiddle)} ${cx - rx - 10} ${round(coverEnds)}Z`,
    lash: { d: `M${round(cx - half)} ${round(lashEnds)}Q${cx} ${round(lashMiddle)} ${round(cx + half)} ${round(lashEnds)}`, opacity: shut > 0.02 ? 1 : 0 },
  }
}

/** Everything the figure needs for one frame: a transform per part and the shapes of the face. */
export function petFigure(pose) {
  const [fx, fy] = PET_ART.feet, [gx, gy] = PET_ART.grip, [nx, ny] = PET_ART.neck, [lx, ly] = PET_ART.lid
  const squash = clamp(pose.squash + (pose.breath || 0), -0.22, 0.32)
  // A twirl is a turn about his own axis: flat on, he is as wide as he is; side on, almost nothing.
  const facing = clamp(pose.turn, -1.06, 1.06) * Math.cos(2 * Math.PI * (pose.twirl || 0))
  const turn = (facing < 0 ? -1 : 1) * Math.max(0.14, Math.abs(facing))
  const lid = Math.max(-2, pose.lidY)
  const brow = side => {
    const shape = PET_BROWS[side], raise = side ? pose.browR : pose.browL
    return `translate(0 ${round(-raise)}) rotate(${round(-raise * 0.8 * shape.inward)} ${shape.centre[0]} ${shape.centre[1]})`
  }
  const mouth = petMouth(pose)
  return {
    figure: `translate(0 ${round(pose.lift)}) translate(${PET_ART.width / 2} 0) scale(${round(turn)} 1) translate(${-PET_ART.width / 2} 0) `
      + `rotate(${round(pose.roll || 0)} ${PET_ART.middle.join(' ')}) rotate(${round(pose.lean)} ${fx} ${fy}) translate(${fx} ${fy}) scale(${round(1 + squash * 0.6)} ${round(1 - squash)}) translate(${-fx} ${-fy}) `
      + `rotate(${round(pose.swing)} ${gx} ${gy})`,
    armL: `rotate(${round(pose.armL)} ${PET_ART.shoulders[0].join(' ')})`,
    armR: `rotate(${round(pose.armR)} ${PET_ART.shoulders[1].join(' ')})`,
    legL: `translate(0 ${round(-pose.footL)}) rotate(${round(pose.legL)} ${PET_ART.hips[0].join(' ')})`,
    legR: `translate(0 ${round(-pose.footR)}) rotate(${round(pose.legR)} ${PET_ART.hips[1].join(' ')})`,
    head: `rotate(${round(pose.head)} ${nx} ${ny}) translate(0 ${round(pose.headY)})`,
    lid: `translate(0 ${round(-lid)}) rotate(${round(pose.lidRot)} ${lx} ${ly})`,
    // What shows under a lifted lid: the dark of the pot's mouth, then air.
    inside: { y: round(425 - clamp(lid, 0, 14)), height: round(clamp(lid, 0, 14)) },
    eyes: PET_EYES.map(shape => eye(shape, pose)),
    brows: [brow(0), brow(1)],
    mouth,
    steam: WISPS.map((wisp, index) => petWisp(wisp, { clock: pose.clock * (1 + index * 0.13), lean: pose.steam, amount: pose.vapour })),
    steamOpacity: round(clamp(0.15 + 1.1 * pose.vapour, 0, 1)),
  }
}

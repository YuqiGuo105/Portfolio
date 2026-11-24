// Mr. Pot, drawn after public/assets/images/chatPot.png on a 512 grid.
// Every part that moves on its own carries a data-p name; drawPot() writes the rig's values onto them.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const n = (value, digits = 2) => Number(value).toFixed(digits)

/** Below this much opening the lips are together and the mouth is drawn as one line. */
export const MOUTH_PARTS = 0.03
const ease = (from, to, value) => { const t = clamp((value - from) / (to - from), 0, 1); return t * t * (3 - 2 * t) }

/**
 * The mouth: a line that curves with the smile, or rounds to a small "o".
 * When he speaks the same smile opens: the lower lip drops in a round curve and the upper lip
 * flattens a little. The two lips start from the closed line itself, so opening and closing is
 * one continuous movement and nothing pops in. `wide` narrows it for the rounder sounds.
 */
export function mouthPath({ smile = 1, open = 0, skew = 0, round = 0, wide = 1 } = {}) {
  const gap = clamp(open, 0, 1), dip = 10 * smile, y = smile < 0 ? 326 : 320
  if (clamp(round, 0, 1) > 0.4) {
    const r = 4.5 + clamp(round, 0, 1) * 2
    return { d: `M${n(256 - r, 1)} ${y + 5} a${n(r, 1)} ${n(r, 1)} 0 1 0 ${n(2 * r, 1)} 0 a${n(r, 1)} ${n(r, 1)} 0 1 0 ${n(-2 * r, 1)} 0 Z`, filled: true }
  }
  if (gap < MOUTH_PARTS) return { d: `M240 ${n(y + skew * 2, 1)} Q${n(256 + skew * 6, 1)} ${n(y + dip * 1.6, 1)} 272 ${n(y - skew * 5, 1)}`, filled: false }
  const sag = Math.max(dip, 0) * 0.8                      // how low the middle of the closed smile sits
  const parted = ease(MOUTH_PARTS, 0.22, gap)
  const half = 16 * (1 - (1 - clamp(wide, 0.6, 1.1)) * parted) - gap * 4
  const upper = sag + (Math.max(dip, 0) * 0.25 - sag) * parted, lower = sag + (gap - MOUTH_PARTS) * 30 + parted * 2
  const left = n(256 - half, 1), right = n(256 + half, 1), pull = half * 0.16
  // A cubic with both handles at the same depth bottoms out at three quarters of it; a quadratic at half.
  return { d: `M${left} ${y} C${n(256 - half + pull, 1)} ${n(y + lower / 0.75, 1)} ${n(256 + half - pull, 1)} ${n(y + lower / 0.75, 1)} ${right} ${y} Q256 ${n(y + upper * 2, 1)} ${left} ${y} Z`,
    filled: true, depth: lower, height: lower - upper }
}

const wisp = (x, sway, lean) => `M${x} 140 C${n(x - 13 + sway * 0.4, 1)} 124 ${n(x + 13 + sway, 1)} 110 ${n(x + sway * 0.5, 1)} 96 S${n(x - 12 + lean, 1)} 70 ${n(x + 3 + lean * 0.6, 1)} 58`

// The pot itself, lid knob to base and handle to handle, at rest on the grid. The steam is not part
// of it: the window below is centred on the pot, so wherever the drawing is centred, he is centred,
// and the steam rises past the top edge.
export const POT_BOUNDS = Object.freeze({ left: 88, top: 145, right: 424, bottom: 392 })
export const POT_VIEW_BOX = `${(POT_BOUNDS.left + POT_BOUNDS.right) / 2 - 256} ${(POT_BOUNDS.top + POT_BOUNDS.bottom) / 2 - 256} 512 512`

/**
 * The drawing at rest, as markup. `id` keeps the eyes' clip paths apart when several pots share a page.
 * It is complete on its own: without the script it is the still picture.
 */
export function potMarkup(id = 'pot') {
  const rest = mouthPath()
  return `<svg viewBox="${POT_VIEW_BOX}" focusable="false" aria-hidden="true">
<defs><clipPath id="${id}-l"><circle cx="208" cy="304" r="19"/></clipPath><clipPath id="${id}-r"><circle cx="303" cy="304" r="19"/></clipPath></defs>
<g data-p="hop">
<g data-p="steam" fill="none" stroke="#d3d3d3" stroke-width="10" stroke-linecap="round" stroke-dasharray="46 22">
<path data-p="w1" d="${wisp(236, 0, 0)}" opacity="0.44"/><path data-p="w2" d="${wisp(284, 0, 0)}" opacity="0.44"/>
<g data-p="puffs" stroke="none" fill="#dddddd"><circle r="0"/><circle r="0"/><circle r="0"/><circle r="0"/><circle r="0"/></g></g>
<g data-p="body">
<g data-p="hl"><path d="M136 262 L104 251 Q89 247 88 259 Q88 270 101 274 L136 284 Z" fill="#555" stroke="#2e2e2e" stroke-width="8" stroke-linejoin="round"/></g>
<g data-p="hr"><path d="M376 262 L408 251 Q423 247 424 259 Q424 270 411 274 L376 284 Z" fill="#555" stroke="#2e2e2e" stroke-width="8" stroke-linejoin="round"/></g>
<path d="M130 236 L382 236 L377 340 Q373 392 322 392 L190 392 Q139 392 135 340 Z" fill="#a9a9a9" stroke="#2e2e2e" stroke-width="8" stroke-linejoin="round"/>
<path d="M148 252 L151 338 Q153 368 172 379" fill="none" stroke="#c3c3c3" stroke-width="10" stroke-linecap="round"/>
<g data-p="blush" fill="#f28b82" opacity="0.9"><circle cx="186" cy="336" r="17"/><circle cx="326" cy="336" r="17"/></g>
<g fill="none" stroke="#2e2e2e" stroke-width="6" stroke-linecap="round">
<path data-p="bl" d="M191 269 Q201 258 214 262"/><path data-p="br" d="M298 262 Q311 258 321 269"/>
<path data-p="mouth" stroke-linejoin="round" d="${rest.d}"/></g>
<g data-p="el"><circle cx="208" cy="304" r="19" fill="#fff"/>
<g data-p="pl"><circle cx="208" cy="305" r="11" fill="#1c1c1c"/><circle cx="204" cy="300" r="4" fill="#fff"/></g>
<g clip-path="url(#${id}-l)"><rect data-p="ll" x="184" y="236" width="48" height="46" fill="#9c9c9c" stroke="#2e2e2e" stroke-width="5"/></g>
<circle cx="208" cy="304" r="19" fill="none" stroke="#2e2e2e" stroke-width="6"/></g>
<g data-p="er"><circle cx="303" cy="304" r="19" fill="#fff"/>
<g data-p="pr"><circle cx="303" cy="305" r="11" fill="#1c1c1c"/><circle cx="299" cy="300" r="4" fill="#fff"/></g>
<g clip-path="url(#${id}-r)"><rect data-p="lr" x="279" y="236" width="48" height="46" fill="#9c9c9c" stroke="#2e2e2e" stroke-width="5"/></g>
<circle cx="303" cy="304" r="19" fill="none" stroke="#2e2e2e" stroke-width="6"/></g>
<g fill="none" stroke="#2e2e2e" stroke-width="7" stroke-linecap="round">
<path data-p="jl" d="M191 310 Q208 288 225 310" opacity="0"/><path data-p="jr" d="M286 310 Q303 288 320 310" opacity="0"/>
<path data-p="cl" d="M190 303 Q208 311 226 303" opacity="0"/><path data-p="cr" d="M285 303 Q303 311 321 303" opacity="0"/></g>
<path data-p="sweat" d="M352 250 Q343 266 352 271 Q361 266 352 250 Z" fill="#9fd3ee" stroke="#5d9fc0" stroke-width="3" opacity="0"/>
<g data-p="lid">
<path d="M138 224 Q146 180 256 177 Q366 180 374 224 Z" fill="#5c5c5c" stroke="#2e2e2e" stroke-width="8" stroke-linejoin="round"/>
<path d="M162 212 Q176 192 228 187" fill="none" stroke="#7e7e7e" stroke-width="9" stroke-linecap="round"/>
<rect x="118" y="220" width="276" height="20" rx="9" fill="#8f8f8f" stroke="#2e2e2e" stroke-width="8"/>
<path d="M246 178 L248 166 L264 166 L266 178 Z" fill="#5c5c5c" stroke="#2e2e2e" stroke-width="8" stroke-linejoin="round"/>
<ellipse cx="256" cy="158" rx="25" ry="13" fill="#5c5c5c" stroke="#2e2e2e" stroke-width="8"/>
</g></g></g></svg>`
}

/** The named parts of one drawing. */
export function potParts(root) {
  const part = {}
  root.querySelectorAll('[data-p]').forEach(element => { part[element.dataset.p] = element })
  part.puffList = [...part.puffs.children]
  return part
}

/** Writes one frame: `s` is the rig's state, `t` its clock in seconds, `puffs` its steam puffs. */
export function drawPot(p, s, t, puffs = []) {
  const set = (element, name, value) => element.setAttribute(name, value)
  const squash = s.squash + s.breath
  set(p.hop, 'transform', `translate(0 ${n(s.lift)})`)
  set(p.body, 'transform', `rotate(${n(s.tilt)} 256 392) translate(256 392) scale(${n(1 + squash * 0.7, 4)} ${n(1 - squash, 4)}) translate(-256 -392)`)
  set(p.lid, 'transform', `translate(0 ${n(-s.lidY)}) rotate(${n(s.lidRot)} 256 232)`)
  set(p.hl, 'transform', `rotate(${n(s.hL)} 134 272)`)
  set(p.hr, 'transform', `rotate(${n(s.hR)} 378 272)`)
  set(p.bl, 'transform', `translate(0 ${n(-s.browL)})`)
  set(p.br, 'transform', `translate(0 ${n(-s.browR)})`)
  // Open eyes squash as they close; nearly shut they are one curved line. A smiling eye is an arc.
  const eye = clamp(s.eye, 0.05, 1.1), shut = eye < 0.3, joy = clamp(s.joy, 0, 1), arcLeft = Math.max(joy, clamp(s.wink, 0, 1))
  set(p.el, 'transform', `translate(208 304) scale(1 ${n(eye, 3)}) translate(-208 -304)`)
  set(p.er, 'transform', `translate(303 304) scale(1 ${n(eye, 3)}) translate(-303 -304)`)
  set(p.el, 'opacity', shut ? 0 : n(1 - arcLeft)); set(p.er, 'opacity', shut ? 0 : n(1 - joy))
  set(p.jl, 'opacity', n(arcLeft)); set(p.jr, 'opacity', n(joy))
  set(p.cl, 'opacity', shut && arcLeft < 0.5 ? 1 : 0); set(p.cr, 'opacity', shut && joy < 0.5 ? 1 : 0)
  const px = n(clamp(s.px, -7, 7)), py = n(clamp(s.py, -7, 7)), size = n(clamp(s.pupil, 0.7, 1.2), 3)
  set(p.pl, 'transform', `translate(${px} ${py}) translate(208 305) scale(${size}) translate(-208 -305)`)
  set(p.pr, 'transform', `translate(${px} ${py}) translate(303 305) scale(${size}) translate(-303 -305)`)
  const lids = n(236 + clamp(s.lids, 0, 1) * 44, 1)
  set(p.ll, 'y', lids); set(p.lr, 'y', lids)
  set(p.blush, 'opacity', n(clamp(s.blush, 0, 1)))
  const mouth = mouthPath(s)
  set(p.mouth, 'd', mouth.d); set(p.mouth, 'fill', mouth.filled ? '#43211f' : 'none')
  const sweat = clamp(s.sweat, 0, 1)
  set(p.sweat, 'opacity', n(sweat))
  set(p.sweat, 'transform', `translate(0 ${n((1 - sweat) * -8 + (sweat > 0.5 ? (t * 9) % 10 : 0), 1)})`)
  // Steam: two wisps that sway, and rise faster the hotter the pot is.
  const heat = clamp(s.steam, 0, 1.2), reach = 7 + heat * 6, rise = n(-t * (18 + heat * 60), 1), shade = n(0.22 + heat * 0.62)
  set(p.w1, 'd', wisp(236, Math.sin(t * 1.7) * reach, Math.sin(t * 2.3 + 1.4) * reach))
  set(p.w2, 'd', wisp(284, Math.sin(t * 1.7 + 2.1) * reach, Math.sin(t * 2.3 + 3.5) * reach))
  for (const line of [p.w1, p.w2]) { set(line, 'stroke-dashoffset', rise); set(line, 'opacity', shade) }
  set(p.steam, 'transform', `translate(${n(s.tilt * 1.6)} ${n(-s.lidY * 0.5)})`)
  p.puffList.forEach((circle, index) => {
    const one = puffs[index]
    if (!one || one.life < 0 || one.life >= one.span) { set(circle, 'r', 0); return }
    const age = one.life / one.span
    set(circle, 'cx', n(one.x, 1)); set(circle, 'cy', n(one.y - age * 62, 1)); set(circle, 'r', n(7 + age * 15, 1)); set(circle, 'opacity', n((1 - age) * 0.85))
  })
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createPotRig, POT_FACES, POT_REACTIONS, POT_REST, POT_SPRINGS, POT_STATES, SPEAKING_MOUTH } from '../src/lib/mrPotRig.mjs'
import { drawPot, mouthPath, potMarkup, MOUTH_PARTS, POT_BOUNDS, POT_VIEW_BOX } from '../src/lib/mrPotDrawing.mjs'

// A repeatable stream of "random" numbers, so a run can be replayed exactly.
const seeded = seed => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const run = (rig, seconds, each = () => {}) => { for (let i = 0; i < Math.round(seconds * 120); i++) { rig.step(1 / 120); each(rig.state, rig.clock) } }

test('every state and reaction has a face, and every moving part has a spring and a resting value', () => {
  assert.deepEqual(Object.keys(POT_SPRINGS).sort(), Object.keys(POT_REST).sort())
  for (const name of [...POT_STATES, ...Object.keys(POT_REACTIONS), 'sleepy']) {
    assert.ok(POT_FACES[name], name)
    for (const key of Object.keys(POT_FACES[name])) assert.ok(key in POT_REST, `${name}.${key}`)
  }
  assert.deepEqual([...POT_STATES], ['idle', 'listening', 'thinking', 'searching', 'working', 'speaking', 'success', 'error'])
  const widget = readFileSync(new URL('../src/components/MrPotAvatar.js', import.meta.url), 'utf8')
  for (const state of POT_STATES) assert.ok(widget.includes(`${state}: "Mr Pot`), `${state} is announced`)
})

test('every part stays finite and inside the drawing in every look', () => {
  for (const name of Object.keys(POT_FACES)) {
    const rig = createPotRig({ random: seeded(7) })
    if (POT_STATES.includes(name)) rig.setMood(name); else rig.react(name)
    run(rig, name === 'sleepy' ? 0 : 12, (s) => {
      for (const key of Object.keys(POT_REST)) assert.ok(Number.isFinite(s[key]), `${name}.${key}`)
      assert.ok(Math.abs(s.tilt) < 12, `${name} tilt ${s.tilt}`)
      assert.ok(s.lift > -40 && s.lift < 14, `${name} lift ${s.lift}`)
      assert.ok(s.lidY > -8 && s.lidY < 30, `${name} lid ${s.lidY}`)
      assert.ok(Math.abs(s.squash) < 0.16, `${name} squash ${s.squash}`)
    })
  }
})

test('the mouth stays small: no gape when he says hello, speaks or finishes', () => {
  const rig = createPotRig({ random: seeded(3) })
  rig.setMood('speaking')
  let widest = 0, moved = 0, previous = 0
  run(rig, 12, (s) => { widest = Math.max(widest, s.open); if (Math.abs(s.open - previous) > 0.002) moved++; previous = s.open })
  assert.ok(widest > 0.12, 'the mouth does move')
  assert.ok(widest <= SPEAKING_MOUTH[1] + 0.02, `widest ${widest}`)
  assert.ok(SPEAKING_MOUTH[1] <= 0.4)
  assert.ok(moved > 200, 'and keeps moving while he speaks')

  // Speech is phrases with a breath between them, in more than one mouth shape, and his head
  // does not bob on every syllable.
  const talk = createPotRig({ random: seeded(8) })
  talk.setMood('speaking')
  let together = 0, parted = 0, narrowest = 1, highest = 0, pauses = 0, shut = 0
  run(talk, 12, (s) => {
    if (s.open < 0.02) { together++; shut += 1 / 60 } else { parted++; if (shut > 0.22) pauses++; shut = 0 }
    narrowest = Math.min(narrowest, s.wide); highest = Math.min(highest, s.lift)
  })
  assert.ok(parted > together, `mostly open while speaking: ${parted} to ${together}`)
  assert.ok(pauses >= 4 && pauses <= 16, `breaths in twelve seconds: ${pauses}`)
  assert.ok(narrowest < 0.85, `some sounds are rounder: ${narrowest}`)
  assert.ok(highest > -4, `no hop per syllable: ${highest}`)
  assert.equal(POT_FACES.speaking.open, undefined, 'he starts a sentence with his lips together')
  for (const look of ['hello', 'success', 'shy', 'wink', 'curious']) {
    assert.ok(!POT_FACES[look].open, `${look} keeps his mouth closed`)
    assert.ok((POT_FACES[look].smile ?? 1) <= 1.3, `${look} smiles without grinning`)
  }
  // On the 512 grid the open mouth is never deeper than a tenth of his face.
  const widestMouth = mouthPath({ smile: 1, open: SPEAKING_MOUTH[1] })
  assert.ok(widestMouth.depth < 24 && widestMouth.height > 12, `depth ${widestMouth.depth}`)
  assert.equal(mouthPath({ smile: 1, open: 0 }).filled, false)
  assert.equal(mouthPath({ smile: 0, round: 1 }).filled, true)

  // Opening is one movement: the lips part from the closed smile itself, the lower lip is a round
  // curve (a cubic, not a point), and the opening only ever grows with `open`.
  assert.equal(mouthPath({ open: MOUTH_PARTS - 0.001 }).d, mouthPath({ open: 0 }).d)
  const justParted = mouthPath({ open: MOUTH_PARTS + 0.001 })
  assert.ok(justParted.filled && justParted.height < 0.2 && Math.abs(justParted.depth - 8) < 0.2, 'no jump where the lips part')
  let opening = 0
  for (let open = MOUTH_PARTS; open <= 0.4; open += 0.01) {
    const shape = mouthPath({ open })
    assert.match(shape.d, /^M[\d.]+ 320 C[\d. ]+ Q256 [\d.]+ [\d.]+ 320 Z$/)
    assert.ok(shape.height >= opening - 1e-9, `the opening grows: ${open}`)
    opening = shape.height
  }
  const corner = d => Number(d.match(/^M([\d.]+)/)[1])
  assert.ok(corner(mouthPath({ open: 0.3, wide: 0.7 }).d) > corner(mouthPath({ open: 0.3, wide: 1 }).d) + 3, 'a rounder sound is a narrower mouth')
})

test('thinking never settles into a fixed loop', () => {
  const beats = seed => {
    const rig = createPotRig({ random: seeded(seed) }), jumps = []
    rig.setMood('thinking')
    let last = 0
    run(rig, 30, (s, clock) => { if (s.lidY > 3 && last <= 3) jumps.push(clock); last = s.lidY })
    return jumps
  }
  const first = beats(11), gaps = first.slice(1).map((time, index) => +(time - first[index]).toFixed(2))
  assert.ok(first.length >= 8, `the lid jumps again and again: ${first.length}`)
  assert.ok(new Set(gaps).size >= gaps.length * 0.7, `the gaps differ: ${gaps}`)
  assert.ok(Math.max(...gaps) - Math.min(...gaps) > 0.4)
  assert.notDeepEqual(first, beats(12), 'another visit plays differently')
  assert.deepEqual(first, beats(11), 'the same seed replays exactly: all the variation comes from the random source')
})

test('at rest he blinks, fidgets and follows the pointer; left alone he gets sleepy and wakes when touched', () => {
  const rig = createPotRig({ random: seeded(5) })
  let blinks = 0, open = true
  const moved = new Set()
  run(rig, 60, (s) => {
    if (s.eye < 0.3 && open) { blinks++; open = false } else if (s.eye > 0.8) open = true
    for (const key of ['px', 'tilt', 'lidY', 'hL', 'lids', 'joy', 'wink', 'lidRot']) if (Math.abs(s[key] - POT_REST[key]) > 0.12) moved.add(key)
  })
  assert.ok(blinks >= 8 && blinks <= 40, `blinks in a minute: ${blinks}`)
  assert.ok(moved.size >= 5, `habits seen: ${[...moved]}`)

  rig.look(1, -1)
  run(rig, 0.6)
  assert.ok(rig.state.px > 3 && rig.state.py < -2, 'eyes go to the pointer')
  run(rig, 3)
  assert.ok(Math.abs(rig.state.px) < 6.5, 'and let go of it after a couple of seconds')

  const alone = createPotRig({ random: seeded(9) })
  run(alone, 95)
  assert.equal(alone.shown, 'sleepy')
  alone.key()
  assert.equal(alone.shown, 'idle', 'a keystroke wakes him')
  // Waking is a stretch, not a jump: it follows any pointer movement after a pause, so a start
  // would look like a reaction to whatever is clicked next.
  const dozing = createPotRig({ random: seeded(9) })
  run(dozing, 95)
  dozing.look(0.4, 0.6)
  let jump = 0
  run(dozing, 1.2, (s) => { jump = Math.min(jump, s.lift) })
  assert.equal(dozing.shown, 'idle')
  assert.ok(jump > -5, `waking lift ${jump}`)

  // On the launcher he never nods off.
  const launcher = createPotRig({ random: seeded(9), sleeps: false })
  run(launcher, 200)
  assert.equal(launcher.shown, 'idle')
})

test('a reaction is brief, gives way to an answer, and never interrupts one', () => {
  const rig = createPotRig({ random: seeded(2) })
  assert.equal(rig.react('shy'), true)
  assert.equal(rig.shown, 'shy')
  run(rig, 1)
  assert.ok(rig.state.py > 1 && rig.state.blush > 0.9, 'he looks down, and blushes')
  run(rig, POT_REACTIONS.shy)
  assert.equal(rig.shown, 'idle', 'then he is himself again')

  rig.react('curious')
  rig.setMood('thinking')
  assert.equal(rig.shown, 'thinking', 'the answer matters more than the reaction')
  assert.equal(rig.react('shy'), false, 'no reactions while he is busy')
  rig.setMood('speaking'); rig.setMood('success')
  assert.equal(rig.shown, 'success')
  assert.equal(rig.react('shy'), true, 'a like right after the answer is welcome')
  run(rig, POT_REACTIONS.shy + 0.1)
  assert.equal(rig.shown, 'idle', 'the celebration is not replayed after the reaction')
  assert.equal(rig.react('nonsense'), false)
  // A like taken back, or turned into a dislike, ends the blush without another reaction.
  rig.setMood('idle'); run(rig, 0.1)
  rig.react('shy'); run(rig, 0.5)
  assert.equal(rig.shown, 'shy')
  rig.settle()
  assert.equal(rig.shown, 'idle')
  rig.settle()
  assert.equal(rig.shown, 'idle', 'settling with nothing playing does nothing')
  rig.setMood('nonsense')
  assert.equal(rig.base, 'idle')

  const done = createPotRig({ random: seeded(4) })
  done.setMood('success')
  let highest = 0
  run(done, 3, s => { highest = Math.min(highest, s.lift) })
  assert.ok(highest < -6 && highest > -30, `a small hop: ${highest}`)
  run(done, 1)
  assert.equal(done.shown, 'idle', 'he settles after a finished answer')

  const typing = createPotRig({ random: seeded(6) })
  // The widget does both on the first character: the state first, then the reaction.
  typing.setMood('listening')
  assert.equal(typing.react('curious'), true, 'the first key is the moment for a curious look')
  assert.equal(typing.shown, 'curious')
  run(typing, POT_REACTIONS.curious + 0.1)
  assert.equal(typing.shown, 'listening', 'then he goes back to listening, not to rest')
  run(typing, 1)
  const before = typing.state.lift
  typing.key(); run(typing, 0.08)
  assert.ok(typing.state.lift > before + 1, 'each keystroke is a nod')
})

test('with reduced motion he holds the right face and does not move', () => {
  const rig = createPotRig({ random: seeded(1), still: () => true })
  rig.setMood('thinking')
  run(rig, 5, (s) => { assert.equal(s.lift, 0); assert.equal(s.lidY, 0); assert.equal(s.breath, 0) })
  assert.equal(rig.state.py, POT_FACES.thinking.py)
  rig.setMood('error')
  rig.step(1 / 60)
  assert.equal(rig.state.smile, POT_FACES.error.smile)
  assert.equal(rig.puffs.length, 0)
})

test('the drawing is whole without the script, and draws every part every frame', () => {
  const markup = potMarkup('potA')
  // The window onto the grid is centred on the pot, not on the pot and its steam.
  assert.equal(POT_VIEW_BOX, '0 12.5 512 512')
  assert.ok(markup.startsWith(`<svg viewBox="${POT_VIEW_BOX}"`))
  const [, top, , height] = POT_VIEW_BOX.split(' ').map(Number)
  assert.equal(top + height / 2, (POT_BOUNDS.top + POT_BOUNDS.bottom) / 2)
  assert.equal(256, (POT_BOUNDS.left + POT_BOUNDS.right) / 2)
  assert.ok(markup.includes('id="potA-l"') && markup.includes('url(#potA-l)') && !potMarkup('potB').includes('potA'))
  assert.doesNotMatch(markup, /<script|on\w+=|href=|url\(http/i)
  const names = [...markup.matchAll(/data-p="(\w+)"/g)].map(match => match[1])
  assert.equal(new Set(names).size, names.length, 'part names are unique')
  // A stand-in for the DOM: record what each part was told.
  const written = {}
  const part = Object.fromEntries(names.map(name => [name, { setAttribute: (key, value) => { (written[name] ||= {})[key] = String(value) } }]))
  part.puffList = Array.from({ length: 5 }, (_, index) => ({ setAttribute: (key, value) => { (written[`puff${index}`] ||= {})[key] = String(value) } }))
  const rig = createPotRig({ random: seeded(8) })
  rig.setMood('thinking')
  run(rig, 2)
  drawPot(part, rig.state, rig.clock, rig.puffs)
  for (const name of ['hop', 'body', 'lid', 'hl', 'hr', 'bl', 'br', 'el', 'er', 'pl', 'pr', 'll', 'lr', 'mouth', 'blush', 'w1', 'w2', 'steam', 'sweat', 'jl', 'jr', 'cl', 'cr']) {
    assert.ok(written[name], `${name} is drawn`)
    for (const value of Object.values(written[name])) assert.doesNotMatch(value, /NaN|undefined|Infinity/, `${name}: ${value}`)
  }
  const component = readFileSync(new URL('../src/components/MrPotAvatar.js', import.meta.url), 'utf8')
  assert.ok(component.includes('prefers-reduced-motion') && component.includes('IntersectionObserver') && component.includes('visibilitychange'))
  assert.doesNotMatch(component, /canvas|\.gif/)
})

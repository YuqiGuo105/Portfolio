// How the guide's Mr. Pot moves.
//
// He is a puppet of springs, like the one in the chat window (mrPotRig.mjs), with a body: every
// joint is pulled toward what the moment asks for, and loose joints overshoot, so an arm keeps
// swinging after the body stops. Getting somewhere is part of the performance. A few steps cover
// a short way, with the legs in time with the ground so the feet do not slide; anything further is
// a jump with a crouch, an arc and a landing. A page that scrolls under him carries him along.
// No DOM and no timers here: the caller advances the clock with step() and draws the result.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const sign = value => (value < 0 ? -1 : 1)

// [stiffness, damping]. Angles are degrees; lift, lid, feet, brows and pupils are on the
// illustration's grid (1224 wide). Low damping overshoots: arms and lid do, the pupils do not.
export const PET_SPRINGS = Object.freeze({
  lean: [170, 15], swing: [58, 5.5], squash: [300, 16], lift: [280, 17], head: [150, 11], headY: [300, 17], lidY: [430, 13], lidRot: [300, 10],
  armL: [110, 9], armR: [150, 12], legL: [200, 14], legR: [200, 14], footL: [320, 22], footR: [320, 22], steam: [26, 6], vapour: [30, 10],
  eye: [900, 48], px: [420, 34], py: [420, 34], browL: [260, 20], browR: [260, 20], open: [420, 37], wide: [380, 35], smile: [300, 24], joy: [520, 40],
  turn: [520, 36], scale: [60, 13], hold: [140, 20],
})

export const PET_REST = Object.freeze({
  lean: 0, swing: 0, squash: 0, lift: 0, head: 0, headY: 0, lidY: 0, lidRot: 0, armL: 0, armR: 0, legL: 0, legR: 0, footL: 0, footR: 0, steam: 0, vapour: 0.8,
  eye: 1, px: 0, py: 0, browL: 0, browR: 0, open: 0, wide: 1, smile: 1, joy: 0, turn: 1, scale: 1, hold: 0,
})

// The little performances he gives: while a visitor reads, when they play with him, and when he has finished speaking.
export const PET_GESTURES = Object.freeze(['curious', 'stretch', 'happy', 'balance', 'sleepy', 'greet', 'tiphat', 'dance', 'boil', 'spin', 'flip', 'bow'])

// What each moment asks of him, in his own frame: leaning forward is toward the hand that points.
export const PET_POSES = Object.freeze({
  idle: {},
  speaking: { browL: 3, browR: 3, armR: -3, vapour: 1 },
  waiting: { squash: 0.07, lean: -2, armL: 12, armR: -5, browL: 6, browR: 6, vapour: 1 },
  walk: { lean: 3.5, armR: 3, browL: 2, browR: 2 },
  hop: { armL: 24, armR: -9, browL: 7, browR: 7, open: 0.2, wide: 0.72, vapour: 1 },
  held: { armL: 30, armR: -13, browL: 9, browR: 9, eye: 1.12, open: 0.3, wide: 0.6, smile: 0.2, vapour: 0.5 },
  curious: { head: -7, lean: 2, browL: 10, browR: 2, armR: -7, smile: 0.6 },
  stretch: { squash: -0.09, lift: -8, armL: 34, armR: -15, head: -2, eye: 0.08, browL: 6, browR: 6, open: 0.36, wide: 0.66, vapour: 0.4 },
  happy: { armL: 26, armR: -11, joy: 1, smile: 1.35, browL: 5, browR: 5, vapour: 1 },
  balance: { lean: 5, head: -4, armL: 32, armR: -4, legL: 9, footL: 42, browL: -4, browR: -4, py: 5, smile: 0.5 },
  sleepy: { head: 6, headY: 8, eye: 0.42, browL: -2, browR: -2, smile: 0.5, armR: 6, vapour: 0.15 },
  greet: { head: -4, armR: -12, smile: 1.3, browL: 5, browR: 5 },
  tiphat: { lidY: 62, lidRot: 15, lean: 5, head: 5, headY: 6, eye: 0, smile: 1.25, armR: -6, browL: 4, browR: 4 },
  dance: { joy: 1, smile: 1.3, vapour: 1 },
  boil: { browL: -6, browR: -6, smile: 0.2, squash: 0.04, py: -5, vapour: 1.2 },
  spin: { squash: 0.14, armL: -4 },
  flip: { squash: 0.18, armL: -6, lean: -4 },
  bow: { lean: 13, head: 7, headY: 6, eye: 0, armL: 12, armR: 9, smile: 1.2 },
})

const NO_BLINK = new Set(['hop', 'held', 'stretch', 'happy', 'sleepy', 'tiphat', 'dance', 'boil', 'spin', 'flip', 'bow'])
// The widest the mouth opens while he narrates, as a share of fully open. Kept small on purpose.
export const PET_SPEAKING_MOUTH = Object.freeze([0.14, 0.34])
const CROUCH = 0.12          // seconds he gathers himself before a jump
const STRIDE = 0.34          // length of one step, in body widths
const CARRIED = 0.07         // seconds to catch up with a page that scrolls under him
const DEFAULT_GESTURE = 3    // seconds
const SPRING_STEP = 1 / 120  // seconds: the longest step the springs are advanced by

/** Whether a move is a few steps or a jump, and how long it takes. Lengths are in body widths. */
export function planPetMove(dx, dy, width) {
  const gap = Math.hypot(dx, dy) / width
  if (Math.abs(dy) < 0.28 * width && gap < 2.4) return { kind: 'walk', duration: clamp(gap / 2.5, 0.34, 0.95), height: 0 }
  return { kind: 'hop', duration: clamp(0.36 + 0.105 * gap, 0.42, 0.86), height: clamp(0.24 * gap, 0.34, 0.95) * width }
}

export function createTourPetRig({ random = Math.random, still = () => false, width = 144 } = {}) {
  const state = { breath: 0 }, speed = {}, goal = {}, sway = {}
  const keys = Object.keys(PET_SPRINGS)
  for (const key of keys) { state[key] = PET_REST[key]; speed[key] = 0; goal[key] = PET_REST[key]; sway[key] = 0 }
  const rand = (min, max) => min + random() * (max - min)
  let clock = 0, tasks = [], look = 0, shown = ''
  const pos = { x: 0, y: 0 }, home = { x: 0, y: 0 }, vel = { x: 0, y: 0 }, slip = { x: 0, y: 0 }, was = { x: 0, y: 0 }
  let size = width, facing = 1, move = null, air = 0, gait = 0, pace = 0, placed = false, stage = 1
  let held = false, speaking = false, waiting = false, waited = -1, act = null, attend = null
  const gaze = { x: 0, y: 0, until: 0 }
  let busyUntil = 0
  // A jump on the spot inside a performance, and the turns that go with it: timed, not sprung.
  let jump = null, glides = []
  const turns = { twirl: 0, roll: 0 }

  const to = values => Object.assign(goal, values)
  const kick = (key, amount) => { if (!still()) speed[key] += amount }
  const later = (fn, seconds) => { tasks.push({ at: clock + seconds, fn, look }) }
  const loop = (fn, min, max) => { const again = () => later(() => { fn(); again() }, rand(min, max)); again() }
  const pose = () => ({ ...PET_REST, ...PET_POSES[shown] })
  const blink = () => { to({ eye: 0.05 }); later(() => to({ eye: pose().eye }), 0.11) }
  // A jump on the spot. The lid and the landing scale with the height, so a small one is small all over.
  const bounce = (height = 70) => {
    kick('squash', 0.016 * height)
    later(() => { kick('lift', -33 * height); kick('lidY', 4 * height); kick('armL', 3 * height) }, 0.09)
    later(() => kick('squash', 0.013 * height), 0.45)
  }
  const puff = () => { kick('lidY', 190); kick('lidRot', rand(-55, 55)); kick('vapour', 3) }
  // Off the ground by `height` body widths for `seconds`; landing is felt like any other.
  const leap = (height, seconds) => { if (!still()) jump = { t: 0, duration: seconds, height: height * size } }
  // One whole turn (twirl) or so many degrees head over heels (roll), spread evenly over `seconds`.
  const glide = (key, amount, seconds) => { if (!still()) glides.push({ key, amount, t: 0, duration: seconds }) }
  const touchdown = share => {
    kick('squash', 1.5 + 1.6 * share); kick('headY', 190 * share); kick('lidY', 620 * share); kick('lidRot', rand(-90, 90) * share)
    kick('armL', -170 * share); kick('vapour', 3 * share)
  }
  // Where the thing he is showing lies, in his own frame, from -1 to 1 either way.
  const toward = () => {
    if (!attend) return { x: 0, y: 0 }
    const dx = attend.x - (pos.x + size / 2), dy = attend.y - (pos.y + size * 0.55)
    return { x: clamp(dx / (size * 1.6), -1, 1) * facing, y: clamp(dy / (size * 1.6), -1, 1) }
  }
  const wanted = () => (held ? 'held' : move ? move.kind : waiting ? 'waiting' : act ? act.name : speaking ? 'speaking' : 'idle')

  function show(name) {
    tasks = []
    look++   // anything still queued for the previous look is dropped, even mid-batch
    shown = PET_POSES[name] ? name : 'idle'
    to(pose())
    busyUntil = 0
    if (still()) return
    if (!NO_BLINK.has(shown)) loop(() => { blink(); if (random() < 0.2) later(blink, 0.27) }, 2.2, 5.2)

    if (shown === 'idle') {
      // His eyes go to what he is showing, to the visitor and back; nothing repeats on a fixed period.
      loop(() => {
        if (clock < busyUntil) return
        const where = toward(), habit = Math.floor(rand(0, 5))
        if (habit < 2) to({ px: where.x * 8, py: where.y * 6, head: where.x * 2.4 })
        else if (habit === 2) to({ px: 0, py: 0, head: 0 })
        else if (habit === 3) to({ px: rand(-7, 7), py: rand(-3, 5), head: 0 })
        else { to({ px: 0, py: 6 }); later(() => to({ py: 0 }), 0.9) }
      }, 1.8, 4.2)
      loop(() => {
        const habit = Math.floor(rand(0, 6)), side = random() < 0.5 ? -1 : 1
        busyUntil = clock + 1.4
        if (habit === 0) { to({ lean: 1.6 * side, legL: -1.4 * side, legR: -1.4 * side }); later(() => to({ lean: 0, legL: 0, legR: 0 }), rand(1.8, 2.8)) }   // shifts his weight
        else if (habit === 1) puff()                                                                                                                     // lets off steam
        else if (habit === 2) { to({ footL: 20 }); later(() => to({ footL: 0 }), 0.16); later(() => to({ footL: 20 }), 0.36); later(() => to({ footL: 0 }), 0.52) }   // taps a foot
        else if (habit === 3) { kick('armR', -70); to({ browL: 4, browR: 4 }); later(() => to({ browL: 0, browR: 0 }), 0.7) }                          // wags the finger he points with
        else if (habit === 4) { to({ smile: 1.3, joy: 1 }); later(() => to({ smile: 1, joy: 0 }), 1.1) }                                               // a little beam
        else { kick('head', 30 * side); later(() => kick('head', -30 * side), 0.18) }                                                                  // a shimmy
      }, 3.4, 6.4)
      loop(() => {
        const habit = Math.floor(rand(0, 4))
        busyUntil = clock + 1.6
        if (habit === 0) { to({ py: -8, px: 0, browL: 5, browR: 5, head: -2 }); kick('vapour', 3); later(() => to({ py: 0, browL: 0, browR: 0, head: 0 }), 1.3) }   // watches his own steam
        else if (habit === 1) { to({ lean: -3.5, footL: 14, footR: 14 }); later(() => to({ lean: 2.5, footL: 0, footR: 0 }), 0.5); later(() => to({ lean: 0 }), 1) }     // rocks back on his heels
        else if (habit === 2) { to({ lidY: 34, lidRot: -8 }); later(() => to({ lidY: 0, lidRot: 0 }), 0.45) }                                                           // lifts his lid a crack
        else bounce(26)                                                                                                                                                  // a little skip
      }, 5.5, 9.5)
    }

    if (shown === 'speaking') {
      // Speech is phrases of a few syllables with a breath between them, as in the chat window:
      // the lips only half close inside a phrase, and each phrase starts with a nod and the finger.
      let left = 0
      const syllable = () => {
        if (left <= 0) {
          left = Math.floor(rand(3, 8))
          to({ open: 0, wide: 1 })
          later(() => {
            kick('headY', 70); kick('armR', -55)
            if (random() < 0.35) { to({ browL: 7, browR: 7 }); later(() => to({ browL: 3, browR: 3 }), 0.55) }
            if (random() < 0.3) kick('vapour', 2)
          }, 0.2)
          return later(syllable, rand(0.3, 0.52))
        }
        left--
        const rounded = random() < 0.3
        to({ open: rand(PET_SPEAKING_MOUTH[0], PET_SPEAKING_MOUTH[1]) * (rounded ? 0.85 : 1), wide: rounded ? rand(0.66, 0.8) : rand(0.92, 1.04) })
        const heldFor = rand(0.1, 0.17)
        later(() => to({ open: left > 0 ? rand(0.03, 0.08) : 0 }), heldFor)
        later(syllable, heldFor + rand(0.07, 0.12))
      }
      later(syllable, 0.12)
      // He talks to the visitor and glances at what he is talking about.
      loop(() => { const where = toward(); to({ px: where.x * 7, py: where.y * 5, head: where.x * 3 }); later(() => to({ px: 0, py: 0, head: 0 }), rand(0.7, 1.2)) }, 2.4, 4.4)
    }

    if (shown === 'waiting') {
      // The page is on its way to the next chapter: he looks where it is going, ready to jump.
      to({ py: 6 })
      loop(() => { kick('squash', 0.5); kick('lidY', 60) }, 0.5, 0.8)
    }

    if (shown === 'held') { kick('squash', -1.4); kick('lidY', 160); later(() => to({ eye: 1, open: 0.12, wide: 0.8, smile: 0.6 }), 0.7) }

    if (shown === 'curious') {
      const where = toward()
      to({ px: where.x * 9, py: where.y * 6 - 2 })
      kick('head', -40)
      later(() => { kick('armR', -60); kick('steam', 60) }, 0.5)
      later(() => to({ ...pose(), px: 0, py: 0, head: 3, browL: 3, browR: 3 }), 2.3)
      later(() => to(PET_REST), 2.9)
    }
    if (shown === 'stretch') {
      later(() => { to({ ...PET_REST, squash: 0.05, vapour: 1 }); kick('vapour', 4); kick('lidY', 120) }, 2.3)   // and breathes out
      later(() => to({ squash: 0 }), 3)
    }
    if (shown === 'happy') {
      bounce(80)
      later(() => bounce(60), 0.72)
      later(() => to({ ...PET_REST, smile: 1.2 }), 1.55)
    }
    if (shown === 'balance') {
      // One foot off the ground: he wobbles, saves it, and puts the foot down with a little jump.
      let wobbling = true
      loop(() => { if (!wobbling) return; const out = goal.lean > 5; to({ lean: out ? 3.4 : 6.6, armL: out ? 38 : 26, head: out ? -2 : -5 }) }, 0.28, 0.5)
      later(() => { wobbling = false; to(PET_REST); bounce(34) }, 2.6)
    }
    if (shown === 'sleepy') {
      // Nods off, then starts awake.
      later(() => to({ eye: 0.06, head: 9, headY: 14 }), 1.2)
      later(() => { to({ ...PET_REST, eye: 1.1, browL: 8, browR: 8 }); kick('headY', -260); kick('lidY', 170); kick('vapour', 3) }, 3)
      later(() => { to({ eye: 1, browL: 0, browR: 0 }); blink(); later(blink, 0.3) }, 3.7)
    }
    if (shown === 'greet') {
      bounce(36)
      let waving = true, out = false
      loop(() => { if (!waving) return; out = !out; to({ armR: out ? -17 : -5 }) }, 0.17, 0.22)
      later(() => { waving = false; to({ ...PET_REST, smile: 1.15 }) }, 1.7)
    }
    if (shown === 'tiphat') {
      // Tips his lid like a hat, with a nod; it drops back with a clatter.
      later(() => to({ lidY: 0, lidRot: 0 }), 0.8)
      later(() => to({ ...PET_REST, smile: 1.15 }), 1.15)
    }
    if (shown === 'dance') {
      // Rocks from foot to foot with his arms going, eight beats.
      let beat = 0
      const step = () => {
        const right = beat % 2 === 1
        to({ lean: right ? 7 : -7, head: right ? -5 : 5, footL: right ? 36 : 0, footR: right ? 0 : 36, armL: right ? 36 : 4, armR: right ? 0 : -18 })
        kick('squash', 1); kick('lift', -300); kick('lidY', 520)
        if (!right) kick('vapour', 2)
        if (++beat < 8) later(step, 0.32)
        else later(() => to({ ...PET_REST, smile: 1.2 }), 0.32)
      }
      step()
    }
    if (shown === 'boil') {
      // Pressure builds under the lid, faster and faster, until it lets go.
      let hits = 0
      const rattle = () => {
        hits++
        kick('lidY', 900 + hits * 160); kick('lidRot', rand(-170, 170)); kick('squash', 0.6); kick('lean', rand(-30, 30))
        if (hits < 9) later(rattle, Math.max(0.09, 0.3 - hits * 0.025))
      }
      rattle()
      later(() => {
        to({ ...PET_REST, eye: 1.12, browL: 9, browR: 9, open: 0.3, wide: 0.6, smile: 0.3 })
        kick('lidY', 3600); kick('lidRot', rand(-220, 220)); kick('vapour', 6); kick('squash', -1.4); kick('lift', -1100)
      }, 1.9)
      later(() => to({ ...PET_REST, joy: 1, smile: 1.3 }), 2.5)   // and relief
      later(() => to(PET_REST), 3.3)
    }
    if (shown === 'spin') {
      // A jump with a whole turn in it.
      kick('squash', 1)
      later(() => { to({ ...PET_REST, armL: 30, armR: -14, joy: 1, smile: 1.3 }); leap(0.42, 0.56); glide('twirl', 1, 0.56); kick('lidY', 150) }, 0.14)
      later(() => to({ ...PET_REST, smile: 1.2 }), 1.15)
    }
    if (shown === 'flip') {
      // Head over heels: he gathers, goes round once in the air and lands with his arms up.
      kick('squash', 1.2)
      later(() => {
        to({ ...PET_REST, armL: 34, armR: -16, footL: 30, footR: 30, browL: 8, browR: 8, open: 0.25, wide: 0.7 })
        leap(0.66, 0.72); glide('roll', 360, 0.66)
      }, 0.15)
      later(() => to({ ...PET_REST, joy: 1, smile: 1.35, armL: 30, armR: -12 }), 0.9)
      later(() => to(PET_REST), 1.9)
    }
    if (shown === 'bow') later(() => to({ ...PET_REST, smile: 1.2 }), 0.95)
  }
  const refresh = () => { if (wanted() !== shown) show(wanted()) }

  // Once he has stopped, the pointing hand comes up and his eyes go to what he is showing.
  function arrive() {
    refresh()
    kick('armR', -90)
    const where = toward()
    to({ px: where.x * 8, py: where.y * 6 })
    busyUntil = clock + 1.2
  }

  function start(deliberate, seconds) {
    const dx = home.x - pos.x, dy = home.y - pos.y, gap = Math.hypot(dx, dy), close = gap < (deliberate ? 0.3 : 0.6) * size
    // Close by, he is simply carried there: a page that scrolls should not make him walk on the spot.
    if (close && !deliberate) return
    // A new chapter that needs no journey still gets a jump on the spot: something has changed.
    const plan = close ? { kind: 'hop', duration: 0.38, height: 0.27 * size } : planPetMove(dx, dy, size)
    if (seconds > 0) plan.duration = seconds
    // He is already crouched if he was waiting for the page.
    const gathered = shown === 'waiting' || clock - waited < 0.2
    move = { ...plan, from: { ...pos }, to: { ...home }, t: 0, wind: plan.kind === 'hop' ? (gathered ? 0.03 : CROUCH) : 0 }
    // Now and then the jump on the spot has a turn in it.
    move.twirls = close && random() < 0.4
    jump = null
    if (Math.abs(dx) > size * 0.12) facing = sign(dx)
    act = null
    show(move.kind)
    if (move.kind === 'hop') { to({ squash: 0.16, lean: -3, armL: -6 }); kick('squash', 1.2) }
  }
  const along = () => {
    // Steps ease in and out; a jump crosses the ground at an even speed, as a thrown thing does.
    const eased = move.kind === 'walk' ? (1 - Math.cos(Math.PI * move.t)) / 2 : move.t
    return { x: move.from.x + (move.to.x - move.from.x) * eased, y: move.from.y + (move.to.y - move.from.y) * eased }
  }
  function land() {
    const share = move.kind === 'hop' ? move.height / size : 0.12
    pos.x = move.to.x + slip.x; pos.y = move.to.y + slip.y
    air = 0
    move = null
    touchdown(share)
    arrive()
    if (share > 0.3) blink()
  }

  show('idle')
  return {
    state, goal,
    get shown() { return shown },
    get clock() { return clock },
    get moving() { return Boolean(move) },
    get held() { return held },
    get facing() { return facing },
    get position() { return { x: pos.x, y: pos.y } },
    /** How wide he is drawn, in pixels: steps and jumps are measured in body widths. */
    resize(next) { if (next > 0) size = next },
    /** Puts him somewhere without travelling. `scale` is how large he stands there, to shrink from as he leaves. */
    place(point, { scale = 1 } = {}) {
      pos.x = home.x = point.x; pos.y = home.y = point.y
      slip.x = slip.y = vel.x = vel.y = 0
      was.x = pos.x; was.y = pos.y
      move = null; air = 0; placed = true
      stage = still() ? 1 : scale
      state.scale = stage; speed.scale = 0
    },
    get placed() { return placed },
    /** Sends him to a new spot: he walks or jumps there. `seconds` sets the pace of an entrance. */
    travel(point, seconds) { this.goTo(point, true, seconds) },
    /** The spot he stands on has moved, as when the page scrolls: he is carried, unless it got away from him. */
    follow(point) { this.goTo(point, false) },
    goTo(point, deliberate, seconds) {
      if (!placed) return this.place(point)
      // In a visitor's hand he goes nowhere on his own; he stays where he is put down until the guide moves on.
      if (held && !still()) return
      const before = move && move.wind <= 0 ? along() : null
      home.x = point.x; home.y = point.y
      stage = 1
      if (still()) { pos.x = home.x; pos.y = home.y; move = null; air = 0; return }
      if (move) {
        // A target that moves mid-flight bends the path instead of breaking it.
        move.to = { ...home }
        if (before) { const after = along(); slip.x += before.x - after.x; slip.y += before.y - after.y }
        return
      }
      start(deliberate, seconds)
    },
    /** Where the thing he is showing is on screen, or null. He looks at it and turns to it. */
    attend(point) { attend = point ? { x: point.x, y: point.y } : null },
    /** Where the pointer is, from -1 to 1 either way of his face. */
    look(x, y) { gaze.x = clamp(x, -1, 1) * 8 * facing; gaze.y = clamp(y, -1, 1) * 6; gaze.until = clock + 2.2 },
    speak(on) { speaking = Boolean(on); refresh() },
    /** The page is travelling to the next chapter. */
    wait(on) { if (waiting && !on) waited = clock; waiting = Boolean(on); if (waiting) act = null; refresh() },
    /** One of his little performances. Ignored while he has something better to do. */
    perform(name, seconds = DEFAULT_GESTURE) {
      if (!PET_GESTURES.includes(name) || still() || held || move || waiting || speaking) return false
      act = { name, until: clock + seconds }
      show(name)
      return true
    },
    /** Ends a performance early. One that has left the ground is allowed to land first. */
    rest() { if (act && !jump) { act = null; refresh() } else if (act) act.until = clock },
    /** A visitor clicked him: a quick nod and a skip before whatever the click asked for. */
    nudge() { if (still() || held || move || jump) return; kick('squash', 0.5); kick('lift', -620); kick('headY', 130); kick('lidY', 220) },
    /** The pointer has come to him: he perks up. */
    notice() {
      if (still() || shown !== 'idle') return
      busyUntil = clock + 0.9
      kick('lift', -420); kick('lidY', 120)
      to({ browL: 7, browR: 7, open: 0.16, wide: 0.7 })
      later(() => to({ browL: 0, browR: 0, open: 0, wide: 1 }), 0.45)
    },
    /** A visitor picks him up. */
    grab() { held = true; move = null; jump = null; glides = []; turns.twirl = turns.roll = 0; air = 0; act = null; slip.x = slip.y = 0; refresh() },
    /** Carried to a new spot by the visitor's hand. */
    carry(point) { if (held) { pos.x = home.x = point.x; pos.y = home.y = point.y } },
    /** Put down: he drops the last little way and collects himself. */
    release() {
      if (!held) return
      held = false
      refresh()
      kick('squash', 1.9); kick('lidY', 150); kick('headY', 90)
      blink()
    },
    step(dt) {
      clock += dt
      const due = tasks.filter(task => task.at <= clock)
      if (due.length) { tasks = tasks.filter(task => task.at > clock); for (const task of due) if (task.look === look) task.fn() }
      if (act && clock >= act.until && !jump) { act = null; refresh() }

      if (move) {
        if (move.wind > 0) {
          move.wind -= dt
          if (move.wind <= 0) { to({ squash: 0, lean: 0, armL: PET_POSES.hop.armL }); kick('lidY', 90); if (move.twirls) glide('twirl', 1, move.duration) }
        } else {
          move.t = Math.min(1, move.t + dt / move.duration)
          const point = along()
          pos.x = point.x + slip.x; pos.y = point.y + slip.y
          if (move.kind === 'hop') air = 4 * move.height * move.t * (1 - move.t)
          if (move.t >= 1) land()
        }
      } else if (!held && !still()) {
        const share = 1 - Math.exp(-dt / CARRIED)
        pos.x += (home.x - pos.x) * share; pos.y += (home.y - pos.y) * share
      }
      if (jump) {
        jump.t = Math.min(1, jump.t + dt / jump.duration)
        air = 4 * jump.height * jump.t * (1 - jump.t)
        if (jump.t >= 1) { const share = jump.height / size; jump = null; air = 0; touchdown(share) }
      }
      for (const turn of glides) { turn.t = Math.min(1, turn.t + dt / turn.duration); turns[turn.key] = turn.t < 1 ? turn.amount * turn.t : 0 }
      if (glides.length) glides = glides.filter(turn => turn.t < 1)
      const fade = Math.exp(-dt / 0.1)
      slip.x *= fade; slip.y *= fade
      // Speed over the ground since the last frame, a hand's carrying included, smoothed: a hand
      // does not move as evenly as a spring.
      const smooth = 1 - Math.exp(-dt / 0.06), covered = Math.hypot(pos.x - was.x, pos.y - was.y)
      if (dt > 0) { vel.x += ((pos.x - was.x) / dt - vel.x) * smooth; vel.y += ((pos.y - was.y) / dt - vel.y) * smooth }
      was.x = pos.x; was.y = pos.y

      // What the motion itself adds to each joint, on top of what the pose asks for.
      for (const key of keys) sway[key] = 0
      const forward = clamp(vel.x * facing / size, -6, 6)   // body widths per second, toward where he faces
      if (move && move.wind <= 0 && move.kind === 'hop') {
        const t = move.t, arc = Math.sin(Math.PI * t), ahead = clamp(Math.abs(move.to.x - move.from.x) / (size * 0.6), 0, 1) * sign((move.to.x - move.from.x) * facing)
        sway.lean = ahead * (11 - 17 * t)                       // forward off the ground, back on the way down
        sway.squash = -0.11 * Math.pow(Math.abs(1 - 2 * t), 1.5)  // long while he rises and falls, round at the top
        // The legs turn at the hip of a cut-out figure: past a dozen degrees they come away from the body.
        sway.legL = -ahead * 12 * arc; sway.legR = -ahead * 7 * arc + ahead * 11 * clamp((t - 0.6) / 0.4, 0, 1)
        sway.footL = 26 * arc; sway.footR = 36 * arc
        sway.head = -sway.lean * 0.3
        sway.steam = -ahead * 22
        sway.py = t < 0.5 ? -4 : 5
        sway.px = ahead * 5
        if (!move.floated && t >= 0.42) { move.floated = true; kick('lidY', 640 * move.height / size) }   // the lid floats at the top of the arc
      } else if (move && move.kind === 'walk') {
        pace += (1 - pace) * (1 - Math.exp(-dt / 0.08))
        gait += covered / (STRIDE * size) * Math.PI
        sway.steam = -forward * 6
        sway.px = 4
      } else if (held) {
        // He hangs from the visitor's hand: the feet trail behind it, and he stretches when lifted.
        sway.swing = clamp(forward * 9, -30, 30)
        sway.squash = clamp(vel.y / size * 0.03, -0.1, 0.1)
        // Both legs trail by the same angle: one further than the other would open the gap between them.
        sway.legL = sway.legR = clamp(-state.swing * 0.55, -11, 11)
        sway.armL = Math.abs(state.swing) * 0.5
        sway.steam = -forward * 8
        sway.px = clamp(forward * 3, -7, 7); sway.py = clamp(vel.y / size * 3, -6, 6)
      }
      if (!move || move.kind !== 'walk') pace += (0 - pace) * (1 - Math.exp(-dt / 0.12))
      // At rest his eyes follow the pointer for a couple of seconds after it last moved.
      if (shown === 'idle' && clock < gaze.until && clock > busyUntil) { goal.px = gaze.x; goal.py = gaze.y }

      goal.turn = facing
      goal.hold = held ? 1 : 0   // how far off the ground a hand has him: his shadow thins with it
      goal.scale = stage   // he comes down to his own size as he leaves the stage he was introduced on
      // The stiffest springs (an eyelid shuts in a twelfth of a second) need steps this short to stay
      // steady: a longer frame is cut into several, or a blink leaves the eye fluttering.
      const pieces = Math.max(1, Math.ceil(dt / SPRING_STEP)), piece = dt / pieces
      for (const key of keys) {
        const target = goal[key] + sway[key]
        if (still()) { state[key] = goal[key]; speed[key] = 0; continue }
        const [stiffness, damping] = PET_SPRINGS[key]
        for (let i = 0; i < pieces; i++) {
          speed[key] += (stiffness * (target - state[key]) - damping * speed[key]) * piece
          state[key] += speed[key] * piece
        }
      }
      state.breath = still() ? 0 : Math.sin(clock * 2 * Math.PI / 3.6) * 0.011

      // The walk is laid over the springs in time with the ground covered, and standing still is
      // never quite still: his weight drifts from foot to foot and the hanging arm with it.
      const step = Math.sin(gait), swingLeg = Math.cos(gait)
      const alive = still() || move || held || jump ? 0 : 1, drift = Math.sin(clock * 0.9), drift2 = Math.sin(clock * 1.37 + 1)
      return {
        ...state,
        twirl: turns.twirl, roll: turns.roll,
        lean: state.lean + alive * 0.7 * drift,
        x: pos.x, y: pos.y, air, clock: still() ? 0 : clock, shown, moving: Boolean(move), held,
        // Still catching up with a spot that moved under him, as when the page scrolls.
        carried: !move && !held && Math.abs(home.x - pos.x) + Math.abs(home.y - pos.y) > 0.5,
        // Off the ground inside a performance: every frame counts while it lasts.
        leaping: Boolean(jump) || glides.length > 0,
        legL: state.legL + pace * 11 * step, legR: state.legR - pace * 11 * step,
        footL: state.footL + pace * 30 * Math.max(0, swingLeg), footR: state.footR + pace * 30 * Math.max(0, -swingLeg),
        lift: state.lift - pace * 13 * Math.abs(swingLeg),
        armL: state.armL - pace * 11 * step + alive * 1.8 * drift2, armR: state.armR + pace * 4 * step + alive * 0.9 * drift,
        head: state.head + pace * 1.4 * Math.sin(gait * 2) - alive * 0.6 * drift,
      }
    },
  }
}

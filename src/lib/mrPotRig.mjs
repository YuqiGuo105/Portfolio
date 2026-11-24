// How Mr. Pot moves.
//
// Every part that moves on its own (body, lid, handles, brows, pupils, mouth, steam) is a spring
// pulled toward the value its current look asks for. A look is a state of the conversation
// (thinking, speaking) or a short reaction to something the visitor did (a like, a dropped file).
// Habits fire at random intervals on the rig's own clock, so nothing repeats on a fixed period.
// No DOM and no timers here: the caller advances the clock with step() and draws the result.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

// [stiffness, damping]. Low damping overshoots: the lid rattles, the pupils do not.
export const POT_SPRINGS = Object.freeze({
  lift: [260, 17], tilt: [110, 13], squash: [320, 15], lidY: [430, 12], lidRot: [300, 10], px: [420, 34], py: [420, 34], eye: [900, 48],
  browL: [260, 20], browR: [260, 20], open: [420, 37], wide: [380, 35], smile: [300, 24], blush: [80, 18], hL: [190, 10], hR: [190, 10], steam: [22, 9],
  sweat: [70, 15], joy: [520, 40], wink: [900, 50], pupil: [300, 26], lids: [240, 24], skew: [300, 26], round: [520, 36],
})

export const POT_REST = Object.freeze({
  lift: 0, tilt: 0, squash: 0, lidY: 0, lidRot: 0, px: 0, py: 0, eye: 1, browL: 0, browR: 0, open: 0, wide: 1, smile: 1, blush: 0.9, hL: 0, hR: 0,
  steam: 0.35, sweat: 0, joy: 0, wink: 0, pupil: 1, lids: 0, skew: 0, round: 0,
})

// What the chat window reports about the conversation.
export const POT_STATES = Object.freeze(['idle', 'listening', 'thinking', 'searching', 'working', 'speaking', 'success', 'error'])

// Short looks in answer to something the visitor did, and how long each lasts in seconds.
export const POT_REACTIONS = Object.freeze({ hello: 1.5, curious: 1.4, surprised: 1.6, puzzled: 3.2, shy: 3, wink: 1.6, sorry: 2.4 })

// The widest the mouth opens while speaking, as a share of fully open. Kept small on purpose.
export const SPEAKING_MOUTH = Object.freeze([0.14, 0.34])
const SLEEPY_AFTER = 90   // seconds of an untouched, idle window before he nods off
const SETTLE_AFTER = 3.6  // seconds a finished answer is celebrated before he rests

export const POT_FACES = Object.freeze({
  idle: {},
  listening: { tilt: 5, px: 2, py: 5, browL: 4, browR: 2, smile: 0.6, blush: 0.8, steam: 0.2 },
  thinking: { tilt: -4, px: -5, py: -6, browL: 5, browR: -1, smile: 0.15, blush: 0.6, steam: 1 },
  searching: { px: -6, py: 1, browL: 2, browR: 2, smile: 0.4, blush: 0.7, lidY: 2, steam: 0.5 },
  working: { tilt: 1, px: 1, py: 4, browL: -2.5, browR: -2.5, smile: 0.3, blush: 0.7, steam: 0.3, lids: 0.14 },
  speaking: { py: 1, browL: 1, browR: 1, steam: 0.4 },
  success: { tilt: -1.5, browL: 3, browR: 3, smile: 1.25, blush: 1, steam: 0.55, joy: 1 },
  error: { tilt: 6, py: 4, browL: -4, browR: 5, smile: -0.9, blush: 0.3, lidY: 1, lidRot: -9, steam: 0.05, sweat: 1 },
  hello: { tilt: -2, py: -1, browL: 3, browR: 3, smile: 1.25, blush: 1, steam: 0.45 },
  curious: { tilt: -5, px: 3, py: -2, browL: 6, browR: 1, smile: 0.5, pupil: 1.12, blush: 0.8 },
  surprised: { py: -1, browL: 7, browR: 7, smile: 0, round: 1, eye: 1.08, pupil: 0.82, blush: 0.7, steam: 0.6 },
  puzzled: { tilt: 6, px: -4, py: -3, browL: 5, browR: -3, smile: -0.1, skew: -0.6, blush: 0.6, steam: 0.2 },
  sleepy: { tilt: 2, py: 3, browL: -1, browR: -1, smile: 0.4, lids: 0.6, blush: 0.75, steam: 0.12 },
  shy: { tilt: -3, px: -4, py: 4, browL: 2, browR: 2, smile: 0.9, blush: 1, lids: 0.16, steam: 0.3 },
  wink: { tilt: -2, browL: -1, browR: 3, smile: 1.1, skew: 0.8, blush: 0.95, steam: 0.4 },
  sorry: { tilt: 3, px: 0, py: 5, browL: -3, browR: 3, smile: -0.25, blush: 0.5, lids: 0.1, steam: 0.15 },
})

const NO_BLINK = new Set(['thinking', 'success', 'error', 'sleepy', 'surprised', 'wink'])

export function createPotRig({ random = Math.random, still = () => false, sleeps = true } = {}) {
  const state = { breath: 0 }, speed = {}, goal = {}
  for (const key of Object.keys(POT_SPRINGS)) { state[key] = POT_REST[key]; speed[key] = 0; goal[key] = POT_REST[key] }
  const rand = (min, max) => min + random() * (max - min)
  let clock = 0, tasks = [], look = 0, puffs = [], base = 'idle', shown = 'idle', reaction = null
  let touched = 0, busyUntil = 0, pace = 3.6, depth = 0.012
  const gaze = { x: 0, y: 0, until: 0 }

  const to = values => Object.assign(goal, values)
  const kick = (key, amount) => { if (!still()) speed[key] += amount }
  const later = (fn, seconds) => { tasks.push({ at: clock + seconds, fn, look }) }
  const loop = (fn, min, max) => { const again = () => later(() => { fn(); again() }, rand(min, max)); again() }
  const face = () => ({ ...POT_REST, ...POT_FACES[shown] })
  const puff = (count = 1) => {
    if (still()) return
    for (let i = 0; i < count; i++) puffs.push({ x: 256 + rand(-34, 34), y: 150 + rand(-6, 6), life: -i * 0.08, span: rand(0.7, 1) })
    puffs = puffs.slice(-5)
  }
  const blink = () => { to({ eye: 0.06 }); later(() => to({ eye: face().eye }), 0.11) }
  // The lid, the handles and the landing all scale with the height, so a small hop is small all over.
  const hop = (height = 560) => {
    const share = height / 780
    kick('squash', 1.6 * share)
    later(() => { kick('lift', -height); kick('lidY', 330 * share); kick('hL', -150 * share); kick('hR', 150 * share) }, 0.09)
    later(() => kick('squash', 1.3 * share), 0.47)
  }

  function show(name) {
    tasks = []
    look++   // anything still queued for the previous look is dropped, even mid-batch
    shown = POT_FACES[name] ? name : 'idle'
    to(face())
    pace = shown === 'thinking' ? 2.5 : shown === 'sleepy' ? 5.4 : 3.6
    depth = shown === 'sleepy' ? 0.02 : 0.012
    busyUntil = 0
    if (shown === 'success') later(() => show('idle'), SETTLE_AFTER)
    if (still()) return
    if (!NO_BLINK.has(shown)) loop(() => { blink(); if (random() < 0.2) later(blink, 0.27) }, 2.4, 5.6)
    if (shown === 'idle') loop(() => {
      // Ten small habits picked at random, so no two minutes look alike.
      const habit = Math.floor(rand(0, 10)), side = random() < 0.5 ? -1 : 1, hold = seconds => { busyUntil = clock + seconds }
      if (habit === 0) { hold(1.7); to({ px: 6 * side, tilt: 3 * side }); later(() => to({ px: 0, tilt: 0 }), rand(1.1, 1.6)) }                        // a glance aside
      else if (habit === 1) { hold(1.9); puff(); to({ px: 1, py: -6, browL: 3, browR: 3 }); later(() => to({ px: 0, py: 0, browL: 0, browR: 0 }), 1.7) }   // watches his own steam
      else if (habit === 2) { to({ smile: 1.25, joy: 1 }); later(() => to({ smile: 1, joy: 0 }), 1.2) }                                                   // a little beam
      else if (habit === 3) { kick('lidY', 210); kick('lidRot', rand(-60, 60)); puff() }                                                                  // lets off a puff
      else if (habit === 4) { to({ hL: -9, hR: 9, squash: -0.025 }); later(() => to({ hL: 0, hR: 0, squash: 0 }), 0.8) }                                  // stretches his handles
      else if (habit === 5) { to({ lidRot: 6 * side }); later(() => to({ lidRot: 0 }), 0.52) }                                                            // straightens his lid
      else if (habit === 6) { kick('tilt', 42 * side); later(() => kick('tilt', -42 * side), 0.17) }                                                      // a shimmy
      else if (habit === 7) { to({ lids: 0.42, smile: 0.7 }); later(() => to({ lids: 0, smile: 1 }), rand(1.5, 2.1)) }                                    // a lazy look
      else if (habit === 8) { kick('squash', 0.55); later(puff, 0.38) }                                                                                   // a sigh
      else { to({ wink: 1, skew: 0.6 }); later(() => to({ wink: 0 }), 0.38); later(() => to({ skew: 0 }), 0.9) }                                         // a wink
    }, 2.8, 5.6)
    if (shown === 'hello') { hop(560); puff() }
    if (shown === 'thinking') {
      // Pressure builds and lets go in bursts; no two bursts are alike.
      loop(() => {
        const hits = 2 + Math.floor(rand(0, 3))
        for (let i = 0; i < hits; i++) later(() => { kick('lidY', rand(130, 280)); kick('lidRot', rand(-95, 95)); kick('squash', 0.25) }, i * rand(0.07, 0.13))
        puff(random() < 0.5 ? 2 : 1)
      }, 0.7, 1.9)
      loop(() => { const right = random() < 0.4; to({ tilt: right ? 2.5 : -4, px: right ? 5 : -5, browL: right ? -1 : 5, browR: right ? 5 : -1 }) }, 1.6, 2.6)
      loop(() => { to({ eye: 0.08 }); later(() => to({ eye: 1 }), rand(0.5, 0.9)) }, 3.2, 5.2)
    }
    if (shown === 'searching') {
      // Reads: four stops along a line, then down to the next line.
      let column = 0, row = 0
      const read = () => {
        column++
        if (column > 3) { column = 0; row = (row + 1) % 3; to(row === 0 ? { browL: 5, browR: 5 } : { browL: 2, browR: 2 }) }
        to({ px: -6 + column * 4, py: 1 + row * 1.6, tilt: (-6 + column * 4) * 0.25 })
        later(read, column === 0 ? rand(0.32, 0.46) : rand(0.19, 0.34))
      }
      read()
    }
    if (shown === 'working') {
      // Stirring: the handles take turns.
      let turn = 1
      loop(() => { turn = -turn; kick('hL', 130 * turn); kick('hR', 130 * turn); kick('tilt', 14 * turn) }, 0.42, 0.64)
      loop(() => { to({ py: -1 }); later(() => to({ py: 4 }), 0.6) }, 2.6, 4.2)
    }
    if (shown === 'speaking') {
      // Speech is phrases of a few syllables with a breath between them. Each syllable opens the
      // mouth to its own shape, wider or rounder, and the lips only half close inside a phrase:
      // a mouth that snaps shut on every beat reads as a flap, not as talking.
      let left = 0
      const syllable = () => {
        if (left <= 0) {
          // Between phrases: lips together, a small nod into the next one.
          left = Math.floor(rand(3, 8))
          to({ open: 0, wide: 1 })
          later(() => { kick('lift', -34); if (random() < 0.3) { to({ browL: 3, browR: 3 }); later(() => to({ browL: 1, browR: 1 }), 0.55) } }, 0.2)
          return later(syllable, rand(0.3, 0.52))
        }
        left--
        const rounded = random() < 0.3
        to({ open: rand(SPEAKING_MOUTH[0], SPEAKING_MOUTH[1]) * (rounded ? 0.85 : 1), wide: rounded ? rand(0.66, 0.8) : rand(0.92, 1.04) })
        const held = rand(0.1, 0.17)
        later(() => to({ open: left > 0 ? rand(0.03, 0.08) : 0 }), held)
        later(syllable, held + rand(0.07, 0.12))
      }
      later(syllable, 0.12)
    }
    if (shown === 'success') { hop(520); later(() => puff(2), 0.16) }
    if (shown === 'error') { kick('tilt', 70); kick('lidRot', -120) }
    if (shown === 'curious') kick('tilt', -34)
    if (shown === 'surprised') { kick('lidY', 270); kick('lift', -230); kick('squash', -0.5); puff() }
    if (shown === 'puzzled') loop(() => { const left = goal.tilt > 0; to({ tilt: left ? -5 : 6, px: left ? 4 : -4, browL: left ? -3 : 5, browR: left ? 5 : -3, skew: left ? 0.6 : -0.6 }) }, 1.7, 2.5)
    if (shown === 'sleepy') loop(() => {
      // Nods off, then starts awake.
      to({ lids: 0.96, tilt: 5, lift: 5 })
      later(() => { to({ lids: 0.3, tilt: 2, lift: 0 }); kick('lift', -170); kick('lidY', 130); later(() => to({ lids: 0.6 }), 0.7) }, rand(1.7, 2.4))
    }, 3.8, 5.4)
    if (shown === 'shy') loop(() => { const away = goal.px > 0; to({ px: away ? -4 : 2, py: away ? 4 : 2 }); if (!away) kick('tilt', 18) }, 1.3, 2.2)
    if (shown === 'wink') later(() => { to({ wink: 1 }); later(() => to({ wink: 0 }), 0.42) }, 0.25)
    if (shown === 'sorry') { kick('lift', 120); kick('squash', 0.4) }
  }

  // Waking is a small stretch, not a start: it happens whenever the pointer moves after a long
  // pause, so anything larger looks like a reaction to whatever the visitor clicks next.
  const touch = () => { touched = clock; if (shown === 'sleepy' && !reaction) { show(base); kick('lift', -40); kick('lidY', 30) } }
  // Listening counts as calm: the first key he hears is the moment for a curious look.
  const calm = () => base === 'idle' || base === 'success' || base === 'listening'

  show('idle')
  return {
    state, goal,
    get puffs() { return puffs },
    get shown() { return shown },
    get base() { return base },
    get clock() { return clock },
    /** The state of the conversation. Anything but rest ends a reaction: the answer matters more. */
    setMood(name) {
      const next = POT_STATES.includes(name) ? name : 'idle'
      if (next === base) return
      base = next
      touched = clock
      if (reaction && !calm()) reaction = null
      if (!reaction) show(base)
    },
    /** A short look in answer to the visitor. Ignored while he is busy with an answer. */
    react(name) {
      if (!POT_REACTIONS[name] || !calm()) return false
      touched = clock
      reaction = { name, until: clock + POT_REACTIONS[name] }
      show(name)
      return true
    },
    /** Ends a reaction early, without another one: a like taken back should not leave him blushing. */
    settle() { if (reaction) { reaction = null; show(base === 'success' ? 'idle' : base) } },
    /** One keystroke: a small nod while he is listening, and his eyes drift along the line. */
    key() {
      touch()
      if (shown !== 'listening') return
      kick('lift', 80); kick('squash', 0.27)
      to({ px: clamp(goal.px + 0.5, 2, 6) })
    },
    /** Where the pointer is, from -1 to 1 either way of his face. */
    look(x, y) { touch(); gaze.x = clamp(x, -1, 1) * 5.5; gaze.y = clamp(y, -1, 1) * 4.5; gaze.until = clock + 2.2 },
    step(dt) {
      clock += dt
      const due = tasks.filter(task => task.at <= clock)
      if (due.length) { tasks = tasks.filter(task => task.at > clock); for (const task of due) if (task.look === look) task.fn() }
      if (reaction && clock >= reaction.until) { reaction = null; show(base === 'success' ? 'idle' : base) }
      if (sleeps && shown === 'idle' && base === 'idle' && !still() && clock - touched > SLEEPY_AFTER) show('sleepy')
      // At rest his eyes follow the pointer for a couple of seconds after it last moved.
      if (shown === 'idle' && clock > busyUntil && !still()) { const on = clock < gaze.until; goal.px = on ? gaze.x : 0; goal.py = on ? gaze.y : 0 }
      for (const key of Object.keys(POT_SPRINGS)) {
        if (still()) { state[key] = goal[key]; speed[key] = 0; continue }
        const [stiffness, damping] = POT_SPRINGS[key]
        speed[key] += (stiffness * (goal[key] - state[key]) - damping * speed[key]) * dt
        state[key] += speed[key] * dt
      }
      state.breath = still() ? 0 : Math.sin(clock * 2 * Math.PI / pace) * depth
      for (const one of puffs) one.life += dt
      return state
    },
  }
}

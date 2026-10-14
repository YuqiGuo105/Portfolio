import test from 'node:test'
import assert from 'node:assert/strict'
import { POT_REST } from '../src/lib/mrPotAnimation.mjs'
import { samplePotPerformance } from '../src/lib/mrPotMotion.mjs'

const states = ['idle', 'thinking', 'searching', 'listening', 'working', 'speaking', 'success', 'error']

test('each state performs several distinct gestures, not just a static pose', () => {
  for (const state of states) {
    const gestures = new Set()
    for (let time = 0; time < 16; time += 0.1) gestures.add(samplePotPerformance(state, time).gesture)
    assert.ok(gestures.size >= (state === 'speaking' ? 2 : 3), `${state}: ${[...gestures]}`)
  }
})

test('motion preserves scale and keeps the original head and face inside safe bounds', () => {
  for (const state of states) for (let time = 0; time < 35; time += 0.03) {
    const { pose } = samplePotPerformance(state, time)
    assert.deepEqual(Object.keys(pose), Object.keys(POT_REST), 'only supported articulation parameters')
    assert.ok(Object.values(pose).every(Number.isFinite))
    assert.ok(Math.abs(pose.tilt) <= 4.1 && Math.abs(pose.lift) <= 1.4 && Math.abs(pose.shiftX) <= 0.6)
    for (const key of ['gazeX', 'gazeY', 'eyeOpen', 'eyeLeft', 'eyeRight']) {
      assert.ok(!(key in pose), `${key} cannot animate eyes independently of the head`)
    }
    assert.ok(pose.mouthWidth >= 0.75 && pose.mouthWidth <= 1.21 && pose.mouthHeight <= 1.81)
    assert.ok(pose.mouthOpen >= 0 && pose.mouthOpen <= 1)
    assert.ok(pose.lidOpen >= 0 && pose.lidOpen <= 1)
    assert.ok(pose.lidBounce >= 0 && pose.lidBounce <= 1)
    assert.ok(pose.blush >= 0 && pose.blush <= 0.65)
    assert.ok(pose.bow >= 0 && pose.bow <= 24, 'a gentle forward bow, not a deep bend')
    assert.ok(Math.abs(pose.handleLeft) <= 8 && Math.abs(pose.handleRight) <= 8, 'handles stay attached with a small swing')
    assert.ok(Math.abs(pose.pupilX) <= 0.55 && Math.abs(pose.pupilY) <= 0.4, 'pupils stay inside the fixed sockets')
    assert.ok(pose.blink >= 0 && pose.blink <= 1, 'one shared eyelid aperture')
  }
})

test('brows lead the head without stretching or moving the eyes independently', () => {
  const early = samplePotPerformance('thinking', 0.5).pose
  const later = samplePotPerformance('thinking', 1.3).pose
  assert.equal(early.browRight, -12)
  assert.equal(early.tilt, 0)
  assert.equal(later.browLeft, 5)
  assert.equal(later.tilt, -4)
})

test('loop boundaries are continuous and success or error settles instead of repeating', () => {
  for (const [state, duration] of [['idle', 14], ['thinking', 10.5], ['searching', 7.6], ['listening', 8.8], ['working', 6.8]]) {
    const before = samplePotPerformance(state, duration - 0.0001).pose
    const after = samplePotPerformance(state, duration + 0.0001).pose
    for (const key of Object.keys(POT_REST)) assert.ok(Math.abs(before[key] - after[key]) < 0.001, `${state}.${key}`)
  }
  for (const state of ['success', 'error']) assert.deepEqual(samplePotPerformance(state, 100).pose, POT_REST)
})

test('hover lowers the head thoughtfully, holds, then rises without lateral motion', () => {
  assert.equal(samplePotPerformance('speaking', 4).gesture, 'speaking-pause')
  assert.equal(samplePotPerformance('speaking', 4).pose.mouthHeight, 1)
  const down = samplePotPerformance('idle', 4, 1.2)
  const hold = samplePotPerformance('idle', 4, 2.6)
  const greeting = samplePotPerformance('idle', 4, 3.6)
  assert.equal(down.gesture, 'hover-look-down')
  assert.equal(down.pose.bow, 24)
  assert.equal(hold.gesture, 'hover-ponder')
  assert.deepEqual(hold.pose, down.pose)
  assert.equal(greeting.pose.bow, 0)
  assert.equal(greeting.gesture, 'hover-look-up')
  for (const state of ['thinking', 'searching', 'working', 'speaking', 'success', 'error']) {
    assert.deepEqual(samplePotPerformance(state, 4, 1.9), samplePotPerformance(state, 4), 'hover never interrupts an active task')
  }
  assert.deepEqual(samplePotPerformance('idle', 4, 4.8), samplePotPerformance('idle', 4))
  for (let time = 0; time < 4.8; time += 0.025) {
    const { pose, steady } = samplePotPerformance('idle', 0, time)
    assert.equal(pose.tilt, 0, 'no sideways head rotation')
    assert.equal(pose.shiftX, 0, 'no left/right scanning')
    assert.equal(steady, true, 'the original GIF sway also pauses during the bow')
    assert.ok(pose.bow <= 24)
    assert.deepEqual(Object.keys(pose), Object.keys(POT_REST), 'hover has no per-eye position or size controls')
  }
})

test('thinking bows as a single head, holds, then raises the head', () => {
  const before = samplePotPerformance('thinking', 4.8).pose
  const down = samplePotPerformance('thinking', 5.7).pose
  const hold = samplePotPerformance('thinking', 6.6).pose
  const up = samplePotPerformance('thinking', 7.3).pose
  assert.equal(before.bow, 0)
  assert.equal(down.bow, 24)
  assert.deepEqual(down, hold)
  assert.equal(down.tilt, 0, 'forward bow must not become a sideways head tilt')
  assert.equal(up.bow, 0)
  assert.ok(up.lidOpen > 0 && up.mouthOpen > 0)
  assert.equal(samplePotPerformance('thinking', 8.1).pose.lidOpen, 0)
})

test('speaking opens the mouth and rests between phrases', () => {
  const openings = Array.from({ length: 35 }, (_, i) => samplePotPerformance('speaking', i / 10).pose.mouthOpen)
  assert.ok(Math.max(...openings) > 0.5)
  assert.equal(samplePotPerformance('speaking', 4).pose.mouthOpen, 0)
  assert.equal(samplePotPerformance('speaking', 4).pose.lidOpen, 0)
  assert.equal(Math.abs(samplePotPerformance('speaking', 4).pose.handleLeft), 0)
  assert.equal(Math.abs(samplePotPerformance('speaking', 4).pose.handleRight), 0)
  assert.ok(Math.max(...openings) <= 0.65, 'speaking is a small opening, not an exaggerated stretch')
})

test('handles react briefly to listening and completion, then settle', () => {
  const listening = samplePotPerformance('listening', 1).pose
  assert.ok(listening.handleRight > listening.handleLeft)
  const success = samplePotPerformance('success', 0.45).pose
  assert.ok(success.handleLeft > 0 && success.handleRight > 0)
  assert.ok(samplePotPerformance('success', 0.85).pose.handleLeft < 0)
  assert.equal(samplePotPerformance('success', 4).pose.handleLeft, 0)
})

test('invalid inputs fall back to a valid resting start', () => {
  for (const time of [-1, NaN, Infinity]) assert.deepEqual(samplePotPerformance('unknown', time).pose, POT_REST)
})

test('paired blinks close quickly, hold briefly, and reopen with quiet intervals', () => {
  assert.equal(samplePotPerformance('idle', 1.1).pose.blink, 0)
  assert.equal(samplePotPerformance('idle', 1.19).pose.blink, 1)
  assert.ok(samplePotPerformance('idle', 1.3).pose.blink > 0)
  assert.equal(samplePotPerformance('idle', 1.4).pose.blink, 0)
  for (const state of states) {
    let active = 0, closed = 0
    for (let t = 0; t < 14; t += 0.01) {
      const { blink } = samplePotPerformance(state, t).pose
      if (blink > 0) active++
      if (blink > 0.99) closed++
    }
    assert.ok(closed > 0, `${state} has a visible paired blink`)
    assert.ok(active < 14 * 100 * 0.16, `${state} spends most of its time with eyes open`)
  }
})

test('gaze follows attention without moving the sockets or scanning on hover', () => {
  assert.ok(samplePotPerformance('thinking', 0.5).pose.pupilY < 0)
  assert.equal(samplePotPerformance('thinking', 5.7).pose.pupilY, 0.4)
  assert.equal(samplePotPerformance('searching', 0.35).pose.pupilX, -0.55)
  assert.equal(samplePotPerformance('searching', 2.5).pose.pupilX, 0.55)
  for (let t = 0; t < 4.8; t += 0.05) {
    const { pose } = samplePotPerformance('idle', 0, t)
    assert.equal(pose.pupilX, 0, 'hover looks down then forward, never left/right')
  }
  assert.ok(samplePotPerformance('idle', 0, 3.6).pose.mouthOpen > 0)
  assert.ok(samplePotPerformance('idle', 0, 3.6).pose.handleLeft > 0)
})

test('lid rises, makes one small rebound, then rests without changing head proportions', () => {
  for (const [start, sample] of [
    [5.7, age => samplePotPerformance('idle', age).pose],
    [3.15, age => samplePotPerformance('idle', 0, age).pose],
  ]) {
    assert.equal(sample(start).lidBounce, 0)
    assert.ok(sample(start + 0.48).lidBounce > 0.999)
    assert.ok(sample(start + 1.05).lidBounce < 0.001)
    assert.ok(Math.abs(sample(start + 1.27).lidBounce - 0.16) < 0.001)
    assert.equal(sample(start + 1.66).lidBounce, 0)
    for (const knot of [0, 0.48, 1.05, 1.27]) {
      const t = start + knot, h = 0.0001
      const center = sample(t).lidBounce
      const before = sample(t - h).lidBounce, after = sample(t + h).lidBounce
      assert.ok(Math.abs((after - before) / (2 * h)) < 0.001, 'no velocity snap at a turning point')
      assert.ok(Math.abs((after - 2 * center + before) / h ** 2) < 0.2, 'landing acceleration stays smooth')
    }
  }
  for (let time = 5.7; time < 7.4; time += 0.02) {
    const pose = samplePotPerformance('idle', time).pose
    for (const key of ['tilt', 'lift', 'shiftX', 'bow', 'handleLeft', 'handleRight']) assert.equal(pose[key], 0, `${key} is unaffected by the idle lid bounce`)
  }
})

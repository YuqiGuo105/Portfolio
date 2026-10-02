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
    assert.ok(pose.blush >= 0 && pose.blush <= 0.65)
    assert.ok(pose.bow >= 0 && pose.bow <= 24, 'a gentle forward bow, not a deep bend')
    assert.ok(Math.abs(pose.handleLeft) <= 8 && Math.abs(pose.handleRight) <= 8, 'handles stay attached with a small swing')
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
  assert.deepEqual(samplePotPerformance('idle', 4, 4.4), samplePotPerformance('idle', 4))
  for (let time = 0; time < 4.4; time += 0.025) {
    const { pose, steady } = samplePotPerformance('idle', 0, time)
    assert.equal(pose.tilt, 0, 'no sideways head rotation')
    assert.equal(pose.shiftX, 0, 'no left/right scanning')
    assert.equal(steady, true, 'the original GIF sway also pauses during the bow')
    assert.ok(pose.bow <= 24)
    assert.deepEqual(Object.keys(pose), Object.keys(POT_REST), 'hover has no independent eye controls')
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

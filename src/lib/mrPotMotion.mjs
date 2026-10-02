import { POT_REST } from './mrPotAnimation.mjs'

const tracks = {
  idle: { duration: 14, frames: [
    [0, 'rest', {}], [2.4, 'rest', {}],
    [2.7, 'curious-glance', { browLeft: -7 }],
    [3.3, 'curious-lean', { tilt: -3, browLeft: -7, handleLeft: 3 }],
    [4.5, 'curious-lean', { tilt: -3, browLeft: -5 }],
    [5.2, 'settle', {}], [8.4, 'rest', {}],
    [8.9, 'friendly-nod', { bow: 16, mouthWidth: 1.12, mouthOpen: 0.18, blush: 0.3, handleLeft: 3, handleRight: 3 }],
    [9.45, 'friendly-nod', { lift: -0.4, mouthWidth: 1.12, blush: 0.2 }],
    [10.2, 'settle', {}], [14, 'rest', {}],
  ] },
  thinking: { duration: 10.5, frames: [
    [0, 'consider', { mouthHeight: 0.75 }],
    [0.5, 'look-up', { browRight: -12, mouthWidth: 0.8, mouthHeight: 0.6, handleLeft: 3, handleRight: 1 }],
    [1.3, 'ponder', { tilt: -4, lift: -0.5, browLeft: 5, browRight: -5, mouthWidth: 0.8, mouthHeight: 0.6 }],
    [2.7, 'ponder', { tilt: -4, browLeft: 5, browRight: -5, mouthWidth: 0.8, mouthHeight: 0.6 }],
    [3.5, 'reconsider', { tilt: -1, browLeft: -10, mouthWidth: 0.9 }],
    [4.3, 'reconsider', { tilt: 3.3, browLeft: -10, mouthWidth: 0.9, handleRight: 4 }],
    [4.8, 'lower-gaze', { mouthHeight: 0.7 }],
    [5.7, 'look-down', { bow: 24, browLift: 0.3, mouthHeight: 0.7, blush: 0.25 }],
    [6.6, 'look-down', { bow: 24, browLift: 0.3, mouthHeight: 0.7, blush: 0.25 }],
    [7.3, 'small-realization', { lift: -1.3, browLift: -0.8, mouthWidth: 1.1, mouthOpen: 0.45, lidOpen: 0.85, blush: 0.4, handleLeft: 6, handleRight: 6 }],
    [8.1, 'settle', { mouthHeight: 0.85 }],
    [10.5, 'consider', { mouthHeight: 0.75 }],
  ] },
  searching: { duration: 7.6, frames: [
    [0, 'scan-center', {  }],
    [0.35, 'scan-left', {  }],
    [1.1, 'scan-left', { tilt: -3.1, shiftX: -0.55, browLift: -0.3, handleLeft: 4 }],
    [2.1, 'read', { bow: 14 }],
    [2.5, 'scan-right', { tilt: -0.8 }],
    [3.25, 'scan-right', { tilt: 3.3, shiftX: 0.55, browLift: -0.3, handleRight: 4 }],
    [4.5, 'read', { bow: 16 }],
    [5.1, 'recognize', { lift: -0.8, browLift: -0.6, mouthWidth: 1.13, mouthOpen: 0.4, lidOpen: 0.4, blush: 0.2 }],
    [5.8, 'acknowledge', { lift: 0.7, tilt: 1.5, mouthWidth: 1.1 }],
    [6.6, 'settle', {}], [7.6, 'scan-center', {  }],
  ] },
  listening: { duration: 8.8, frames: [
    [0, 'attentive', { browLift: -0.35 }],
    [1, 'head-tilt', { tilt: 3.8, browLift: -0.6, mouthWidth: 0.95, handleRight: 5, handleLeft: 1 }],
    [3, 'head-tilt', { tilt: 3.8, browLift: -0.6, mouthWidth: 0.95, handleRight: 5, handleLeft: 1 }],
    [3.65, 'understanding-nod', { bow: 18, mouthWidth: 1.1, blush: 0.3 }],
    [4.25, 'understanding-nod', { tilt: 0, lift: -0.6, mouthWidth: 1.08, mouthOpen: 0.2, blush: 0.2 }],
    [5.2, 'attentive', { tilt: -1.5, browLift: -0.4 }],
    [7, 'attentive', { tilt: -1.5, browLift: -0.4 }],
    [8.8, 'attentive', { browLift: -0.35 }],
  ] },
  working: { duration: 6.8, frames: [
    [0, 'concentrate', { mouthHeight: 0.65 }],
    [1, 'check-left', { tilt: -2, browLift: 0.3, mouthHeight: 0.65 }],
    [2.1, 'check-left', { tilt: -2, mouthHeight: 0.65 }],
    [2.8, 'check-right', { tilt: 2.1, mouthWidth: 0.88 }],
    [3.9, 'check-right', { tilt: 2.1, mouthWidth: 0.88 }],
    [4.6, 'small-nod', { bow: 18, mouthWidth: 1.12 }],
    [5.2, 'small-nod', { lift: -0.6, mouthWidth: 1.1, lidOpen: 0.35, mouthOpen: 0.3, handleLeft: 3, handleRight: 3 }],
    [6.8, 'concentrate', { mouthHeight: 0.65 }],
  ] },
  success: { duration: 3.6, once: true, frames: [
    [0, 'recognition', {}],
    [0.45, 'brighten', { lift: -1.3, browLift: -0.65, mouthWidth: 1.18, mouthOpen: 0.65, lidOpen: 1, blush: 0.65, handleLeft: 8, handleRight: 8 }],
    [0.85, 'happy-nod', { bow: 18, mouthWidth: 1.2, mouthOpen: 0.4, blush: 0.6, handleLeft: -2, handleRight: -2 }],
    [1.3, 'happy-nod', { lift: -0.75, mouthWidth: 1.15, mouthOpen: 0.3, blush: 0.5, handleLeft: 4, handleRight: 4 }],
    [1.8, 'happy-smile', { tilt: 2, mouthWidth: 1.15, mouthOpen: 0.3, blush: 0.45 }],
    [2.05, 'smile', { tilt: 1, mouthWidth: 1.15, blush: 0.3 }],
    [2.6, 'settle', { mouthWidth: 1.05 }], [3.6, 'rest', {}],
  ] },
  error: { duration: 3.8, once: true, frames: [
    [0, 'notice', {}],
    [0.6, 'concerned', { tilt: -3, browLeft: -12, browRight: 12, mouthWidth: 0.8, mouthHeight: 0.55 }],
    [1.4, 'recheck', { tilt: 1.6, browLeft: -8, browRight: 8, mouthHeight: 0.65 }],
    [2.3, 'reassure', { tilt: -1.3, mouthWidth: 1.03 }],
    [3.8, 'rest', {}],
  ] },
}

const greeting = { duration: 4.4, once: true, frames: [
  [0, 'hover-notice', {}],
  [0.35, 'hover-consider', { browLeft: 4, browRight: -7, mouthHeight: 0.85 }],
  [1.2, 'hover-look-down', { bow: 24, browLeft: 4, browRight: -7, mouthHeight: 0.8, blush: 0.2 }],
  [2.6, 'hover-ponder', { bow: 24, browLeft: 4, browRight: -7, mouthHeight: 0.8, blush: 0.2 }],
  [3.6, 'hover-look-up', { mouthWidth: 1.08, blush: 0.2 }],
  [4.4, 'rest', {}],
] }

function sample(track, time) {
  const t = track.once ? Math.min(time, track.duration) : time % track.duration
  const right = track.frames.findIndex(frame => frame[0] > t)
  const a = track.frames[right < 0 ? track.frames.length - 1 : Math.max(0, right - 1)]
  const b = right < 0 ? a : track.frames[right]
  const progress = a === b ? 0 : (t - a[0]) / (b[0] - a[0])
  const eased = progress * progress * (3 - 2 * progress)
  const pose = { ...POT_REST }
  for (const key of Object.keys(pose)) {
    const start = a[2][key] ?? POT_REST[key], end = b[2][key] ?? POT_REST[key]
    pose[key] = start + (end - start) * eased
  }
  return { pose, gesture: eased > 0.5 ? b[1] : a[1] }
}

// Short actions separated by holds keep the original artwork expressive without
// turning every state into a perpetual wobble. Brows lead; the head follows.
export function samplePotPerformance(state, time, greetingAge = Infinity) {
  const t = Number.isFinite(time) ? Math.max(0, time) : 0
  const mode = Object.hasOwn(tracks, state) || state === 'speaking' ? state : 'idle'
  if (['idle', 'listening'].includes(mode) && greetingAge >= 0 && greetingAge < greeting.duration) {
    return { ...sample(greeting, greetingAge), steady: true }
  }
  if (mode === 'speaking') {
    const phrase = t % 4.8
    const talking = phrase < 3.5
    const envelope = talking ? Math.min(1, phrase / 0.3, (3.5 - phrase) / 0.3) : 0
    const syllable = Math.max(0, Math.sin(t * 8.2)) * (0.8 + Math.sin(t * 2.1) * 0.2)
    return { gesture: talking ? 'speaking-phrase' : 'speaking-pause', pose: {
      ...POT_REST, tilt: Math.sin(t * 1.6) * 2.2 * envelope,
      lift: Math.sin(t * 3.2) * 0.45 * envelope, mouthWidth: 1 + syllable * 0.14 * envelope,
      mouthHeight: 1 + syllable * 0.35 * envelope,
      mouthOpen: syllable * 0.65 * envelope, blush: 0.2 * envelope,
      lidOpen: 0.14 * syllable * envelope,
      browLift: -0.35 * envelope,
      handleLeft: Math.sin(t * 3) * 1.8 * envelope,
      handleRight: Math.sin(t * 3 + 0.4) * 1.8 * envelope,
    } }
  }
  return sample(tracks[mode], t)
}

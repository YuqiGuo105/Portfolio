const clamp = value => Math.max(0, Math.min(1, value));
const pulse = (time, start, duration) => time <= start || time >= start + duration ? 0 : Math.sin(Math.PI * (time - start) / duration) ** 2;
export const WELCOME_SECONDS = 4.4;
export const IDLE_SECONDS = 3.2;
export const REACTION_SECONDS = 2.2;
export const isLivePose = status => ['connecting', 'listening', 'thinking', 'speaking'].includes(status);

export function createCallAttention() {
  return { eyes: { x: 0, y: 0, vx: 0, vy: 0 }, head: { x: 0, y: 0, vx: 0, vy: 0 }, body: { x: 0, y: 0, vx: 0, vy: 0 } };
}

function follow(axis, key, velocity, target, speed, dt) {
  const distance = axis[key] - target;
  const spring = axis[velocity] + speed * distance, decay = Math.exp(-speed * dt);
  axis[key] = target + (distance + spring * dt) * decay;
  axis[velocity] = (axis[velocity] - speed * spring * dt) * decay;
  if (Math.abs(axis[key] - target) < 0.0001 && Math.abs(axis[velocity]) < 0.0001) {
    axis[key] = target; axis[velocity] = 0;
  }
}

// Eyes acquire a target first; the head and shoulders catch up at separate rates.
// The critically damped response is frame-rate independent and never snaps home.
export function stepCallAttention(attention, x, y, dt) {
  x = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
  y = Number.isFinite(y) ? Math.max(-1, Math.min(1, y)) : 0;
  dt = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
  for (const name in attention) {
    const speed = name === 'eyes' ? 18 : name === 'head' ? 7 : 4;
    follow(attention[name], 'x', 'vx', x, speed, dt);
    follow(attention[name], 'y', 'vy', y, speed, dt);
  }
  return attention;
}

// Reuse the target object every frame. Both eyes share one blink and gaze;
// articulation stays separate from the reference model's geometry.
export function sampleCallPose(out, status, age, clock, audioLevel, reactionAge = Infinity, idleVariant = 0) {
  const live = isLivePose(status);
  const welcome = status === 'ready' ? pulse(age, 0.12, 3.8) : 0;
  const idle = status === 'idle' ? pulse(age, 0, IDLE_SECONDS) : 0;
  const farewell = status === 'ended' ? pulse(age, 0.1, 2.1) : 0;
  const delight = pulse(reactionAge, 0, REACTION_SECONDS);
  const thinking = status === 'thinking' || status === 'connecting';
  const speech = status === 'speaking' ? clamp((Number.isFinite(audioLevel) ? audioLevel : 0) * 3) : 0;
  const listening = status === 'listening';
  const listenTime = age % 11.6, thinkTime = age % 13.4;
  const nod = listening ? pulse(listenTime, 0.4, 1.6) + 0.65 * pulse(listenTime, 6.6, 1.5) : 0;
  const attentive = listening ? pulse(listenTime, 2.5, 3.4) : 0;
  const ponder = thinking ? 0.055 + 0.11 * pulse(thinkTime, 0.3, 5.2) : 0;
  const recall = thinking ? pulse(thinkTime, 6.0, 4.0) : 0;
  const explain = speech * pulse(age % 7.8, 0.2, 3.0);
  const emphasis = speech * pulse(age % 7.8, 4.4, 2.1);
  const settle = listening ? pulse(listenTime, 7.9, 2.9) : 0;
  const reflect = thinking ? pulse(thinkTime, 1.1, 4.2) : 0;
  const idleLook = idleVariant % 3 === 0 ? idle : 0;
  const idleGreet = idleVariant % 3 === 1 ? idle : 0;
  const idleSettle = idleVariant % 3 === 2 ? idle : 0;
  const blink = live || welcome || idle || farewell || delight
    ? Math.max(pulse(clock % 5.9, 4.9, 0.24), pulse(age, 0.25, 0.24)) : 0;
  out.pitch = ponder + nod * 0.10 - attentive * 0.025 - recall * 0.055
    + welcome * 0.065 + farewell * 0.09 + emphasis * 0.055 - delight * 0.04;
  out.yaw = recall * -0.105 + attentive * 0.045 + explain * 0.055 + idleLook * 0.065;
  out.roll = attentive * -0.035 + recall * 0.025 - welcome * 0.025;
  out.bodyYaw = explain * -0.035 + recall * -0.025 + idleLook * 0.025;
  out.bodyPitch = nod * 0.018 + reflect * 0.025 - explain * 0.016 + welcome * 0.015;
  out.bodyLean = attentive * -0.016 + emphasis * 0.018 + idleSettle * 0.018;
  out.weightShift = settle * 0.026 - explain * 0.022 + idleSettle * 0.030;
  out.shoulderDrop = -reflect * 0.018 - settle * 0.015 - idleSettle * 0.012;
  out.blink = 1 - blink * 0.94;
  out.gazeX = recall * -0.026 + attentive * 0.016 + idleLook * 0.02;
  out.gazeY = (thinking ? -0.022 * pulse(thinkTime, 0.3, 5.2) : 0)
    + recall * 0.022 - nod * 0.018 + delight * 0.022;
  out.brow = recall * 0.032 + attentive * 0.022 + welcome * 0.035 + speech * 0.025 + delight * 0.045;
  out.mouth = speech;
  out.arm = welcome * (0.12 + Math.sin(age * 7) * 0.17)
    + farewell * (0.09 + Math.sin(age * 8) * 0.12) + explain * 0.21 - emphasis * 0.07
    + delight * 0.12 - reflect * 0.065 + idleGreet * 0.14;
  out.armDepth = explain * -0.15 + recall * 0.08 - welcome * 0.10 - idleGreet * 0.10;
  out.armPitch = reflect * -0.055 + emphasis * 0.06 - idleGreet * 0.04;
  out.otherArm = emphasis * -0.13 - attentive * 0.035 - delight * 0.05 - idleGreet * 0.055;
  out.otherArmDepth = -explain * 0.07 + reflect * 0.08 - settle * 0.05;
  out.lid = welcome * 0.075 + delight * 0.21 + 0.025 * pulse(reactionAge, 1.65, 0.55);
  out.handle = delight * 0.055 + emphasis * 0.025 + welcome * 0.025;
  out.steam = live ? Math.sin(clock * 1.5) * 0.045 : (welcome + idle + farewell + delight) * 0.035;
  return out;
}

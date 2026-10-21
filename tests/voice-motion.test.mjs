import test from 'node:test';
import assert from 'node:assert/strict';
import { createCallAttention, IDLE_SECONDS, REACTION_SECONDS, sampleCallPose, stepCallAttention, WELCOME_SECONDS } from '../src/lib/voice/callMotion.mjs';
import * as THREE from 'three';
import { createFullBodyPot, disposeFullBody, fullBodyStats, potFaceDepth } from '../src/lib/voice/fullBodyModel.mjs';
import { createCallEyes } from '../src/lib/voice/callEyes.mjs';

test('poses keep gaze within eye whites and use one blink value for both eyes', () => {
  const pose = {};
  for (const status of ['ready', 'idle', 'connecting', 'listening', 'thinking', 'speaking', 'ended', 'error']) {
    for (let t = 0; t < 30; t += 0.04) {
      assert.equal(sampleCallPose(pose, status, t, t, 1), pose, 'reuse output without per-frame allocations');
      for (const value of Object.values(pose)) assert.ok(Number.isFinite(value));
      assert.ok(Math.abs(pose.gazeX) <= 0.026 && Math.abs(pose.gazeY) <= 0.025);
      assert.ok(pose.blink >= 0.06 && pose.blink <= 1);
      assert.ok(Math.abs(pose.pitch) <= 0.17 && Math.abs(pose.arm) <= 0.30);
      assert.ok(Math.abs(pose.roll) <= 0.035 && Math.abs(pose.bodyYaw) <= 0.035);
      assert.ok(pose.mouth >= 0 && pose.mouth <= 1);
    }
  }
});

test('greeting is finite, listening nods, thinking bows, and speech follows real audio', () => {
  const rest = sampleCallPose({}, 'ended', 4, 4, 0);
  assert.deepEqual(sampleCallPose({}, 'ready', WELCOME_SECONDS + 1, 4, 0), rest);
  assert.ok(sampleCallPose({}, 'ready', 2, 2, 0).arm > 0.2);
  assert.ok(sampleCallPose({}, 'listening', 1.3, 1.3, 0).pitch > 0.05);
  assert.ok(sampleCallPose({}, 'thinking', 2.5, 2.5, 0).pitch > 0.15);
  assert.equal(sampleCallPose({}, 'speaking', 4, 4, 0).mouth, 0);
  assert.ok(sampleCallPose({}, 'speaking', 4, 4, 0.2).mouth > 0.5);
  assert.equal(sampleCallPose({}, 'speaking', 0.4, 0.4, 0).lid, 0, 'silent speech does not pop the lid');
});

test('each conversational state has distinct staged gestures, not a perpetual sway', () => {
  const listening = sampleCallPose({}, 'listening', 4.2, 4.2, 0);
  const downward = sampleCallPose({}, 'thinking', 2.5, 2.5, 0);
  const recall = sampleCallPose({}, 'thinking', 8, 8, 0);
  assert.ok(listening.roll < -0.03 && listening.gazeX > 0);
  assert.ok(downward.gazeY < 0 && recall.gazeY > 0);
  assert.ok(recall.yaw < -0.1 && recall.pitch < downward.pitch);
  const explain = sampleCallPose({}, 'speaking', 1.7, 1.7, 0.3);
  const emphasize = sampleCallPose({}, 'speaking', 5.45, 5.45, 0.3);
  assert.ok(explain.arm > 0.18 && explain.armDepth < -0.1);
  assert.ok(emphasize.otherArm < -0.1);
  for (const status of ['ready', 'listening', 'thinking', 'ended', 'error']) {
    assert.equal(sampleCallPose({}, status, 2, 2, 1).mouth, 0, 'only audible output drives the mouth');
  }
});

test('idle and tap reactions settle without changing proportions or restarting a call', () => {
  const rest = sampleCallPose({}, 'error', 10, 10, 0);
  assert.deepEqual(sampleCallPose({}, 'idle', IDLE_SECONDS + 1, 10, 0), rest);
  assert.deepEqual(sampleCallPose({}, 'ready', 10, 10, 0, REACTION_SECONDS + 1), rest);
  const popped = sampleCallPose({}, 'ready', 10, 10, 0, 1.1);
  assert.ok(popped.lid >= 0.20 && popped.handle > 0.04);
  assert.ok(popped.gazeY > 0 && popped.brow > 0.04);
  assert.equal(popped.mouth, 0);
  assert.equal(Object.keys(popped).some(key => /scale/i.test(key)), false);
  assert.equal(sampleCallPose({}, 'speaking', 2, 2, NaN).mouth, 0);
});

test('pointer attention leads with eyes, then head and shoulders, and holds a stationary target', () => {
  const attention = createCallAttention();
  for (let i = 0; i < 4; i++) stepCallAttention(attention, 1, -1, 1 / 24);
  assert.ok(attention.eyes.x > attention.head.x && attention.head.x > attention.body.x);
  assert.ok(attention.head.x > 0 && attention.head.x < 0.5, 'head eases in instead of snapping');
  for (let i = 0; i < 120; i++) stepCallAttention(attention, 1, -1, 1 / 24);
  for (const channel of Object.values(attention)) { assert.equal(channel.x, 1); assert.equal(channel.y, -1); }
  stepCallAttention(attention, 0, 0, 1 / 24);
  assert.ok(attention.head.x > 0.9, 'leaving the stage does not snap to center');
  for (let i = 0; i < 100; i++) stepCallAttention(attention, 0, 0, 1 / 24);
  for (const channel of Object.values(attention)) { assert.equal(channel.x, 0); assert.equal(channel.y, 0); }
});

test('attention is frame-rate independent, bounded and robust to malformed coordinates', () => {
  const slow = createCallAttention(), fast = createCallAttention();
  for (let i = 0; i < 12; i++) stepCallAttention(slow, 0.75, -0.5, 1 / 24);
  for (let i = 0; i < 30; i++) stepCallAttention(fast, 0.75, -0.5, 1 / 60);
  for (const key of Object.keys(slow)) assert.ok(Math.abs(slow[key].x - fast[key].x) < 1e-10);
  for (let i = 0; i < 500; i++) {
    stepCallAttention(slow, i % 8 < 4 ? 100 : -100, NaN, 1 / 24);
    for (const axis of Object.values(slow)) {
      assert.ok(Math.abs(axis.x) <= 1 && Number.isFinite(axis.y));
    }
  }
});

test('posture adds shoulder, arm-depth and weight shifts with bounded movement and varied idle gestures', () => {
  const thinking = sampleCallPose({}, 'thinking', 3.2, 3.2, 0);
  const explaining = sampleCallPose({}, 'speaking', 1.7, 1.7, 0.3);
  assert.ok(thinking.shoulderDrop < -0.015 && thinking.armPitch < -0.04);
  assert.ok(explaining.weightShift < -0.015 && explaining.otherArmDepth < -0.05);
  const variants = [0, 1, 2].map(i => sampleCallPose({}, 'idle', 1.6, 1.6, 0, Infinity, i));
  assert.ok(variants[0].yaw > 0 && variants[1].arm > 0.1 && variants[2].weightShift > 0.025);
  for (const pose of variants) assert.equal(Object.keys(pose).some(key => /scale/i.test(key)), false);
});

test('eyes remain surface-conforming through gaze and blink without additional meshes or altered proportions', () => {
  const model = createFullBodyPot(), stats = fullBodyStats(model.root);
  try {
    const eyes = createCallEyes(model.face);
    const reference = model.face.getObjectByName('EyeLeftPupil').geometry.attributes.position.array.slice();
    for (const blink of [1, 0.5, 0.12, 0.06]) for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) {
      eyes.update(x, y, blink);
      for (const side of ['Left', 'Right']) for (const [part, offset] of [['White', 0.025], ['Pupil', 0.032], ['Glint', 0.039]]) {
        const position = model.face.getObjectByName(`Eye${side}${part}`).geometry.attributes.position;
        for (let i = 0; i < position.count; i++) {
          assert.ok(Math.abs(position.getZ(i) - potFaceDepth(position.getX(i), position.getY(i)) - offset) < 1e-6);
        }
      }
    }
    eyes.update(0, 0, 1);
    const restored = model.face.getObjectByName('EyeLeftPupil').geometry.attributes.position.array;
    for (let i = 0; i < reference.length; i++) assert.ok(Math.abs(restored[i] - reference[i]) < 1e-6);
    assert.equal(eyes.update(0, 0, 1), false, 'unchanged eyes do not re-upload geometry');
    assert.deepEqual(fullBodyStats(model.root), stats);
  } finally { disposeFullBody(model.root); }
});

test('both pupils are in front of the eye white and pot at all supported gaze extremes and head angles', () => {
  const model = createFullBodyPot(), eyes = createCallEyes(model.face);
  const ray = new THREE.Raycaster(), point = new THREE.Vector3(), direction = new THREE.Vector3(0, 0, -1);
  const surfaces = [];
  model.root.traverse(object => { if (object.isMesh) surfaces.push(object); });
  try {
    for (const blink of [1, 0.45, 0.12]) for (const gazeX of [-0.032, 0, 0.032]) for (const gazeY of [-0.027, 0, 0.027]) {
      eyes.update(gazeX, gazeY, blink);
      for (const yaw of [-0.28, 0, 0.28]) for (const pitch of [-0.11, 0, 0.25]) {
        model.head.rotation.set(pitch, yaw, 0.035); model.root.updateMatrixWorld(true);
        for (const side of ['Left', 'Right']) {
          const pupil = model.face.getObjectByName(`Eye${side}Pupil`);
          const position = pupil.geometry.attributes.position;
          for (const [dx, dy] of [[0, 0], [-0.4, 0], [0.4, 0], [0, -0.4]]) {
            const x = position.getX(0) + dx * 0.107, y = position.getY(0) + dy * 0.139 * blink;
            point.set(x, y, potFaceDepth(x, y) + 0.032); pupil.localToWorld(point);
            ray.set(new THREE.Vector3(point.x, point.y, 10), direction);
            const hit = ray.intersectObjects(surfaces, false)[0];
            assert.ok(hit?.object.name === `Eye${side}Pupil` || hit?.object.name === `Eye${side}Glint`,
              `${side} pupil occluded by ${hit?.object.name} at ${gazeX},${gazeY}, blink ${blink}, yaw ${yaw}, pitch ${pitch}`);
          }
        }
      }
    }
  } finally { disposeFullBody(model.root); }
});

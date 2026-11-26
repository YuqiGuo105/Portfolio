import * as THREE from 'three';
import { createFullBodyPot, disposeFullBody } from './fullBodyModel.mjs';
import { createCallEyes } from './callEyes.mjs';
import { CALL_MOUTH, createCallAttention, IDLE_SECONDS, isLivePose, REACTION_SECONDS, sampleCallMouth, sampleCallPose, stepCallAttention, stepCallMouth, WELCOME_SECONDS } from './callMotion.mjs';
import { CALL_GROUND } from './callTheme.mjs';

export function createCallScene(canvas, { onFailure = () => {}, dark = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0, 0);
  const scene = new THREE.Scene();
  const model = createFullBodyPot();
  scene.add(model.root);
  const camera = new THREE.OrthographicCamera(-5, 5, 3, -3, 0.1, 50);
  camera.position.set(0.15, 2.99, 14);
  camera.lookAt(0.15, 2.43, 0);

  // The ground and a soft contact shadow under the unchanged reference model. No shadow maps,
  // environment textures, postprocessing or per-frame allocations. The wall behind him is the
  // call window itself, seen through the transparent canvas.
  const setting = new THREE.Group(); scene.add(setting);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.MeshBasicMaterial());
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.06; setting.add(floor);
  scene.add(new THREE.HemisphereLight('#ffffff', '#8a9d91', 2.5));
  const key = new THREE.DirectionalLight('#fff6eb', 2.0); key.position.set(-4, 7, 6); scene.add(key);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.scale.set(1.17, 0.55, 1); shadow.position.set(0.10, -0.045, 0.12); setting.add(shadow);
  // Only the ground follows the page's theme; Mr. Pot is lit the same in both.
  const paint = night => {
    const ground = night ? CALL_GROUND.dark : CALL_GROUND.light;
    floor.material.color.set(ground.floor);
    shadow.material.color.set(ground.shadow); shadow.material.opacity = ground.shade;
  };
  paint(dark);

  const smile = model.face.getObjectByName('Smile');
  const mouth = new THREE.Group(); mouth.position.set(0, 2.15, 0); model.face.add(mouth);
  mouth.add(smile); smile.position.y -= 2.15;
  // When he speaks the smile itself opens (sampleCallMouth). The opening is one small patch
  // between the two lips, in the smile's own ink and just in front of it, so the line stays
  // drawn, the corners keep their round ends and nothing is swapped in or out.
  smile.geometry.computeBoundingBox();
  const mouthZ = smile.geometry.boundingBox.max.z + 0.006;
  const lipDepths = new Float32Array(CALL_MOUTH.samples * 2), lipPoints = new Float32Array(CALL_MOUTH.samples * 6), lipFaces = [];
  for (let i = 0; i < CALL_MOUTH.samples; i++) {
    const x = (i / (CALL_MOUTH.samples - 1) * 2 - 1) * CALL_MOUTH.half;
    for (const row of [0, CALL_MOUTH.samples]) { lipPoints[(row + i) * 3] = x; lipPoints[(row + i) * 3 + 2] = mouthZ; }
    if (i) lipFaces.push(i - 1, CALL_MOUTH.samples + i - 1, CALL_MOUTH.samples + i, i - 1, CALL_MOUTH.samples + i, i);
  }
  const lipShape = new THREE.BufferGeometry();
  lipShape.setAttribute('position', new THREE.BufferAttribute(lipPoints, 3)); lipShape.setIndex(lipFaces);
  const lips = new THREE.Mesh(lipShape, new THREE.MeshBasicMaterial({ color: smile.material.color, side: THREE.DoubleSide }));
  lips.name = 'Lips'; lips.visible = false; lips.frustumCulled = false; model.face.add(lips);
  const shapeMouth = open => {
    lips.visible = open > 0.02;
    if (!lips.visible) return;
    sampleCallMouth(lipDepths, open);
    for (let i = 0; i < lipDepths.length; i++) lipPoints[i * 3 + 1] = CALL_MOUTH.y - lipDepths[i];
    lipShape.attributes.position.needsUpdate = true;
  };
  const eyes = createCallEyes(model.face);
  // Keep both feet planted. Articulate the existing upper body around the hips
  // without stretching geometry or opening the shoulder/neck joins.
  const upperBody = new THREE.Group(); upperBody.position.y = 0.85; model.root.add(upperBody);
  for (const child of [...model.body.children.filter(part => !part.name.startsWith('Leg')), model.head]) {
    upperBody.add(child); child.position.y -= 0.85;
  }
  const brows = ['Left', 'Right'].map(side => model.face.getObjectByName(`Brow${side}`));
  const handles = ['Left', 'Right'].map((side, i) => {
    const mesh = model.head.getObjectByName(`PotHandle${side}`), pivot = new THREE.Group();
    pivot.position.set((i ? 1 : -1) * 1.07, 2.69, 0);
    mesh.parent.add(pivot); pivot.add(mesh); mesh.position.sub(pivot.position);
    return pivot;
  });
  const steam = [0, 1].map(i => model.lid.getObjectByName(`Steam${i}`));
  const pose = sampleCallPose({}, 'ended', 0, 0, 0), target = { ...pose };
  const attention = createCallAttention();
  let status = 'ready', level = 0, gestureLevel = 0, mouthLevel = 0, frame = 0, last = 0, stopped = false, rendered = 0, visible = true;
  let replyVariant = -1, lastSpeechAt = -Infinity, speechAt = 0;
  let stateAt = performance.now(), reactionAt = -Infinity, pointerAt = -Infinity;
  let pointerX = 0, pointerY = 0, idleTimer = null, idleCycle = false, idleVariant = 0;
  let bounds = null;
  const start = stateAt;
  const render = () => {
    renderer.render(scene, camera);
    canvas.dataset.frames = String(++rendered);
    canvas.dataset.triangles = String(renderer.info.render.triangles);
  };
  const tick = time => {
    frame = 0;
    if (stopped || document.hidden || !visible) return;
    const age = (time - stateAt) / 1000;
    if (time - last >= 1000 / 24) {
      const t = (time - start) / 1000;
      const dt = Math.min((time - last) / 1000, 0.1);
      const smoothing = 1 - Math.exp(-dt * 12);
      last = time;
      gestureLevel += (level - gestureLevel) * (1 - Math.exp(-dt * 4));
      sampleCallPose(target, idleCycle ? 'idle' : status, age, t, gestureLevel, (time - reactionAt) / 1000, idleVariant, Math.max(0, replyVariant));
      mouthLevel = stepCallMouth(mouthLevel, status === 'speaking' ? level : 0, dt);
      target.mouth = mouthLevel;
      stepCallAttention(attention, pointerX, pointerY, dt);
      for (const key in pose) pose[key] += (target[key] - pose[key]) * (key === 'blink' ? 1 : smoothing);
      upperBody.rotation.set(pose.bodyPitch, pose.bodyYaw + attention.body.x * 0.035, pose.bodyLean);
      upperBody.position.set(pose.weightShift, 0.85 + pose.shoulderDrop, 0);
      model.head.rotation.set(pose.pitch - attention.head.y * 0.055, pose.yaw + attention.head.x * 0.12, pose.roll - attention.head.x * 0.012);
      model.lid.position.y = 3.1 + pose.lid;
      model.rightArm.rotation.set(pose.armPitch, pose.armDepth, pose.arm);
      model.leftArm.rotation.z = pose.otherArm;
      model.leftArm.rotation.y = pose.otherArmDepth;
      model.leftArm.rotation.x = pose.otherArmPitch;
      handles[0].rotation.z = -pose.handle; handles[1].rotation.z = pose.handle;
      shapeMouth(pose.mouth);
      eyes.update(pose.gazeX + attention.eyes.x * 0.028, pose.gazeY + attention.eyes.y * 0.022, pose.blink);
      for (const brow of brows) brow.position.y = pose.brow;
      for (let i = 0; i < steam.length; i++) { steam[i].position.x = pose.steam * (i ? -0.6 : 1); steam[i].position.y = Math.abs(pose.steam); }
      render();
    }
    const duration = idleCycle ? IDLE_SECONDS : status === 'ready' ? WELCOME_SECONDS : status === 'ended' ? 2.4 : 0;
    if (isLivePose(status) || age < duration + 0.8 || time - reactionAt < (REACTION_SECONDS + 0.8) * 1000 || time - pointerAt < 3200) {
      frame = requestAnimationFrame(tick);
    } else if (status === 'ready' && !idleTimer) {
      // Occasional attention while waiting, with no RAF loop between gestures.
      idleTimer = setTimeout(() => {
        idleTimer = null; idleCycle = true; idleVariant = (idleVariant + 1) % 3; stateAt = performance.now(); invalidate();
      }, 12000);
    }
  };
  const invalidate = () => { if (!frame && !stopped && !document.hidden && visible) frame = requestAnimationFrame(tick); };
  const resize = () => {
    bounds = canvas.getBoundingClientRect();
    const { width, height } = bounds;
    if (!width || !height || stopped || !visible) return;
    renderer.setSize(width, height, false);
    const aspect = width / height, h = Math.max(5.1, 3.7 / aspect);
    camera.left = -h * aspect / 2; camera.right = h * aspect / 2;
    camera.top = h / 2; camera.bottom = -h / 2; camera.updateProjectionMatrix();
    render();
  };
  const pause = () => { cancelAnimationFrame(frame); frame = 0; clearTimeout(idleTimer); idleTimer = null; pointerX = 0; pointerY = 0; };
  const visibility = () => { if (document.hidden) pause(); else { pointerAt = performance.now(); resize(); invalidate(); } };
  const lost = event => { event.preventDefault(); onFailure(); };
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  document.addEventListener('visibilitychange', visibility);
  canvas.addEventListener('webglcontextlost', lost);
  canvas.dataset.engine = `three.js r${THREE.REVISION}`;
  resize();
  return {
    state(value) {
      if (status !== value) {
        const time = performance.now();
        // Brief playback gaps must not restart the choreography on every chunk.
        if (value === 'speaking' && time - lastSpeechAt > 1200) {
          replyVariant = (replyVariant + 1) % 3; speechAt = time;
        }
        if (status === 'speaking') lastSpeechAt = time;
        status = value; stateAt = value === 'speaking' ? speechAt : time;
        idleCycle = false; clearTimeout(idleTimer); idleTimer = null;
      }
      invalidate();
    },
    replay() { stateAt = performance.now(); idleCycle = false; clearTimeout(idleTimer); idleTimer = null; invalidate(); },
    visible(value) { visible = value; if (!value) pause(); else { pointerAt = performance.now(); resize(); invalidate(); } },
    // A hidden scene is repainted when it is shown again.
    theme(night) { paint(night); if (visible && !stopped) render(); },
    enter() { bounds = canvas.getBoundingClientRect(); },
    point(x, y) {
      if (!bounds || !visible) return;
      const nextX = THREE.MathUtils.clamp((x - bounds.left) / bounds.width * 2 - 1, -1, 1);
      const nextY = THREE.MathUtils.clamp(1 - (y - bounds.top) / bounds.height * 2, -1, 1);
      if (Math.abs(nextX - pointerX) < 0.012 && Math.abs(nextY - pointerY) < 0.012) return;
      pointerX = nextX; pointerY = nextY;
      clearTimeout(idleTimer); idleTimer = null;
      pointerAt = performance.now(); invalidate();
    },
    leave() { pointerX = 0; pointerY = 0; pointerAt = performance.now(); invalidate(); },
    react() {
      if (performance.now() - reactionAt < REACTION_SECONDS * 1000) return;
      reactionAt = performance.now(); invalidate();
    },
    level(value) { level = Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0; },
    dispose() {
      stopped = true; pause(); observer.disconnect();
      document.removeEventListener('visibilitychange', visibility); canvas.removeEventListener('webglcontextlost', lost);
      disposeFullBody(model.root);
      setting.traverse(object => { if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); } });
      renderer.dispose(); renderer.forceContextLoss();
    },
  };
}

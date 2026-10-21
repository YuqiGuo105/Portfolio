import * as THREE from 'three';
import { createFullBodyPot, disposeFullBody } from './fullBodyModel.mjs';
import { createCallEyes } from './callEyes.mjs';
import { createCallAttention, IDLE_SECONDS, isLivePose, REACTION_SECONDS, sampleCallPose, stepCallAttention, WELCOME_SECONDS } from './callMotion.mjs';

export function createCallScene(canvas, { onFailure = () => {} } = {}) {
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

  // Architectural steps sit behind the unchanged reference model. No shadow
  // maps, environment textures, postprocessing or per-frame allocations.
  const setting = new THREE.Group(); scene.add(setting);
  for (let i = 0; i < 3; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.30 + i * 0.38, 2.0),
      new THREE.MeshLambertMaterial({ color: ['#d7e6e0', '#e0ebe6', '#e9efec'][i] }));
    step.position.set(-3.3 - i * 0.65, -0.38 + i * 0.19, -2.1 - i * 1.5);
    step.rotation.y = -0.16;
    setting.add(step);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.MeshBasicMaterial({ color: '#eaf0ec' }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.06; setting.add(floor);
  scene.add(new THREE.HemisphereLight('#ffffff', '#8a9d91', 2.5));
  const key = new THREE.DirectionalLight('#fff6eb', 2.0); key.position.set(-4, 7, 6); scene.add(key);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: '#65776f', opacity: 0.10, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.scale.set(1.17, 0.55, 1); shadow.position.set(0.10, -0.045, 0.12); setting.add(shadow);

  const smile = model.face.getObjectByName('Smile');
  const mouth = new THREE.Group(); mouth.position.set(0, 2.15, 0); model.face.add(mouth);
  mouth.add(smile); smile.position.y -= 2.15;
  // A small open mouth replaces the smile only during audible speech. It is
  // tangent to the face, not a stretched copy of the whole lower face.
  smile.geometry.computeBoundingBox();
  const mouthZ = smile.geometry.boundingBox.max.z + 0.006;
  const openMouth = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: '#373936', side: THREE.DoubleSide }));
  openMouth.position.set(0, 2.155, mouthZ); openMouth.visible = false; model.face.add(openMouth);
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
  let status = 'ready', level = 0, gestureLevel = 0, frame = 0, last = 0, stopped = false, rendered = 0, visible = true;
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
      sampleCallPose(target, idleCycle ? 'idle' : status, age, t, gestureLevel, (time - reactionAt) / 1000, idleVariant);
      target.mouth = status === 'speaking' ? THREE.MathUtils.clamp(level * 3, 0, 1) : 0;
      stepCallAttention(attention, pointerX, pointerY, dt);
      for (const key in pose) pose[key] += (target[key] - pose[key]) * (key === 'blink' ? 1 : smoothing);
      upperBody.rotation.set(pose.bodyPitch, pose.bodyYaw + attention.body.x * 0.035, pose.bodyLean);
      upperBody.position.set(pose.weightShift, 0.85 + pose.shoulderDrop, 0);
      model.head.rotation.set(pose.pitch - attention.head.y * 0.055, pose.yaw + attention.head.x * 0.12, pose.roll - attention.head.x * 0.012);
      model.lid.position.y = 3.1 + pose.lid;
      model.rightArm.rotation.set(pose.armPitch, pose.armDepth, pose.arm);
      model.leftArm.rotation.z = pose.otherArm;
      model.leftArm.rotation.y = pose.otherArmDepth;
      handles[0].rotation.z = -pose.handle; handles[1].rotation.z = pose.handle;
      openMouth.visible = pose.mouth > 0.10;
      smile.visible = !openMouth.visible;
      openMouth.scale.set(0.115 + pose.mouth * 0.02, 0.025 + pose.mouth * 0.065, 1);
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
      if (status !== value) { status = value; stateAt = performance.now(); idleCycle = false; clearTimeout(idleTimer); idleTimer = null; }
      invalidate();
    },
    replay() { stateAt = performance.now(); idleCycle = false; clearTimeout(idleTimer); idleTimer = null; invalidate(); },
    visible(value) { visible = value; if (!value) pause(); else { pointerAt = performance.now(); resize(); invalidate(); } },
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

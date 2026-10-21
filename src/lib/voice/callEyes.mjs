import { potFaceDepth } from './fullBodyModel.mjs';
import { DynamicDrawUsage } from 'three';

const LIMIT_X = 0.032, LIMIT_Y = 0.027;
const LAYERS = [['Border', 0.018], ['White', 0.025], ['Pupil', 0.032], ['Glint', 0.039]];
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

// Move the existing patches over the curved surface, not through it. Blink and
// pupil motion share the same projection, keeping all four layers in depth order.
export function createCallEyes(face) {
  const layers = ['Left', 'Right'].flatMap(side => LAYERS.map(([part, offset]) => {
    const mesh = face.getObjectByName(`Eye${side}${part}`);
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.boundingSphere.radius += 0.12;
    mesh.geometry.attributes.position.setUsage(DynamicDrawUsage);
    return { mesh, source: mesh.geometry.attributes.position.array.slice(), offset, moving: part === 'Pupil' || part === 'Glint' };
  }));
  let previousX = NaN, previousY = NaN, previousBlink = NaN;
  return {
    update(x, y, blink) {
      x = Math.max(-LIMIT_X, Math.min(LIMIT_X, finite(x)));
      y = Math.max(-LIMIT_Y, Math.min(LIMIT_Y, finite(y)));
      const distance = Math.hypot(x / LIMIT_X, y / LIMIT_Y);
      if (distance > 1) { x /= distance; y /= distance; }
      blink = Math.max(0.06, Math.min(1, finite(blink, 1)));
      if (x === previousX && y === previousY && blink === previousBlink) return false;
      previousX = x; previousY = y; previousBlink = blink;
      for (const { mesh, source, offset, moving } of layers) {
        const position = mesh.geometry.attributes.position;
        for (let i = 0; i < position.count; i++) {
          const px = source[i * 3] + (moving ? x : 0);
          const py = 2.39 + (source[i * 3 + 1] - 2.39 + (moving ? y : 0)) * blink;
          position.setXYZ(i, px, py, potFaceDepth(px, py) + offset);
        }
        position.needsUpdate = true;
      }
      return true;
    },
  };
}

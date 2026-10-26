// Sharp imagery for close-ups on the visitor globe. A three-slippy-map-globe shell floats just above
// RotatingGlobe's base texture and only switches on once the camera is close enough for that texture to
// look soft; the level math lives in globeTiles.mjs. Client-only: RotatingGlobe is loaded with ssr: false.
import { MeshPhongMaterial, PerspectiveCamera } from "three";
import SlippyMapGlobe from "three-slippy-map-globe";

import {
  DEFAULT_MIN_ALTITUDE,
  GLOBE_TILE_MAX_ZOOM,
  minSharpAltitude,
  minTileZoom,
  textureZoom,
  tilePath,
  tileScale,
  tileShellScale,
  pickTileLevel,
  tilesWanted,
} from "./globeTiles.mjs";

// three-globe's globe radius, in scene units.
const GLOBE_RADIUS = 100;

// Tiles must look like the globe they sharpen. Blue Marble is darker and less saturated than the base
// texture (/textures/earth_day_*.jpg), so texels are first graded towards it (land samples from six
// continents fit base ≈ tile^0.58 with a quarter more saturation; open water takes the ocean colour).
// That only gets close, and every colour step showed as a patch moving across the globe. So the shader
// then takes the low frequencies from the base texture itself: it compares a blurred tile (a coarse
// mip level, at the base texture's resolution) with the base texture at the same latitude/longitude and
// rescales the tile by the ratio. What remains of the tile is only the fine detail, so a tile appearing,
// disappearing or switching level changes sharpness, never colour. Values are linear, as the shader sees them.
const TILE_VERTEX = `#include <begin_vertex>
vGlobePos = position;`;
const TILE_GRADE = `
vec3 gradeTexel(vec3 texel) {
  texel = max(texel, vec3(0.0));
  // Deep ocean in Blue Marble is nearly black (sRGB ~2,6,18); a large epsilon here classed those texels as
  // land and left dark specks and streaks over the sea. Near-black texels with blue at least level with
  // red and green count as water too.
  float bright = max(max(texel.r, texel.g), texel.b);
  float water = smoothstep(1.25, 1.8, texel.b / (max(texel.r, texel.g) + 0.0003));
  water = max(water, (1.0 - smoothstep(0.006, 0.02, bright)) * step(max(texel.r, texel.g) * 0.9, texel.b));
  vec3 land = pow(texel, vec3(0.58));
  land = max(mix(vec3(dot(land, vec3(0.2126, 0.7152, 0.0722))), land, 1.25), 0.0);
  return mix(land, vec3(0.0130, 0.0437, 0.1778), water);
}
`;
const TILE_FRAGMENT = `{
  vec3 fine = gradeTexel(texture2D(map, vMapUv).rgb);
  if (uBaseReady > 0.5) {
    vec3 coarse = gradeTexel(texture2D(map, vMapUv, uLowBias).rgb);
    vec3 dir = normalize(vGlobePos);
    vec2 baseUv = vec2(atan(dir.x, dir.z) / 6.28318531 + 0.5, asin(clamp(dir.y, -1.0, 1.0)) / 3.14159265 + 0.5);
    // Explicit level 0: longitude wraps from +180° to -180° inside one pixel quad there, and the implied
    // mip pick would grab a tiny average and draw a dashed line down the antimeridian. Tiles only show
    // when the base texture is magnified, so level 0 is always the right one.
    vec3 base = textureLod(uBaseMap, baseUv, 0.0).rgb;
    fine *= clamp((base + 0.004) / (coarse + 0.004), vec3(0.33), vec3(3.0));
  }
  diffuseColor.rgb *= fine;
}`;

// One set of uniforms for every tile: the base texture arrives after the layer is created.
function baseUniforms() {
  return { uBaseMap: { value: null }, uBaseReady: { value: 0 } };
}

// The engine builds Lambert tiles; the base globe is Phong (three-globe's default), whose highlight made
// tiles read as darker patches. Swap in a Phong material with the same texture before the first render.
function prepareTile(object, anisotropy, shared, baseZoom) {
  const old = object?.material;
  if (!old?.map || old.userData.globeTile) return;
  const map = old.map;
  map.anisotropy = anisotropy;
  // polygonOffset pulls the tile towards the camera in the depth test, so it never fights the base globe
  // just below it (that z-fighting showed as speckles and flicker near the horizon while turning).
  const material = new MeshPhongMaterial({ map, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  material.userData.globeTile = true;
  old.map = null;
  old.dispose();
  // A tile spans 360° / 2^level of longitude; finer levels draw after coarser ones they cover.
  const span = object.geometry?.parameters?.phiLength || Math.PI * 2;
  const level = Math.round(Math.log2((Math.PI * 2) / span));
  object.renderOrder = 1 + level;
  object.userData.globeTileLevel = level;
  object.geometry?.computeBoundingSphere?.();
  object.userData.globeTileDir = object.geometry?.boundingSphere?.center.clone().normalize() || null;
  object.userData.globeTileReach = object.geometry?.boundingSphere?.radius / GLOBE_RADIUS || 0;
  const lowBias = Math.max(0, level - baseZoom);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBaseMap = shared.uBaseMap;
    shader.uniforms.uBaseReady = shared.uBaseReady;
    shader.uniforms.uLowBias = { value: lowBias };
    shader.vertexShader = `varying vec3 vGlobePos;\n${shader.vertexShader.replace("#include <begin_vertex>", TILE_VERTEX)}`;
    shader.fragmentShader = `varying vec3 vGlobePos;\nuniform sampler2D uBaseMap;\nuniform float uBaseReady;\nuniform float uLowBias;\n${TILE_GRADE}\n${shader.fragmentShader.replace("#include <map_fragment>", TILE_FRAGMENT)}`;
  };
  material.customProgramCacheKey = () => "globe-tile-grade-v2";
  object.material = material;
}

// The engine fetches every tile with a corner in the view frustum, which also takes in the far side of
// the globe and, while the whole globe is on screen, a limb so foreshortened that the base texture serves
// it fine. The culler is the real camera with its far plane on the horizon (nothing behind the globe) and,
// until the globe fills the view, its field narrowed to the inner 80% of the disc.
const CORE_DISC = 0.8;
// A camera that moved more than 1.5% in altitude since the last sync is still zooming.
const ZOOM_SETTLE = 0.015;
// Tiles that turn away from the camera (auto-rotation, panning) give their GPU texture back and hide; three
// re-uploads them from the kept image if they come round again, so nothing flashes and phones do not run
// out of GPU memory (a lost WebGL context blanks or reloads the page). Only far past this many loaded
// tiles does the layer start over from the current view.
const MAX_TILES = 600;
// A tile stays resident while within this many view radii of the view centre.
const KEEP_MARGIN = 1.6;

function aimCuller(culler, camera, radius) {
  culler.copy(camera, false);
  const distance = camera.position.length(); // the camera always looks at the globe's centre
  culler.far = Math.max(culler.near * 2, distance - (radius * radius) / distance + radius * 0.02);
  const core = (2 * Math.asin(Math.min(1, (CORE_DISC * radius) / distance)) * 180) / Math.PI;
  culler.fov = Math.min(camera.fov, core);
  culler.updateProjectionMatrix();
  culler.updateMatrixWorld(true);
}

// Central angle (radians) from the view centre to the corner of the view, or to the horizon if nearer.
function viewReach(camera, radius) {
  const d = camera.position.length() / radius;
  const horizon = Math.acos(Math.min(1, 1 / d));
  const tanHalf = Math.tan(((camera.fov || 50) * Math.PI) / 360);
  const corner = Math.atan(tanHalf * Math.sqrt(1 + (camera.aspect || 1) ** 2));
  const hit = d * Math.sin(corner);
  return hit >= 1 ? horizon : Math.min(horizon, Math.asin(hit) - corner);
}

// The engine drops tiles when the level falls or the cache is cleared, but only empties their children;
// free the tile's own geometry, texture and material so close-ups do not pile up GPU memory.
function disposeTile(object) {
  const material = object?.material;
  if (!material?.userData?.globeTile) return;
  object.geometry?.dispose();
  material.map?.dispose();
  material.dispose();
}

/**
 * Adds the tile shell to `scene` and returns a controller, or null without a scene.
 * Call `sync()` whenever the camera moves; it reports whether tiles are on and how close the camera may go.
 */
export function createGlobeTileLayer({ scene, renderer, baseTextureWidth, tileUrl = tilePath } = {}) {
  if (!scene || typeof scene.add !== "function") return null;

  const baseZoom = textureZoom(baseTextureWidth);
  const minLevel = minTileZoom(baseZoom);
  let shownLevel = null;
  const engine = new SlippyMapGlobe(GLOBE_RADIUS, {
    minLevel,
    maxLevel: GLOBE_TILE_MAX_ZOOM,
    mercatorProjection: true,
  });
  // 1° facets keep every tile above the base globe's 4° facets.
  engine.curvatureResolution = 1;
  engine.visible = false;

  const anisotropy = Math.max(1, Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1));
  // The zoom limit only relaxes once a tile has actually arrived, so a dead proxy keeps today's limit.
  let tileArrived = false;
  const shared = baseUniforms();
  const add = engine.add.bind(engine);
  engine.add = (...objects) => {
    objects.forEach((object) => {
      prepareTile(object, anisotropy, shared, baseZoom);
      if (object?.material?.userData?.globeTile) tileArrived = true;
    });
    return add(...objects);
  };
  const remove = engine.remove.bind(engine);
  engine.remove = (...objects) => {
    const result = remove(...objects);
    objects.forEach(disposeTile);
    return result;
  };
  scene.add(engine);

  // active: tiles are wanted at this distance; minAltitude: how close the camera may go.
  const state = { active: false, minAltitude: DEFAULT_MIN_ALTITUDE };
  // The engine only knows the view frustum; it picks tiles through this stand-in camera (see aimCuller).
  const culler = new PerspectiveCamera();
  let lastAltitude = 0;
  const camDir = culler.position.clone();

  // Hide tiles beyond the view (and free their GPU textures); bring back the ones that return.
  const trimToView = (camera) => {
    camDir.copy(camera.position).normalize();
    const keep = viewReach(camera, GLOBE_RADIUS) * KEEP_MARGIN;
    let loaded = 0;
    engine.children.forEach((tile) => {
      const dir = tile.userData?.globeTileDir;
      if (!dir) return;
      loaded += 1;
      const near = Math.acos(Math.max(-1, Math.min(1, dir.dot(camDir)))) - tile.userData.globeTileReach <= keep;
      if (near && !tile.visible) tile.visible = true;
      if (!near && tile.visible) {
        tile.visible = false;
        tile.material.map?.dispose();
        tile.geometry?.dispose();
      }
    });
    return loaded;
  };

  const setActive = (active) => {
    if (active === state.active) return;
    state.active = active;
    if (active) {
      engine.visible = true;
      engine.tileUrl = tileUrl;
    } else {
      engine.tileUrl = undefined;
      shownLevel = null;
      engine.clearTiles();
      engine.visible = false;
    }
  };

  return {
    sync({ camera, altitude, latitude = 0, viewportHeight, baseTexture = null }) {
      if (baseTexture !== shared.uBaseMap.value) {
        shared.uBaseMap.value = baseTexture || null;
        shared.uBaseReady.value = baseTexture?.image ? 1 : 0;
      }
      const scale = tileScale(viewportHeight, camera?.fov);
      if (!camera || !(scale > 0) || !(altitude > 0)) return { ...state };

      // Mid-zoom the level is about to change again; wait for the camera to settle rather than
      // download every level it passes through.
      const zooming = lastAltitude > 0 && Math.abs(Math.log(altitude / lastAltitude)) > ZOOM_SETTLE;
      lastAltitude = altitude;

      if (!tilesWanted({ scale, altitude, baseZoom, active: state.active })) {
        setActive(false);
      } else if (!zooming) {
        // Thresholds and culler first: switching the layer on fetches straight away.
        const level = pickTileLevel({ scale, altitude, latitude, current: shownLevel, minLevel, maxLevel: GLOBE_TILE_MAX_ZOOM });
        shownLevel = level;
        // Pin the engine to that level (it clamps its own threshold pick to [minLevel, maxLevel]).
        engine.minLevel = level;
        engine.maxLevel = level;
        engine.scale.setScalar(tileShellScale(altitude));
        engine.updateMatrixWorld(true);
        aimCuller(culler, camera, GLOBE_RADIUS);
        setActive(true);
        engine.updatePov(culler);
        if (trimToView(camera) > MAX_TILES) {
          engine.clearTiles();
          engine.updatePov(culler);
        }
      }
      state.minAltitude = tileArrived ? minSharpAltitude(scale) : DEFAULT_MIN_ALTITUDE;
      return { ...state };
    },

    dispose() {
      setActive(false);
      scene.remove(engine);
      engine.traverse((object) => {
        object.geometry?.dispose?.();
        object.material?.dispose?.();
      });
    },
  };
}

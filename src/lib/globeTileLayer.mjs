// Sharp imagery for close-ups on the visitor globe. A three-slippy-map-globe shell floats just above
// RotatingGlobe's base texture and only switches on once the camera is close enough for that texture to
// look soft; the level math lives in globeTiles.mjs. Client-only: RotatingGlobe is loaded with ssr: false.
import { PerspectiveCamera } from "three";
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
  tilesWanted,
  zoomThresholds,
} from "./globeTiles.mjs";

// three-globe's globe radius, in scene units.
const GLOBE_RADIUS = 100;

// The base texture (/textures/earth_day_*.jpg) is brighter and more saturated than raw Blue Marble and has
// a flat ocean. Land samples from six continents fit base ≈ tile^0.58 with a quarter more saturation, and
// open water (blue clearly above red and green) takes the texture's ocean colour, #1e3b75, so tiles sharpen
// the globe without changing its look. The shader works in linear colour, where the same exponent holds.
const TILE_GRADE = `#include <map_fragment>
{
  vec3 texel = max(diffuseColor.rgb, vec3(0.0));
  float water = smoothstep(1.25, 1.8, texel.b / (max(texel.r, texel.g) + 0.002));
  vec3 land = pow(texel, vec3(0.58));
  land = max(mix(vec3(dot(land, vec3(0.2126, 0.7152, 0.0722))), land, 1.25), 0.0);
  diffuseColor.rgb = mix(land, vec3(0.0130, 0.0437, 0.1778), water);
}`;

function gradeTile(object, anisotropy) {
  const material = object?.material;
  if (!material?.map || material.userData.globeTile) return;
  material.userData.globeTile = true;
  material.map.anisotropy = anisotropy;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", TILE_GRADE);
  };
  material.customProgramCacheKey = () => "globe-tile-grade-v1";
  material.needsUpdate = true;
}

// The engine fetches every tile with a corner in the view frustum, which also takes in the far side of
// the globe and, while the whole globe is on screen, a limb so foreshortened that the base texture serves
// it fine. The culler is the real camera with its far plane on the horizon (nothing behind the globe) and,
// until the globe fills the view, its field narrowed to the inner 80% of the disc.
const CORE_DISC = 0.8;
// A camera that moved more than 1.5% in altitude since the last sync is still zooming.
const ZOOM_SETTLE = 0.015;
// Coarser levels stay loaded under the current one as a fallback. Past this many tiles (~40 MB of
// textures) the layer starts again from the current view, which reloads from the browser cache.
const MAX_TILES = 120;

function aimCuller(culler, camera, radius) {
  culler.copy(camera, false);
  const distance = camera.position.length(); // the camera always looks at the globe's centre
  culler.far = Math.max(culler.near * 2, distance - (radius * radius) / distance + radius * 0.02);
  const core = (2 * Math.asin(Math.min(1, (CORE_DISC * radius) / distance)) * 180) / Math.PI;
  culler.fov = Math.min(camera.fov, core);
  culler.updateProjectionMatrix();
  culler.updateMatrixWorld(true);
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
  const engine = new SlippyMapGlobe(GLOBE_RADIUS, {
    minLevel: minTileZoom(baseZoom),
    maxLevel: GLOBE_TILE_MAX_ZOOM,
    mercatorProjection: true,
  });
  // 1° facets keep every tile above the base globe's 4° facets.
  engine.curvatureResolution = 1;
  engine.visible = false;

  const anisotropy = Math.max(1, Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1));
  // The zoom limit only relaxes once a tile has actually arrived, so a dead proxy keeps today's limit.
  let tileArrived = false;
  const add = engine.add.bind(engine);
  engine.add = (...objects) => {
    objects.forEach((object) => {
      gradeTile(object, anisotropy);
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

  const setActive = (active) => {
    if (active === state.active) return;
    state.active = active;
    if (active) {
      engine.visible = true;
      engine.tileUrl = tileUrl;
    } else {
      engine.tileUrl = undefined;
      engine.clearTiles();
      engine.visible = false;
    }
  };

  return {
    sync({ camera, altitude, latitude = 0, viewportHeight }) {
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
        engine.thresholds = zoomThresholds(scale, latitude);
        engine.scale.setScalar(tileShellScale(altitude));
        engine.updateMatrixWorld(true);
        aimCuller(culler, camera, GLOBE_RADIUS);
        setActive(true);
        engine.updatePov(culler);
        // Every child but the engine's own backing sphere is a loaded tile.
        if (engine.children.length - 1 > MAX_TILES) {
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

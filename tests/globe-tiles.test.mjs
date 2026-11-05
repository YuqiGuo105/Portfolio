import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PerspectiveCamera, Scene, ShaderLib, Texture } from 'three';
import * as tiles from '../src/lib/globeTiles.mjs';
import { createGlobeTileLayer } from '../src/lib/globeTileLayer.mjs';

const {
  DEFAULT_MIN_ALTITUDE, GLOBE_HD_CREDIT, GLOBE_HD_MAX_ZOOM, GLOBE_TILE_MAX_ZOOM, MIN_CAMERA_ALTITUDE, colourMatchLevel,
  colourMatchWeight, globeTileUrl, hdTileUrl, idealZoom, isHdLevel, minSharpAltitude, minTileZoom, parseTileRequest,
  pickTileLevel, textureZoom, tilePath, tileScale, tileShellScale, tilesWanted, upstreamTileUrl, zoomThresholds,
} = tiles;

// The dashboard globe on a phone: 420 CSS px tall, drawn at the renderer's 2x pixel-ratio cap.
const PHONE = tileScale(840, 50);
const BEIJING = { lat: 39.9, lng: 116.4 };

// three-slippy-map-globe's rule: level = first threshold at or below the camera altitude, clamped.
const engineLevel = (thresholds, altitude, min = 0, max = GLOBE_TILE_MAX_ZOOM) => {
  const index = thresholds.findIndex((t) => t && t <= altitude);
  return Math.min(max, Math.max(min, index < 0 ? thresholds.length : index));
};
// Texels per screen pixel at the centre of the view.
const texelRatio = (level, altitude, scale, latitude) => (2 ** level * altitude) / (scale * Math.cos((latitude * Math.PI) / 180));
const tileOf = ({ lat, lng }, z) => {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return { x: Math.floor(((lng + 180) / 360) * n), y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n) };
};

test('each level keeps texels between 0.7 and 1.4 screen pixels', () => {
  for (const latitude of [0, 30, 55]) {
    const thresholds = zoomThresholds(PHONE, latitude);
    for (let altitude = 2; altitude > 0.03; altitude *= 0.93) {
      const level = engineLevel(thresholds, altitude);
      const ideal = idealZoom(PHONE, altitude, latitude);
      if (ideal < 0.5 || ideal >= GLOBE_TILE_MAX_ZOOM + 0.5) continue; // clamped at either end
      assert.equal(level, Math.round(ideal), `level at altitude ${altitude.toFixed(3)}, latitude ${latitude}`);
      const ratio = texelRatio(level, altitude, PHONE, latitude);
      assert.ok(ratio > 0.707 && ratio < 1.415, `ratio ${ratio} at altitude ${altitude}`);
    }
  }
});

test('tiles switch on once the base texture looks soft, and off again with some slack', () => {
  assert.equal(textureZoom(2048), 3);
  assert.equal(textureZoom(4096), 4);
  assert.equal(minTileZoom(3), 4);
  assert.equal(minTileZoom(4), 5);

  const at = (stretch) => PHONE / 2 ** (3 + stretch); // altitude where the 2K texture is stretched 2^stretch
  // On once a base texel covers about 1.7 screen pixels, off again below 1.4.
  assert.equal(tilesWanted({ scale: PHONE, altitude: at(0.7), baseZoom: 3 }), false);
  assert.equal(tilesWanted({ scale: PHONE, altitude: at(0.8), baseZoom: 3 }), true);
  assert.equal(tilesWanted({ scale: PHONE, altitude: at(0.6), baseZoom: 3, active: true }), true);
  assert.equal(tilesWanted({ scale: PHONE, altitude: at(0.4), baseZoom: 3, active: true }), false);

  // On a phone the switch happens a little before the globe fills the frame, never at the default view (2.2).
  const switchOn = at(0.75);
  assert.ok(switchOn > 1.3 && switchOn < 2, `switch-on altitude ${switchOn}`);
  assert.equal(tilesWanted({ scale: PHONE, altitude: 2.2, baseZoom: 3 }), false);
});

test('the zoom limit keeps the deepest level sharp and never tightens the old limit', () => {
  const limit = minSharpAltitude(PHONE);
  assert.ok(limit > 0.05 && limit < 0.07, `phone limit ${limit}`);
  assert.ok(texelRatio(GLOBE_TILE_MAX_ZOOM, limit, PHONE, 0) >= 0.707 - 1e-9);
  assert.equal(minSharpAltitude(0), DEFAULT_MIN_ALTITUDE);
  assert.equal(minSharpAltitude(tileScale(20000, 50)), DEFAULT_MIN_ALTITUDE);
  assert.equal(minSharpAltitude(tileScale(10, 50)), MIN_CAMERA_ALTITUDE);

  // With EOxCloudless the phone may come down to about 12 km, still above globe.gl's camera near plane.
  const close = minSharpAltitude(PHONE, GLOBE_HD_MAX_ZOOM);
  assert.ok(close > 0.0015 && close < 0.0025, `phone close-up limit ${close}`);
  assert.ok(texelRatio(GLOBE_HD_MAX_ZOOM, close, PHONE, 0) >= 0.707 - 1e-9);
  assert.ok(MIN_CAMERA_ALTITUDE > 0.05 / 100);
});

test('the tile shell floats a hair above the globe, more so further out', () => {
  assert.equal(tileShellScale(0), 1.000005);
  assert.ok(tileShellScale(1) > tileShellScale(0.3));
  assert.ok(tileShellScale(2) < 1.002);
});

test('tile requests name real tiles and nothing else', () => {
  assert.deepEqual(parseTileRequest({ z: '8', x: '210', y: '97' }), { z: 8, x: 210, y: 97 });
  assert.deepEqual(parseTileRequest({ z: '0', x: '0', y: '0' }), { z: 0, x: 0, y: 0 });
  for (const query of [
    { z: '9', x: '1', y: '1' },
    { z: '4', x: '16', y: '0' },
    { z: '4', x: '0', y: '16' },
    { z: '4', x: '01', y: '2' },
    { z: '4', x: '-1', y: '2' },
    { z: '4', x: '1.5', y: '2' },
    { z: '4', x: '1', y: '2.jpg' },
    { z: ['4', '5'], x: '1', y: '2' },
    { z: '4', x: '1' },
    {},
  ]) {
    assert.equal(parseTileRequest(query), null, JSON.stringify(query));
  }
  assert.equal(parseTileRequest(), null);
  assert.equal(tilePath(210, 97, 8), '/api/map-tiles/8/210/97');
});

test('upstream URLs use the WMTS row/column order and accept only a well-formed override', () => {
  assert.equal(
    upstreamTileUrl({ z: 8, x: 210, y: 97 }),
    'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/8/97/210.jpeg',
  );
  assert.equal(upstreamTileUrl({ z: 2, x: 1, y: 3 }, 'http://127.0.0.1:9/{z}/{x}/{y}.png'), 'http://127.0.0.1:9/2/1/3.png');
  for (const bad of ['', 'ftp://tiles/{z}/{x}/{y}', 'https://tiles.example/{z}/{x}', 'javascript:{z}{x}{y}']) {
    assert.match(upstreamTileUrl({ z: 1, x: 0, y: 1 }, bad), /^https:\/\/gibs\.earthdata\.nasa\.gov\/.+\/1\/1\/0\.jpeg$/);
  }
});

// three-globe's camera: on a radius-100 globe, looking at its centre from (lat, lng, altitude).
function cameraAt({ lat, lng }, altitude) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((90 - lng) * Math.PI) / 180;
  const r = 100 * (1 + altitude);
  const camera = new PerspectiveCamera(50, 686 / 840, 0.05, 125000);
  camera.position.set(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

test('the layer loads the tiles in view at the right level and cleans up after itself', () => {
  // three's TextureLoader asks the DOM for an <img>; record the requests and let the test decide when they arrive.
  const requests = [];
  globalThis.document = {
    createElementNS: () => {
      const listeners = {};
      const image = {
        addEventListener: (type, listener) => { listeners[type] = listener; },
        removeEventListener: () => {},
        set src(url) { requests.push({ url, arrive: () => listeners.load?.call(image) }); },
      };
      return image;
    },
  };

  const scene = new Scene();
  const layer = createGlobeTileLayer({ scene, renderer: { capabilities: { getMaxAnisotropy: () => 16 } }, baseTextureWidth: 2048 });
  const engine = scene.children[0];
  const sync = (altitude) => layer.sync({ camera: cameraAt(BEIJING, altitude), altitude, latitude: BEIJING.lat, viewportHeight: 840 });
  const parse = (url) => {
    const match = url.match(/^\/api\/map-tiles\/(\d+)\/(\d+)\/(\d+)$/);
    assert.ok(match, url);
    return { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
  };

  assert.deepEqual(sync(2.2), { active: false, minAltitude: DEFAULT_MIN_ALTITUDE, credit: false });
  assert.equal(requests.length, 0);

  // Mid-zoom nothing is fetched; once the camera holds still the layer switches on.
  const altitude = 0.3;
  assert.equal(sync(altitude).active, false, 'still zooming');
  assert.equal(requests.length, 0);
  assert.equal(sync(altitude).active, true, 'settled');
  const level = engineLevel(zoomThresholds(PHONE, BEIJING.lat), altitude, 4);
  const requested = requests.map(({ url }) => parse(url));
  // The view and the prefetch band around it.
  assert.ok(requested.length >= 4 && requested.length <= 80, `${requested.length} tiles`);
  assert.ok(requested.every((t) => t.z === level), `all at level ${level}`);
  const home = tileOf(BEIJING, level);
  assert.ok(requested.some((t) => t.x === home.x && t.y === home.y), 'the tile under the camera');
  assert.ok(requested.every((t) => Math.abs(t.x - home.x) <= 6 && Math.abs(t.y - home.y) <= 6), 'only tiles around the view');

  // Before any tile arrives the old zoom limit holds; afterwards the deepest sharp level sets it.
  assert.deepEqual(sync(altitude), { active: true, minAltitude: DEFAULT_MIN_ALTITUDE, credit: false });
  requests.forEach((request) => request.arrive());
  const shown = engine.children.filter((child) => child.material?.userData?.globeTile);
  assert.equal(shown.length, requested.length);
  assert.ok(shown.every((tile) => tile.material.type === 'MeshPhongMaterial' && tile.material.map.anisotropy === 8
    && tile.material.customProgramCacheKey() === 'globe-tile-grade-v3' && tile.renderOrder === 1 + level));
  assert.deepEqual(sync(altitude), { active: true, minAltitude: minSharpAltitude(PHONE), credit: false });

  // Tiles render like the base globe (Phong) and take their colours from the base texture: the shader
  // replaces three's texture sample with graded fine detail rescaled to the base texture's low frequencies.
  const base = new Texture({ width: 2048, height: 1024 });
  sync(altitude);
  layer.sync({ camera: cameraAt(BEIJING, altitude), altitude, latitude: BEIJING.lat, viewportHeight: 840, baseTexture: base });
  const shader = { uniforms: {}, vertexShader: ShaderLib.phong.vertexShader, fragmentShader: ShaderLib.phong.fragmentShader };
  shown[0].material.onBeforeCompile(shader);
  assert.equal(shader.fragmentShader.includes('#include <map_fragment>'), false);
  assert.match(shader.fragmentShader, /pow\(texel, vec3\(0\.58\)\)/);
  assert.match(shader.fragmentShader, /textureLod\(uBaseMap, baseUv, 0\.0\)/);
  assert.match(shader.vertexShader, /vGlobePos = position;/);
  assert.equal(shader.uniforms.uBaseMap.value, base);
  assert.equal(shader.uniforms.uBaseReady.value, 1);
  assert.equal(shader.uniforms.uLowBias.value, level - 3);
  assert.equal(shader.uniforms.uHd.value, 0, 'Blue Marble grading');
  assert.equal(shader.uniforms.uMatch.value, 1, 'fully matched to the base texture');

  // Zooming back out drops the tiles and frees their GPU resources.
  let disposed = 0;
  shown.forEach((tile) => tile.material.addEventListener('dispose', () => { disposed += 1; }));
  assert.equal(sync(2.2).active, false);
  assert.equal(disposed, shown.length);
  assert.equal(engine.visible, false);
  assert.equal(engine.children.filter((child) => child.material?.userData?.globeTile).length, 0);

  // Wide views fetch the face of the globe and a band around the view: dozens of tiles, none behind the horizon.
  requests.length = 0;
  for (const a of [1.1, 1.1]) sync(a);
  const wide = requests.map(({ url }) => parse(url));
  assert.ok(wide.length > 4 && wide.length <= 80, `${wide.length} tiles at altitude 1.1`);
  // Angle from the view centre to the nearest corner or the centre of a tile.
  const rad = Math.PI / 180;
  const angle = (lat, lng) => Math.acos(Math.min(1, Math.sin(lat * rad) * Math.sin(BEIJING.lat * rad)
    + Math.cos(lat * rad) * Math.cos(BEIJING.lat * rad) * Math.cos((lng - BEIJING.lng) * rad))) / rad;
  const tileLat = (y, n) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / rad;
  const nearest = ({ z, x, y }) => {
    const n = 2 ** z;
    const lngs = [x, x + 0.5, x + 1].map((v) => (v / n) * 360 - 180);
    const lats = [y, y + 0.5, y + 1].map((v) => tileLat(v, n));
    return Math.min(...lats.flatMap((lat) => lngs.map((lng) => angle(lat, lng))));
  };
  const horizon = Math.acos(1 / 2.1) / rad;
  const furthest = Math.max(...wide.map(nearest));
  assert.ok(furthest < horizon, `a tile ${furthest.toFixed(1)}° out lies past the horizon (${horizon.toFixed(1)}°)`);

  layer.dispose();
  assert.equal(scene.children.includes(engine), false);
  delete globalThis.document;
});

test('tiles that turn out of view give their GPU memory back and return without reloading', () => {
  const pending = [];
  let requested = 0;
  globalThis.document = {
    createElementNS: () => {
      const listeners = {};
      const image = {
        addEventListener: (type, listener) => { listeners[type] = listener; },
        removeEventListener: () => {},
        set src(url) { requested += 1; pending.push(() => listeners.load?.call(image)); },
      };
      return image;
    },
  };
  const scene = new Scene();
  const layer = createGlobeTileLayer({ scene, renderer: null, baseTextureWidth: 2048 });
  const engine = scene.children[0];
  const tiles = () => engine.children.filter((child) => child.material?.userData?.globeTile);
  const sync = (lng) => {
    layer.sync({ camera: cameraAt({ lat: 40, lng }, 0.3), altitude: 0.3, latitude: 40, viewportHeight: 840 });
    pending.splice(0).forEach((arrive) => arrive());
  };
  let freed = 0;
  let mostVisible = 0;
  const watched = new Set();
  // Auto-rotation along the 40th parallel at a close-up altitude, once round the visible half and back.
  const path = [];
  for (let lng = 60; lng <= 200; lng += 2) path.push(lng);
  for (let lng = 200; lng >= 60; lng -= 2) path.push(lng);
  let restarts = 0;
  for (const lng of path) {
    const before = tiles().length;
    sync(lng);
    if (tiles().length < before) restarts += 1;
    tiles().forEach((tile) => {
      if (watched.has(tile)) return;
      watched.add(tile);
      tile.material.map.addEventListener('dispose', () => { freed += 1; });
    });
    mostVisible = Math.max(mostVisible, tiles().filter((tile) => tile.visible).length);
  }
  assert.equal(restarts, 0, 'no flash: the layer never starts over');
  assert.ok(freed > 50, `${freed} textures freed`);
  assert.ok(mostVisible <= 80, `at most ${mostVisible} tiles resident`);
  const fetchedOnce = requested;
  sync(60);
  assert.equal(requested, fetchedOnce, 'returning tiles come back from memory, not the network');
  assert.ok(tiles().some((tile) => tile.visible));
  layer.dispose();
  delete globalThis.document;
});

test('the shown level is a little finer than the screen and only changes once the target is clearly elsewhere', () => {
  const at = (zoom, latitude = 0) => (PHONE * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom; // altitude where ideal = zoom
  assert.equal(pickTileLevel({ scale: PHONE, altitude: at(6.1), minLevel: 4 }), 6);
  assert.equal(pickTileLevel({ scale: PHONE, altitude: at(6.4), minLevel: 4 }), 7, 'rounds up early');
  assert.equal(pickTileLevel({ scale: PHONE, altitude: at(6.2), current: 6, minLevel: 4 }), 6, 'stays');
  assert.equal(pickTileLevel({ scale: PHONE, altitude: at(5.1), current: 6, minLevel: 4 }), 6, 'stays');
  assert.equal(pickTileLevel({ scale: PHONE, altitude: at(6.3), current: 6, minLevel: 4 }), 7, 'moves up');
  assert.equal(pickTileLevel({ scale: PHONE, altitude: at(5.0), current: 6, minLevel: 4 }), 5, 'moves down');
  assert.equal(pickTileLevel({ scale: PHONE, altitude: at(9.5), current: 8, minLevel: 4 }), 8);
});

test('zooming in and out never leaves a texel bigger than 1.2 screen pixels', () => {
  for (const latitude of [0, 37, 60]) {
    let current = null;
    const altitudes = [];
    for (let altitude = 2; altitude > 0.05; altitude *= 0.97) altitudes.push(altitude);
    for (const altitude of [...altitudes, ...altitudes.slice().reverse(), ...altitudes]) {
      current = pickTileLevel({ scale: PHONE, altitude, latitude, current, minLevel: 0 });
      const ideal = idealZoom(PHONE, altitude, latitude);
      if (ideal > GLOBE_TILE_MAX_ZOOM) continue; // clamped at the deepest level
      const texelPixels = 2 ** (ideal - current);
      assert.ok(texelPixels <= 1.2, `${texelPixels.toFixed(2)} px at altitude ${altitude.toFixed(3)}, latitude ${latitude}`);
      assert.ok(texelPixels >= 0.5, `${texelPixels.toFixed(2)} px is needlessly fine`);
    }
  }
});

test('panning north and south at a fixed zoom never throws tiles away', () => {
  const pending = [];
  globalThis.document = {
    createElementNS: () => {
      const listeners = {};
      const image = { addEventListener: (t, l) => { listeners[t] = l; }, removeEventListener: () => {}, set src(u) { pending.push(() => listeners.load?.call(image)); } };
      return image;
    },
  };
  const scene = new Scene();
  const layer = createGlobeTileLayer({ scene, renderer: null, baseTextureWidth: 2048 });
  const engine = scene.children[0];
  let removed = 0;
  const remove = engine.remove;
  engine.remove = (...objects) => { removed += objects.filter((o) => o.material?.userData?.globeTile).length; return remove(...objects); };
  // An altitude where the ideal level crosses a boundary between 30°N and 45°N.
  const altitude = (PHONE * Math.cos((37.5 * Math.PI) / 180)) / 2 ** 6.5;
  for (const lat of [30, 33, 36, 39, 42, 45, 42, 39, 36, 33, 30, 33, 36, 39, 42, 45]) {
    layer.sync({ camera: cameraAt({ lat, lng: 116 }, altitude), altitude, latitude: lat, viewportHeight: 840 });
    pending.splice(0).forEach((arrive) => arrive());
  }
  assert.equal(removed, 0);
  layer.dispose();
  delete globalThis.document;
});

test('levels past Blue Marble come straight from EOxCloudless, in WMTS row/column order', () => {
  assert.equal(globeTileUrl(210, 97, 8), '/api/map-tiles/8/210/97');
  assert.equal(globeTileUrl(1683, 775, 11), 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/11/775/1683.jpg');
  assert.equal(hdTileUrl(0, 0, 0), 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/0/0/0.jpg');
  assert.equal(isHdLevel(GLOBE_TILE_MAX_ZOOM), false);
  assert.equal(isHdLevel(GLOBE_TILE_MAX_ZOOM + 1), true);
  assert.equal(GLOBE_HD_MAX_ZOOM, 13);
  assert.equal(colourMatchLevel(3), 11);
  assert.equal(colourMatchLevel(4), 12);
  assert.equal(GLOBE_HD_CREDIT.note, 'Contains modified Copernicus Sentinel data 2016');
  assert.equal(GLOBE_HD_CREDIT.license, 'CC BY 4.0');
  assert.match(GLOBE_HD_CREDIT.href, /^https:\/\/cloudless\.eox\.at$/);
});

// Records three's image requests (TextureLoader asks the DOM for an <img>) and lets the test deliver them.
function fakeImages() {
  const requests = [];
  globalThis.document = {
    createElementNS: () => {
      const listeners = {};
      const image = {
        addEventListener: (type, listener) => { listeners[type] = listener; },
        removeEventListener: () => {},
        set src(url) { requests.push({ url, arrive: () => listeners.load?.call(image) }); },
      };
      return image;
    },
  };
  return requests;
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const eoxTile = (url) => {
  const match = url.match(/^https:\/\/tiles\.maps\.eox\.at\/wmts\/1\.0\.0\/s2cloudless_3857\/default\/GoogleMapsCompatible\/(\d+)\/(\d+)\/(\d+)\.jpg$/);
  return match ? { z: Number(match[1]), y: Number(match[2]), x: Number(match[3]) } : null;
};
// Altitude where the ideal level over Beijing is 12.9: level 13, just above the phone's close-up limit.
const CLOSE = (PHONE * Math.cos((BEIJING.lat * Math.PI) / 180)) / 2 ** 12.9;

test('EOxCloudless starts matched to the base texture and reaches its own colours step by step', () => {
  // 4K base texture: tiles stay a base texel or larger down to level 12, so the match can last until then.
  assert.deepEqual([8, 9, 10, 11, 12, 13].map((z) => colourMatchWeight(z, 4)), [1, 1, 0.75, 0.5, 0.25, 0]);
  // 2K: one level sooner. Wherever the weight is above 0, a tile's blurred copy can stand for a base texel.
  assert.deepEqual([9, 10, 11, 12, 13].map((z) => +colourMatchWeight(z, 3).toFixed(2)), [1, 0.67, 0.33, 0, 0]);
  for (const baseZoom of [3, 4]) {
    for (let z = 0; z <= GLOBE_HD_MAX_ZOOM; z += 1) {
      if (colourMatchWeight(z, baseZoom) > 0) assert.ok(z <= colourMatchLevel(baseZoom), `level ${z}, base ${baseZoom}`);
    }
  }
  // Blue Marble is always fully matched.
  for (let z = 0; z <= GLOBE_TILE_MAX_ZOOM; z += 1) assert.equal(colourMatchWeight(z, 3), 1);
});

test('close-ups past level 8 load EOxCloudless straight from EOX and show its credit', async () => {
  const requests = fakeImages();
  let probes = 0;
  const scene = new Scene();
  const layer = createGlobeTileLayer({
    scene, renderer: null, baseTextureWidth: 2048, probeHd: async () => { probes += 1; return true; },
  });
  const engine = scene.children[0];
  const sync = (altitude) => layer.sync({ camera: cameraAt(BEIJING, altitude), altitude, latitude: BEIJING.lat, viewportHeight: 840 });

  // EOX is only asked once tiles switch on, and only once.
  sync(2.2);
  await settle();
  assert.equal(probes, 0);
  sync(0.3);
  sync(0.3);
  sync(0.3);
  await settle();
  assert.equal(probes, 1);
  assert.equal(requests.some(({ url }) => eoxTile(url)), false, 'Blue Marble serves the wider views');

  sync(CLOSE); // still zooming
  const state = sync(CLOSE);
  assert.equal(state.credit, true);
  assert.equal(state.minAltitude, minSharpAltitude(PHONE, GLOBE_HD_MAX_ZOOM));
  const close = requests.filter(({ url }) => eoxTile(url));
  assert.deepEqual([...new Set(close.map(({ url }) => eoxTile(url).z))], [13]);
  const home = tileOf(BEIJING, 13);
  assert.ok(close.some(({ url }) => eoxTile(url).x === home.x && eoxTile(url).y === home.y), 'the tile under the camera');
  assert.ok(close.length >= 4 && close.length <= 60, `${close.length} tiles`);

  close.forEach((request) => request.arrive());
  const deep = engine.children.filter((child) => child.userData?.globeTileLevel === 13);
  assert.equal(deep.length, close.length);
  const uniforms = deep[0].userData.globeTileUniforms;
  assert.equal(uniforms.uHd.value, 1, 'EOxCloudless keeps its own grading');
  assert.equal(uniforms.uMatch.value, 0, 'its own colours this close');
  const shader = { uniforms: {}, vertexShader: ShaderLib.phong.vertexShader, fragmentShader: ShaderLib.phong.fragmentShader };
  deep[0].material.onBeforeCompile(shader);
  assert.match(shader.fragmentShader, /uniform float uMatch;/);
  assert.match(shader.fragmentShader, /pow\(clamp\(\(base \+ 0\.004\) \/ \(coarse \+ 0\.004\), vec3\(0\.33\), vec3\(3\.0\)\), vec3\(uMatch\)\)/);
  assert.equal(shader.uniforms.uMatch, uniforms.uMatch);

  // Back above level 8 the credit goes with the EOX tiles.
  sync(0.3);
  assert.equal(sync(0.3).credit, false);
  assert.equal(engine.children.filter((child) => child.userData?.globeTileLevel === 13).length, 0);
  layer.dispose();
  delete globalThis.document;
});

test('without EOX (blocked, rate-limited) the close-up stops at Blue Marble level 8', async () => {
  const requests = fakeImages();
  const scene = new Scene();
  const layer = createGlobeTileLayer({ scene, renderer: null, baseTextureWidth: 2048, probeHd: async () => false });
  const sync = (altitude) => layer.sync({ camera: cameraAt(BEIJING, altitude), altitude, latitude: BEIJING.lat, viewportHeight: 840 });
  sync(0.3);
  sync(0.3);
  await settle();
  sync(CLOSE);
  const state = sync(CLOSE);
  assert.equal(state.credit, false);
  assert.equal(requests.some(({ url }) => eoxTile(url)), false);
  const levels = requests.map(({ url }) => Number(url.split('/')[3]));
  assert.ok(levels.every((z) => z <= GLOBE_TILE_MAX_ZOOM), `levels ${[...new Set(levels)]}`);
  requests.forEach((request) => request.arrive());
  assert.equal(sync(CLOSE).minAltitude, minSharpAltitude(PHONE));
  layer.dispose();
  delete globalThis.document;
});

// The proxy route, compiled the way Next.js compiles it.
const require = createRequire(import.meta.url);
const { transform } = require('next/dist/build/swc');
const routeSource = readFileSync(new URL('../pages/api/map-tiles/[z]/[x]/[y].js', import.meta.url), 'utf8');
const { code: routeCode } = await transform(routeSource, {
  filename: '[y].js',
  jsc: { parser: { syntax: 'ecmascript' }, target: 'es2020' },
  module: { type: 'commonjs' },
});
const route = {};
new Function('require', 'exports', routeCode)(() => tiles, route);
const response = () => ({
  headers: {},
  setHeader(key, value) { this.headers[key] = value; },
  status(code) { this.statusCode = code; return this; },
  send(body) { this.body = body; return this; },
  end() { this.ended = true; return this; },
});

test('the proxy caches good tiles for a long time and never caches failures', async (t) => {
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  t.after(() => { globalThis.fetch = realFetch; console.warn = realWarn; delete process.env.MAP_TILE_UPSTREAM; });
  console.warn = () => {};
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const upstream = (...replies) => {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(url);
      const reply = replies[Math.min(calls.length, replies.length) - 1];
      if (reply instanceof Error) throw reply;
      return new Response(reply.body ?? jpeg, { status: reply.status ?? 200, headers: { 'content-type': reply.type ?? 'image/jpeg' } });
    };
    return calls;
  };
  const get = async (query, method = 'GET') => {
    const res = response();
    await route.default({ method, query }, res);
    return res;
  };

  let calls = upstream({});
  let res = await get({ z: '6', x: '52', y: '24' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, jpeg);
  assert.equal(res.headers['Content-Type'], 'image/jpeg');
  assert.equal(res.headers['Cache-Control'], 'public, max-age=2592000, s-maxage=31536000, immutable');
  assert.deepEqual(calls, [upstreamTileUrl({ z: 6, x: 52, y: 24 })]);

  calls = upstream({ status: 503 }, {});
  res = await get({ z: '6', x: '52', y: '24' });
  assert.equal(res.statusCode, 200, 'one retry after an upstream error');
  assert.equal(calls.length, 2);

  calls = upstream(new Error('timeout'), new Error('timeout'));
  res = await get({ z: '6', x: '52', y: '24' });
  assert.equal(res.statusCode, 502);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(calls.length, 2);

  calls = upstream({ status: 400, type: 'text/xml', body: '<ExceptionReport/>' });
  res = await get({ z: '6', x: '52', y: '24' });
  assert.equal(res.statusCode, 502);
  assert.equal(calls.length, 1, 'no retry after a client error');

  calls = upstream({ type: 'text/html', body: '<html>maintenance</html>' }, { type: 'text/html', body: '<html>maintenance</html>' });
  res = await get({ z: '6', x: '52', y: '24' });
  assert.equal(res.statusCode, 502, 'a page that is not an image is never passed on');
  assert.equal(res.headers['Cache-Control'], 'no-store');

  calls = upstream({});
  res = await get({ z: '9', x: '0', y: '0' });
  assert.equal(res.statusCode, 404);
  res = await get({ z: '6', x: '52', y: '24' }, 'POST');
  assert.equal(res.statusCode, 405);
  assert.equal(calls.length, 0);

  process.env.MAP_TILE_UPSTREAM = 'http://127.0.0.1:9/{z}/{y}/{x}.jpeg';
  calls = upstream({});
  res = await get({ z: '6', x: '52', y: '24' }, 'HEAD');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, undefined);
  assert.deepEqual(calls, ['http://127.0.0.1:9/6/24/52.jpeg']);
});

test('a pan finds the tiles it moves onto already requested, after the tiles in view', () => {
  let requests = [];
  globalThis.document = {
    createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(url) { requests.push(url); } }),
  };
  // A desktop-shaped view (2.4:1) at a regional close-up.
  const wideCamera = (lng, altitude) => {
    const camera = cameraAt({ lat: 40, lng }, altitude);
    camera.aspect = 2.4;
    camera.updateProjectionMatrix();
    return camera;
  };
  const load = (lng, altitude = 0.3) => {
    requests = [];
    const scene = new Scene();
    const layer = createGlobeTileLayer({ scene, renderer: null, baseTextureWidth: 2048 });
    const engine = scene.children[0];
    const passes = [];
    const update = engine.updatePov.bind(engine);
    engine.updatePov = (camera) => {
      const before = requests.length;
      update(camera);
      if (camera) passes.push(requests.slice(before));
    };
    layer.sync({ camera: wideCamera(lng, altitude), altitude, latitude: 40, viewportHeight: 840 });
    layer.dispose();
    return { view: passes[0], band: passes[1], all: new Set(requests) };
  };

  const here = load(100);
  assert.ok(here.view.length > 0 && here.band.length > 0, 'the view first, then the band around it');
  // The band is there whenever tiles are on, even one level past an 8K base texture.
  const near = (() => {
    requests = [];
    const scene = new Scene();
    const layer = createGlobeTileLayer({ scene, renderer: null, baseTextureWidth: 8192 });
    const engine = scene.children[0];
    let passes = 0;
    const update = engine.updatePov.bind(engine);
    engine.updatePov = (camera) => { update(camera); if (camera) passes += 1; };
    const altitude = PHONE / 2 ** 5.85;
    layer.sync({ camera: wideCamera(100, altitude), altitude, latitude: 0, viewportHeight: 840 });
    const result = { passes, levels: new Set(requests.map((url) => url.split('/')[3])) };
    layer.dispose();
    return result;
  })();
  assert.deepEqual([...near.levels], ['6']);
  assert.equal(near.passes, 2);
  assert.ok(here.band.every((url) => !here.view.includes(url)), 'each tile is requested once');
  for (const shift of [2, 3, 4, 5]) {
    const there = load(100 + shift);
    const missing = there.view.filter((url) => !here.all.has(url));
    assert.equal(missing.length, 0, `${missing.length} tiles in view after a ${shift}° pan were not requested yet`);
    assert.ok(there.view.some((url) => !here.view.includes(url)), `a ${shift}° pan reaches past the old view`);
  }
  delete globalThis.document;
});

test('a more detailed base texture moves the tiles one level finer and updates their colour match', () => {
  const requests = [];
  globalThis.document = {
    createElementNS: () => {
      const listeners = {};
      const image = {
        addEventListener: (type, listener) => { listeners[type] = listener; },
        removeEventListener: () => {},
        set src(url) { requests.push({ url, arrive: () => listeners.load?.call(image) }); },
      };
      return image;
    },
  };
  const scene = new Scene();
  const layer = createGlobeTileLayer({ scene, renderer: null, baseTextureWidth: 4096 });
  const engine = scene.children[0];
  const at = (stretch, baseZoom) => PHONE / 2 ** (baseZoom + stretch);
  const sync = (altitude) => layer.sync({ camera: cameraAt(BEIJING, altitude), altitude, latitude: 0, viewportHeight: 840 });
  const levels = () => new Set(requests.map(({ url }) => Number(url.split('/')[3])));

  // Stretched 1.7x over the 4K texture: tiles from level 5.
  sync(at(0.8, 4));
  assert.equal(sync(at(0.8, 4)).active, true);
  assert.deepEqual([...levels()], [5]);
  requests.forEach((request) => request.arrive());
  const tile = engine.children.find((child) => child.material?.userData?.globeTile);
  assert.equal(tile.userData.globeTileUniforms.uLowBias.value, 1);

  layer.setBaseTextureWidth(8192);
  assert.equal(tile.userData.globeTileUniforms.uLowBias.value, 0, 'matched against the finer texture');
  assert.equal(tile.userData.globeTileUniforms.uMatch.value, 1);
  // The 8K texture is sharp enough here: the tiles switch off.
  assert.equal(sync(at(0.8, 4)).active, false);
  // Further in they come back, from level 6.
  requests.length = 0;
  sync(at(0.9, 5));
  assert.equal(sync(at(0.9, 5)).active, true);
  assert.ok([...levels()].every((level) => level >= 6), `levels ${[...levels()]}`);
  layer.dispose();
  delete globalThis.document;
});

test('only capable high-DPI desktops download the 8K base texture', () => {
  const desktop = { maxTextureSize: 16384, devicePixelRatio: 2, viewportWidth: 1470, finePointer: true };
  assert.equal(tiles.wantsDetailedTexture(desktop), true);
  assert.equal(tiles.wantsDetailedTexture({ ...desktop, deviceMemory: 8 }), true);
  assert.equal(tiles.wantsDetailedTexture({ ...desktop, deviceMemory: 4 }), false, 'little memory');
  assert.equal(tiles.wantsDetailedTexture({ ...desktop, maxTextureSize: 4096 }), false, 'GPU cannot take it');
  assert.equal(tiles.wantsDetailedTexture({ ...desktop, finePointer: false }), false, 'phones and tablets');
  assert.equal(tiles.wantsDetailedTexture({ ...desktop, saveData: true }), false, 'data saver');
  assert.equal(tiles.wantsDetailedTexture({ ...desktop, effectiveType: '3g' }), false, 'slow connection');
  assert.equal(tiles.wantsDetailedTexture({ ...desktop, effectiveType: '4g' }), true);
  assert.equal(tiles.wantsDetailedTexture({ ...desktop, devicePixelRatio: 1, viewportWidth: 1920 }), false, 'a 1x screen does not need it');
  assert.equal(tiles.wantsDetailedTexture({ ...desktop, devicePixelRatio: 1.5, viewportWidth: 1920 }), true);
  assert.equal(tiles.wantsDetailedTexture(), false);
});

test('a tile image that fails to load is retried with a growing delay instead of staying blank', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [];
  globalThis.document = {
    createElementNS: () => {
      const listeners = {};
      const image = {
        addEventListener: (type, listener) => { listeners[type] = listener; },
        removeEventListener: () => {},
        set src(url) { requests.push({ url, arrive: () => listeners.load?.call(image), fail: () => listeners.error?.call(image, new Event('error')) }); },
      };
      return image;
    },
  };
  const scene = new Scene();
  const layer = createGlobeTileLayer({ scene, renderer: null, baseTextureWidth: 2048 });
  const engine = scene.children[0];
  const altitude = 0.3;
  const sync = () => layer.sync({ camera: cameraAt(BEIJING, altitude), altitude, latitude: BEIJING.lat, viewportHeight: 840 });
  sync();
  const first = requests[0].url;
  const count = (url) => requests.filter((request) => request.url === url).length;

  requests[0].fail();
  assert.equal(count(first), 1, 'no instant retry');
  t.mock.timers.tick(800);
  assert.equal(count(first), 2, 'retried after 0.8 s');
  requests.filter((request) => request.url === first).at(-1).arrive();
  assert.ok(engine.children.some((child) => child.material?.map?.image && child.material.userData.globeTile), 'the retried tile is shown');

  // A tile that keeps failing is given up after the last delay.
  const second = requests.find((request) => request.url !== first);
  second.fail();
  for (const delay of [800, 2500, 6000, 15000]) {
    t.mock.timers.tick(delay);
    requests.filter((request) => request.url === second.url).at(-1).fail();
  }
  t.mock.timers.tick(60000);
  assert.equal(count(second.url), 5, 'one load and four retries');
  layer.dispose();
  delete globalThis.document;
});

test('new tiles fade in over the imagery below them', async () => {
  const requests = [];
  globalThis.document = {
    createElementNS: () => {
      const listeners = {};
      const image = {
        addEventListener: (type, listener) => { listeners[type] = listener; },
        removeEventListener: () => {},
        set src(url) { requests.push(() => listeners.load?.call(image)); },
      };
      return image;
    },
  };
  const scene = new Scene();
  const layer = createGlobeTileLayer({ scene, renderer: null, baseTextureWidth: 2048 });
  const engine = scene.children[0];
  layer.sync({ camera: cameraAt(BEIJING, 0.3), altitude: 0.3, latitude: BEIJING.lat, viewportHeight: 840 });
  requests[0]();
  const tile = engine.children.find((child) => child.material?.userData?.globeTile);
  assert.equal(tile.material.transparent, true);
  assert.equal(tile.material.opacity, 0, 'invisible until its first frame');
  tile.onBeforeRender();
  await new Promise((resolve) => setTimeout(resolve, 120));
  tile.onBeforeRender();
  assert.ok(tile.material.opacity > 0 && tile.material.opacity < 1, `half-way at ${tile.material.opacity}`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  tile.onBeforeRender();
  assert.equal(tile.material.opacity, 1);
  layer.dispose();
  delete globalThis.document;
});

test('the base texture gets anisotropic filtering once, so the globe edge does not shimmer', () => {
  const scene = new Scene();
  const layer = createGlobeTileLayer({ scene, renderer: { capabilities: { getMaxAnisotropy: () => 16 } }, baseTextureWidth: 2048 });
  const base = new Texture({ width: 2048, height: 1024 });
  const version = base.version;
  layer.sync({ camera: cameraAt(BEIJING, 2.2), altitude: 2.2, latitude: BEIJING.lat, viewportHeight: 840, baseTexture: base });
  assert.equal(base.anisotropy, 8);
  assert.equal(base.version, version + 1, 'uploaded again with the new filtering');
  layer.sync({ camera: cameraAt(BEIJING, 2.2), altitude: 2.2, latitude: BEIJING.lat, viewportHeight: 840, baseTexture: base });
  assert.equal(base.version, version + 1, 'only once');
  layer.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PerspectiveCamera, Scene, ShaderLib, Texture } from 'three';
import * as tiles from '../src/lib/globeTiles.mjs';
import { createGlobeTileLayer } from '../src/lib/globeTileLayer.mjs';

const {
  DEFAULT_MIN_ALTITUDE, GLOBE_TILE_MAX_ZOOM, idealZoom, minSharpAltitude, minTileZoom, parseTileRequest, pickTileLevel,
  textureZoom, tilePath, tileScale, tileShellScale, tilesWanted, upstreamTileUrl, zoomThresholds,
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
  assert.equal(tilesWanted({ scale: PHONE, altitude: at(1.2), baseZoom: 3 }), false);
  assert.equal(tilesWanted({ scale: PHONE, altitude: at(1.3), baseZoom: 3 }), true);
  assert.equal(tilesWanted({ scale: PHONE, altitude: at(1.1), baseZoom: 3, active: true }), true);
  assert.equal(tilesWanted({ scale: PHONE, altitude: at(0.9), baseZoom: 3, active: true }), false);

  // On a phone the switch happens about where the globe fills the frame, never at the default view (2.2).
  const switchOn = at(1.25);
  assert.ok(switchOn > 1 && switchOn < 1.3, `switch-on altitude ${switchOn}`);
  assert.equal(tilesWanted({ scale: PHONE, altitude: 2.2, baseZoom: 3 }), false);
});

test('the zoom limit keeps the deepest level sharp and never tightens the old limit', () => {
  const limit = minSharpAltitude(PHONE);
  assert.ok(limit > 0.05 && limit < 0.07, `phone limit ${limit}`);
  assert.ok(texelRatio(GLOBE_TILE_MAX_ZOOM, limit, PHONE, 0) >= 0.707 - 1e-9);
  assert.equal(minSharpAltitude(0), DEFAULT_MIN_ALTITUDE);
  assert.equal(minSharpAltitude(tileScale(20000, 50)), DEFAULT_MIN_ALTITUDE);
  assert.equal(minSharpAltitude(tileScale(100, 50)), 0.04);
});

test('the tile shell floats a hair above the globe, more so further out', () => {
  assert.equal(tileShellScale(0), 1.0001);
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

  assert.deepEqual(sync(2.2), { active: false, minAltitude: DEFAULT_MIN_ALTITUDE });
  assert.equal(requests.length, 0);

  // Mid-zoom nothing is fetched; once the camera holds still the layer switches on.
  const altitude = 0.3;
  assert.equal(sync(altitude).active, false, 'still zooming');
  assert.equal(requests.length, 0);
  assert.equal(sync(altitude).active, true, 'settled');
  const level = engineLevel(zoomThresholds(PHONE, BEIJING.lat), altitude, 4);
  const requested = requests.map(({ url }) => parse(url));
  assert.ok(requested.length >= 4 && requested.length <= 40, `${requested.length} tiles`);
  assert.ok(requested.every((t) => t.z === level), `all at level ${level}`);
  const home = tileOf(BEIJING, level);
  assert.ok(requested.some((t) => t.x === home.x && t.y === home.y), 'the tile under the camera');
  assert.ok(requested.every((t) => Math.abs(t.x - home.x) <= 4 && Math.abs(t.y - home.y) <= 4), 'only tiles around the view');

  // Before any tile arrives the old zoom limit holds; afterwards the deepest sharp level sets it.
  assert.deepEqual(sync(altitude), { active: true, minAltitude: DEFAULT_MIN_ALTITUDE });
  requests.forEach((request) => request.arrive());
  const shown = engine.children.filter((child) => child.material?.userData?.globeTile);
  assert.equal(shown.length, requested.length);
  assert.ok(shown.every((tile) => tile.material.type === 'MeshPhongMaterial' && tile.material.map.anisotropy === 8
    && tile.material.customProgramCacheKey() === 'globe-tile-grade-v2' && tile.renderOrder === 1 + level));
  assert.deepEqual(sync(altitude), { active: true, minAltitude: minSharpAltitude(PHONE) });

  // Tiles render like the base globe (Phong) and take their colours from the base texture: the shader
  // replaces three's texture sample with graded fine detail rescaled to the base texture's low frequencies.
  const base = new Texture({ width: 2048, height: 1024 });
  sync(altitude);
  layer.sync({ camera: cameraAt(BEIJING, altitude), altitude, latitude: BEIJING.lat, viewportHeight: 840, baseTexture: base });
  const shader = { uniforms: {}, vertexShader: ShaderLib.phong.vertexShader, fragmentShader: ShaderLib.phong.fragmentShader };
  shown[0].material.onBeforeCompile(shader);
  assert.equal(shader.fragmentShader.includes('#include <map_fragment>'), false);
  assert.match(shader.fragmentShader, /pow\(texel, vec3\(0\.58\)\)/);
  assert.match(shader.fragmentShader, /texture2D\(uBaseMap, baseUv\)/);
  assert.match(shader.vertexShader, /vGlobePos = position;/);
  assert.equal(shader.uniforms.uBaseMap.value, base);
  assert.equal(shader.uniforms.uBaseReady.value, 1);
  assert.equal(shader.uniforms.uLowBias.value, level - 3);

  // Zooming back out drops the tiles and frees their GPU resources.
  let disposed = 0;
  shown.forEach((tile) => tile.material.addEventListener('dispose', () => { disposed += 1; }));
  assert.equal(sync(2.2).active, false);
  assert.equal(disposed, shown.length);
  assert.equal(engine.visible, false);
  assert.equal(engine.children.filter((child) => child.material?.userData?.globeTile).length, 0);

  // Wide views fetch the face of the globe only: a few dozen tiles, none of them behind the horizon.
  requests.length = 0;
  for (const a of [1.1, 1.1]) sync(a);
  const wide = requests.map(({ url }) => parse(url));
  assert.ok(wide.length > 4 && wide.length <= 40, `${wide.length} tiles at altitude 1.1`);
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

test('the shown level only changes once the ideal level is clearly elsewhere', () => {
  const at = (zoom, latitude = 0) => (PHONE * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom; // altitude where ideal = zoom
  assert.equal(pickTileLevel({ scale: PHONE, altitude: at(6.4), minLevel: 4 }), 6);
  assert.equal(pickTileLevel({ scale: PHONE, altitude: at(6.6), current: 6, minLevel: 4 }), 6, 'stays');
  assert.equal(pickTileLevel({ scale: PHONE, altitude: at(5.4), current: 6, minLevel: 4 }), 6, 'stays');
  assert.equal(pickTileLevel({ scale: PHONE, altitude: at(6.8), current: 6, minLevel: 4 }), 7, 'moves up');
  assert.equal(pickTileLevel({ scale: PHONE, altitude: at(5.2), current: 6, minLevel: 4 }), 5, 'moves down');
  assert.equal(pickTileLevel({ scale: PHONE, altitude: at(9.5), current: 8, minLevel: 4 }), 8);
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

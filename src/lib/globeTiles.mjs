// Sharp close-ups on the visitor globe: when imagery tiles replace the stretched base texture, which level the
// camera needs, and how close it may zoom. Pure math shared by src/lib/globeTileLayer.mjs (the WebGL layer),
// pages/api/map-tiles/[z]/[x]/[y].js (the tile proxy) and tests/globe-tiles.test.mjs.

export const GLOBE_TILE_SIZE = 256;
// NASA GIBS serves Blue Marble up to level 8, about 500 m per pixel.
export const GLOBE_TILE_MAX_ZOOM = 8;
export const GLOBE_TILE_PATH = "/api/map-tiles";
// Blue Marble with shaded relief and bathymetry: the same look as the globe's base texture, public domain.
export const GLOBE_TILE_UPSTREAM =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg";
// The zoom limit before tiles existed: OrbitControls minDistance 120 on three-globe's radius-100 globe.
export const DEFAULT_MIN_ALTITUDE = 0.2;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// Mercator tiles shrink towards the poles; past ~78° every level is plenty sharp anyway.
const latitudeFactor = (latitude) => Math.max(0.2, Math.cos((clamp(Number(latitude) || 0, -90, 90) * Math.PI) / 180));

// One number per viewport: at altitude `a` (in globe radii) zoom level z puts one texel on one screen pixel when
// 2^z = scale * cos(latitude) / a. `viewportHeightPx` is the drawing-buffer height, `fovDeg` the camera's vertical fov.
export function tileScale(viewportHeightPx, fovDeg) {
  const height = Number(viewportHeightPx);
  const fov = Number(fovDeg);
  if (!(height > 0) || !(fov > 0 && fov < 180)) return 0;
  return (Math.PI * height) / (GLOBE_TILE_SIZE * Math.tan((fov * Math.PI) / 360));
}

// The continuous zoom level whose texels match screen pixels at the centre of the view.
export function idealZoom(scale, altitude, latitude = 0) {
  if (!(scale > 0) || !(altitude > 0)) return -Infinity;
  return Math.log2((scale * latitudeFactor(latitude)) / altitude);
}

// The zoom level an equirectangular base texture is worth: 2048 px wide → 3, 4096 → 4.
export function textureZoom(width) {
  const w = Number(width);
  return w > 0 ? Math.log2(w / GLOBE_TILE_SIZE) : 0;
}

// Camera altitudes where the tile engine (three-slippy-map-globe) changes level: it uses level z while
// altitude ≥ thresholds[z]. Rounding to the nearest level keeps every texel between 0.7 and 1.4 screen pixels.
export function zoomThresholds(scale, latitude = 0, maxZoom = GLOBE_TILE_MAX_ZOOM) {
  const s = scale * latitudeFactor(latitude);
  return Array.from({ length: maxZoom + 1 }, (_, z) => s / 2 ** (z + 0.5));
}

// The level to show, with hysteresis: keep the current level until the ideal one is 0.75 levels away.
// Without it, panning north or south (latitude shifts the ideal level) or the last frames of a zoom
// flipped the whole layer between two levels, and every flip down threw away the finer tiles.
export function pickTileLevel({ scale, altitude, latitude = 0, current = null, minLevel = 0, maxLevel = GLOBE_TILE_MAX_ZOOM }) {
  const ideal = idealZoom(scale, altitude, latitude);
  if (!Number.isFinite(ideal)) return minLevel;
  const keep = Number.isInteger(current) && current >= minLevel && current <= maxLevel && Math.abs(ideal - current) < 0.75;
  return keep ? current : clamp(Math.round(ideal), minLevel, maxLevel);
}

// The coarsest tile level worth loading: twice the base texture's detail.
export function minTileZoom(baseZoom) {
  return clamp(Math.ceil(baseZoom) + 1, 0, GLOBE_TILE_MAX_ZOOM);
}

// Tiles switch on once the base texture is stretched about 2.4x and off again below 2x, so the layer does
// not flicker at the boundary. The base texture is equirectangular, so its sharpness does not gain with latitude.
export function tilesWanted({ scale, altitude, baseZoom, active = false }) {
  const stretch = idealZoom(scale, altitude, 0) - baseZoom;
  return active ? stretch >= 1 : stretch >= 1.25;
}

// How close the camera may go: where the deepest level is still at most ~1.4x stretched on the equator.
export function minSharpAltitude(scale, maxZoom = GLOBE_TILE_MAX_ZOOM) {
  if (!(scale > 0)) return DEFAULT_MIN_ALTITUDE;
  return clamp(scale / 2 ** (maxZoom + 0.5), 0.04, DEFAULT_MIN_ALTITUDE);
}

// The tile shell floats just above the base globe so the two never z-fight. The gap grows with altitude
// (depth precision falls with distance) and stays far below a pixel, so pins still sit on the imagery.
export function tileShellScale(altitude) {
  const a = Number(altitude);
  return 1 + Math.max(0.0001, 0.0006 * (a > 0 ? a : 0));
}

// The same-origin tile URL; argument order matches three-slippy-map-globe's tileUrl(x, y, level).
export function tilePath(x, y, z) {
  return `${GLOBE_TILE_PATH}/${z}/${x}/${y}`;
}

const TILE_INDEX = /^(0|[1-9]\d{0,2})$/;

// `{ z, x, y }` from a /api/map-tiles/z/x/y request, or null unless it names a real tile up to the deepest level.
export function parseTileRequest({ z, x, y } = {}) {
  if (![z, x, y].every((part) => typeof part === "string" && TILE_INDEX.test(part))) return null;
  const tile = { z: Number(z), x: Number(x), y: Number(y) };
  if (tile.z > GLOBE_TILE_MAX_ZOOM) return null;
  const size = 2 ** tile.z;
  return tile.x < size && tile.y < size ? tile : null;
}

// The upstream image for a tile. A `template` override (MAP_TILE_UPSTREAM) must be http(s) and name {z}, {x}, {y}.
export function upstreamTileUrl({ z, x, y }, template) {
  const usable = typeof template === "string"
    && /^https?:\/\/\S+$/.test(template)
    && ["{z}", "{x}", "{y}"].every((key) => template.includes(key));
  return (usable ? template : GLOBE_TILE_UPSTREAM)
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

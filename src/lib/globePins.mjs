// Visitor pins on the globe are aggregates per metro area at one decimal degree (about 11 km); nothing
// finer is ever sent to the browser. Close up, that cell grows larger than a pin and a pin's tip would seem
// to point at one street, so RotatingGlobe draws pins as a soft disc the size of the cell instead.

const EARTH_RADIUS_KM = 6371;
// 0.1° of latitude.
export const APPROX_CELL_KM = 11.1;
// Pins turn into discs once the cell would be at least this many CSS pixels across.
export const APPROX_MIN_PX = 40;

// On-screen size (CSS px) of an approximate cell at the centre of the view, for a camera `altitude` globe
// radii up with a vertical field of view of `fovDeg`, drawing `cssHeight` pixels tall.
export function cellPixels(altitude, fovDeg, cssHeight) {
  const a = Math.max(0, Number(altitude) || 0);
  const groundKm = 2 * a * EARTH_RADIUS_KM * Math.tan(((Number(fovDeg) || 50) * Math.PI) / 360);
  const height = Number(cssHeight) || 0;
  return groundKm > 0 && height > 0 ? (APPROX_CELL_KM * height) / groundKm : 0;
}

export const showsApproximateAreas = (altitude, fovDeg, cssHeight) => cellPixels(altitude, fovDeg, cssHeight) >= APPROX_MIN_PX;

// The aggregator's marker limit. A world list shorter than this holds every metro in the time window.
export const MARKER_LIMIT = 1600;
// While the world list is complete, panning and zooming re-use it; it is refreshed quietly at most
// this often, when the visitor interacts.
export const WORLD_REFRESH_MS = 60000;

// What a camera move needs from the markers API: nothing ("none"), the whole world list ("world"),
// or the visible box ("bbox", only while the world list was cut at MARKER_LIMIT).
export function pinRequestFor({ haveWorld, worldComplete, worldAgeMs, force = false, zoomBucket }) {
  if (!haveWorld) return "world";
  if (worldComplete) return force || worldAgeMs >= WORLD_REFRESH_MS ? "world" : "none";
  return zoomBucket === "world" ? "world" : "bbox";
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import GlobeLib from "react-globe.gl";
import { supabase as supabaseClient } from "../supabase/supabaseClient";

/* ============================================================
   RotatingGlobe
   ✅ Supabase-focused pins (no extra backend):
   - Reads from (in order): visitor_pin_cells -> visitor_pins_grid_mv -> visitor_pin_region
   - Uses current POV to fetch pins for focused area (debounced)
   - Robust column guessing (lat/lng/cnt/level)
   - Falls back to `pins` prop if server fetch fails / empty
   ============================================================ */

const DEBUG_PINS = false;
const log = (...a) => {
  if (DEBUG_PINS) console.log("[RotatingGlobe:pins]", ...a);
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (t) => t * t * (3 - 2 * t);

const isFiniteNumber = (n) => Number.isFinite(n) && !Number.isNaN(n);

const normalizeLng = (lng) => {
  let x = Number(lng);
  if (!isFiniteNumber(x)) return 0;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
};

const pickFiniteNumber = (...vals) => {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

const guessFirstKey = (obj, keys) => {
  if (!obj) return null;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) return k;
  }
  return null;
};

const extractLatLngSmart = (row, prefer = {}) => {
  // Prefer "center_*" / "latitude|longitude" over generic "lat|lng"
  // because bucket tables may have "lat/lng" as indices, not coordinates.
  const lat = pickFiniteNumber(
    prefer.latKey ? row?.[prefer.latKey] : undefined,
    row?.center_lat,
    row?.centerLatitude,
    row?.latitude,
    row?.avg_lat,
    row?.pin_lat,
    row?.lat
  );
  const lng = pickFiniteNumber(
    prefer.lngKey ? row?.[prefer.lngKey] : undefined,
    row?.center_lng,
    row?.centerLongitude,
    row?.longitude,
    row?.avg_lng,
    row?.pin_lng,
    row?.lng
  );
  return { lat, lng };
};

const computeLevelFromAltitude = (alt) => {
  const a = Number(alt);
  if (!Number.isFinite(a)) return "world";
  // react-globe.gl altitude: ~0.8 (close) .. 4+ (far)
  if (a >= 2.2) return "world";
  if (a >= 1.25) return "continent";
  return "local";
};

const FOCUS_AREA_SCALE = 1.6; // ✅ enlarge focused area window
const computeDeltaDeg = (level) => {
  const base = level === "world" ? 70 : level === "continent" ? 28 : 12;
  return base * FOCUS_AREA_SCALE;
};

const EARTH_RADIUS_MILES = 3959;
const haversineMiles = (lat1, lng1, lat2, lng2) => {
  const toRad = (d) => (d * Math.PI) / 180;

  const aLat = toRad(lat1);
  const bLat = toRad(lat2);
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(normalizeLng(lng2 - lng1));

  const sin1 = Math.sin(dLat / 2);
  const sin2 = Math.sin(dLng / 2);

  const aa = sin1 * sin1 + Math.cos(aLat) * Math.cos(bLat) * sin2 * sin2;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return EARTH_RADIUS_MILES * c;
};

/**
 * Cluster points so that within `minMiles` only one pin appears.
 * Uses grid acceleration + nearest cluster merge.
 */
const clusterByMiles = (points, minMiles) => {
  const list = Array.isArray(points) ? points : [];
  if (!list.length) return [];

  const d = Math.max(Number(minMiles) || 50, 1);

  // ~69 miles per degree latitude
  const cellDeg = Math.max(d / 69, 0.25);
  const cellKey = (lat, lng) => {
    const x = Math.floor((normalizeLng(lng) + 180) / cellDeg);
    const y = Math.floor((lat + 90) / cellDeg);
    return `${x}|${y}`;
  };

  const clusters = [];
  const grid = new Map();

  const neighborIdxs = (lat, lng) => {
    const x0 = Math.floor((normalizeLng(lng) + 180) / cellDeg);
    const y0 = Math.floor((lat + 90) / cellDeg);
    const out = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const k = `${x0 + dx}|${y0 + dy}`;
        const arr = grid.get(k);
        if (arr?.length) out.push(...arr);
      }
    }
    return out;
  };

  const addToGrid = (lat, lng, idx) => {
    const k = cellKey(lat, lng);
    const arr = grid.get(k);
    if (!arr) grid.set(k, [idx]);
    else arr.push(idx);
  };

  for (const p of list) {
    const candidates = neighborIdxs(p.lat, p.lng);

    let bestIdx = -1;
    let bestDist = Infinity;

    for (const idx of candidates) {
      const c = clusters[idx];
      if (!c) continue;
      const dist = haversineMiles(p.lat, p.lng, c.lat, c.lng);
      if (dist <= d && dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    }

    if (bestIdx >= 0) {
      const c = clusters[bestIdx];
      const n = c.count + 1;
      c.lat = (c.lat * c.count + p.lat) / n;
      // Longitude circular mean (fixes dateline averaging issues)
      const toRad = (d) => (normalizeLng(d) * Math.PI) / 180;
      const ang = toRad(p.lng);
      c._sin = (c._sin ?? Math.sin(toRad(c.lng))) + Math.sin(ang);
      c._cos = (c._cos ?? Math.cos(toRad(c.lng))) + Math.cos(ang);
      c.lng = normalizeLng((Math.atan2(c._sin, c._cos) * 180) / Math.PI);
      c.count = n;
    } else {
      const idx = clusters.length;
      const toRad0 = (d) => (normalizeLng(d) * Math.PI) / 180;
      const a0 = toRad0(p.lng);
      clusters.push({ lat: p.lat, lng: normalizeLng(p.lng), count: 1, label: p.label, _sin: Math.sin(a0), _cos: Math.cos(a0) });
      addToGrid(p.lat, p.lng, idx);
    }
  }

  return clusters;
};

/**
 * Build pins to display based on zoom buckets.
 */
const buildDisplayPins = (normalizedRawPins, zoomT) => {
  const raw = Array.isArray(normalizedRawPins) ? normalizedRawPins : [];
  if (!raw.length) return [];

  // zoomT: 0 near, 1 far
  const z = clamp(Number(zoomT) || 0.75, 0, 1);

  const isWorld = z >= 0.78;
  const isContinent = z >= 0.48 && z < 0.78;
  const isLocal = z < 0.48;

  let clusterMiles = 1800;
  let maxPins = 40;

  if (isWorld) {
    const t = clamp((z - 0.78) / (1 - 0.78), 0, 1);
    clusterMiles = 1700 + (2800 - 1700) * smoothstep(t);
    maxPins = 40;
  } else if (isContinent) {
    const t = clamp((z - 0.48) / (0.78 - 0.48), 0, 1);
    clusterMiles = 650 + (1350 - 650) * smoothstep(t);
    maxPins = 110;
  } else {
    const localT = clamp(z / 0.48, 0, 1);
    clusterMiles = 50;
    maxPins = Math.round(160 + (360 - 160) * smoothstep(localT));
  }

  const clusters = clusterByMiles(raw, clusterMiles);
  clusters.sort((a, b) => (b.count || 0) - (a.count || 0));

  return clusters.slice(0, maxPins).map((c) => ({
    lat: c.lat,
    lng: c.lng,
    label: c.label || "Unknown",
    weight: 1,
  }));
};

const RotatingGlobe = ({ pins = [], supabase = null }) => {
  const sb = supabase ?? supabaseClient;

  const DEBOUNCE_MS = 200;

  // --- Supabase server pins (bucket tables) ---
  const [serverPins, setServerPins] = useState([]);
  const [pinsLoading, setPinsLoading] = useState(false);
  // Avoid showing inaccurate fallback pins during initialization: wait for first server fetch
  const [initialServerPinsReady, setInitialServerPinsReady] = useState(false);
  const [serverPinsError, setServerPinsError] = useState(false);

  // Init mode: show globally balanced pins at startup; switch to focused pins after user interaction
  const [pinMode, setPinMode] = useState("bootstrap");
  const pinModeRef = useRef("bootstrap");

  const initialFetchDoneRef = useRef(false);
  const loadingDelayRef = useRef(null);
  const pinSourceRef = useRef(null); // { table, cols }
  const fetchingRef = useRef(false);
  const fetchTimerRef = useRef(null);
  const lastFetchKeyRef = useRef("");

  // globe
  const globeRef = useRef(null);
  const containerRef = useRef(null);
  const elCacheRef = useRef(new Map());
  const [size, setSize] = useState({ w: 1, h: 1 });

  // zoom tracking
  const [stableZoomT, setStableZoomT] = useState(0.75);
  const liveZoomRef = useRef(0.75);
  const debounceTimerRef = useRef(null);
  const minDistanceRef = useRef(120);
  const maxDistanceRef = useRef(2200);
  const userInteractedRef = useRef(false);
  const didAutoFocusRef = useRef(false);
  const lastSampleAtRef = useRef(0);

  const effectivePins = useMemo(() => {
    const hasSb = !!sb && typeof sb.from === "function";
    if (!hasSb) return pins;

    // Before the first successful/failed server fetch, show NO pins + loading overlay (prevents wrong init pins)
    if (!initialServerPinsReady) return serverPins;

    // If server fetch fails (RLS/columns/etc.), fall back to client-provided pins
    if (serverPinsError) return pins;

    return serverPins && serverPins.length ? serverPins : pins;
  }, [sb, pins, serverPins, initialServerPinsReady, serverPinsError]);

  const normalizedPins = useMemo(() => {
    const raw = Array.isArray(effectivePins) ? effectivePins : [];
    return raw
      .map((p) => ({
        lat: Number(p.lat ?? p.latitude),
        lng: normalizeLng(Number(p.lng ?? p.longitude)),
        label: String(p.label || "Unknown"),
        count: Number(p.count ?? p.cnt ?? p.n ?? 1),
      }))
      .filter((p) => isFiniteNumber(p.lat) && isFiniteNumber(p.lng));
  }, [effectivePins]);

  const pinsSig = useMemo(() => {
    if (!normalizedPins.length) return "0";
    const p0 = normalizedPins[0];
    return `${normalizedPins.length}|${p0.lat.toFixed(3)}|${p0.lng.toFixed(3)}`;
  }, [normalizedPins]);

  /* ------------------ Supabase: discover + fetch ------------------ */


  const balancedSamplePins = (pinList, target = 120) => {
    const list = Array.isArray(pinList) ? pinList.slice() : [];
    if (!list.length) return [];

    const latBand = (lat) => {
      const a = Number(lat);
      if (a < -30) return 0;
      if (a < 0) return 1;
      if (a < 30) return 2;
      return 3;
    };

    const lngBin = (lng) => {
      let x = normalizeLng(Number(lng));
      x = x < 0 ? x + 360 : x; // [-180,180] -> [0,360)
      const bins = 12; // 30° each
      return Math.min(bins - 1, Math.floor((x / 360) * bins));
    };

    const buckets = new Map(); // key -> pins[]
    for (const p of list) {
      const key = `${latBand(p.lat)}|${lngBin(p.lng)}`;
      const arr = buckets.get(key);
      if (arr) arr.push(p);
      else buckets.set(key, [p]);
    }

    for (const arr of buckets.values()) {
      arr.sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));
    }

    const keys = Array.from(buckets.keys()).sort((ka, kb) => {
      const a = buckets.get(ka)?.length || 0;
      const b = buckets.get(kb)?.length || 0;
      return b - a;
    });

    const out = [];
    while (out.length < target) {
      let progressed = false;
      for (const k of keys) {
        const arr = buckets.get(k);
        if (!arr?.length) continue;
        out.push(arr.shift());
        progressed = true;
        if (out.length >= target) break;
      }
      if (!progressed) break;
    }
    return out;
  };

  const discoverPinSource = async () => {
    if (!sb || typeof sb.from !== "function") return null;

    const candidates = ["visitor_pin_cells", "visitor_pins_grid_mv", "visitor_pin_region"];

    for (const table of candidates) {
      const { data, error } = await sb.from(table).select("*").limit(1);
      if (error) {
        log("table not available:", table, error?.message || error);
        continue;
      }

      const row = Array.isArray(data) && data.length ? data[0] : null;

      const latKey =
        (row &&
          guessFirstKey(row, ["center_lat", "centerLatitude", "latitude", "avg_lat", "pin_lat", "lat",
            "centerLatitude",
            "avg_lat",
            "pin_lat",
          ])) ||
        "latitude";
      const lngKey =
        (row &&
          guessFirstKey(row, ["center_lng", "centerLongitude", "longitude", "avg_lng", "pin_lng", "lng",
            "centerLongitude",
            "avg_lng",
            "pin_lng",
          ])) ||
        "longitude";
      const cntKey =
        (row && guessFirstKey(row, ["cnt", "count", "n", "hits", "visits"])) || "cnt";
      const levelKey = row ? guessFirstKey(row, ["level", "zoom_level", "grid_level", "tier"]) : null;

      const cols = { latKey, lngKey, cntKey, levelKey };

      pinSourceRef.current = { table, cols };
      log("pin source selected:", table, cols);
      return pinSourceRef.current;
    }

    pinSourceRef.current = null;
    return null;
  };

  const normalizeRowsToPins = (rows, preferCols = {}) => {
    const out = [];
    for (const r of rows || []) {
      const { lat, lng } = extractLatLngSmart(r, preferCols);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      let latFixed = lat;
      let lngFixed = lng;

      // If stored in radians, convert to degrees
      if (Math.abs(latFixed) <= 3.2 && Math.abs(lngFixed) <= 3.2) {
        latFixed = (latFixed * 180) / Math.PI;
        lngFixed = (lngFixed * 180) / Math.PI;
      }

      // Auto-fix swapped lat/lng if obvious
      if (Math.abs(latFixed) > 90 && Math.abs(latFixed) <= 180 && Math.abs(lngFixed) <= 90) {
        const tmp = latFixed;
        latFixed = lngFixed;
        lngFixed = tmp;
      }

      lngFixed = normalizeLng(lngFixed);

      if (!Number.isFinite(latFixed) || !Number.isFinite(lngFixed) || Math.abs(latFixed) > 90) continue;

      const cnt =
        Number(r?.[preferCols.cntKey]) ||
        Number(r?.cnt) ||
        Number(r?.count) ||
        Number(r?.n) ||
        Number(r?.hits) ||
        1;

      const label =
        (r?.region && String(r.region)) ||
        (r?.city && String(r.city)) ||
        (r?.country && String(r.country)) ||
        (r?.label && String(r.label)) ||
        "";

      out.push({
        lat: latFixed,
        lng: lngFixed,
        label: label ? `${label} · ${cnt}` : `${cnt}`,
        weight: 1,
        count: cnt,
      });
    }
    return out;
  };

  const getCurrentPOV = () => {
    try {
      const g = globeRef.current;
      if (!g || typeof g.pointOfView !== "function") return { lat: 0, lng: 0, altitude: 2.4 };
      const pov = g.pointOfView();
      return {
        lat: Number(pov?.lat) || 0,
        lng: normalizeLng(Number(pov?.lng) || 0),
        altitude: Number(pov?.altitude) || 2.4,
      };
    } catch {
      return { lat: 0, lng: 0, altitude: 2.4 };
    }
  };

  const fetchWorldBootstrapPins = async () => {
    if (!sb || typeof sb.from !== "function") return;
    if (!pinSourceRef.current) return;
    if (fetchingRef.current) return;

    const src = pinSourceRef.current;
    const cols = src.cols || {};
    const latCol = cols.latKey || "latitude";
    const lngCol = cols.lngKey || "longitude";
    const cntCol = cols.cntKey || "cnt";
    const levelCol = cols.levelKey || null;

    fetchingRef.current = true;

    if (loadingDelayRef.current) clearTimeout(loadingDelayRef.current);
    loadingDelayRef.current = setTimeout(() => setPinsLoading(true), 120);

    try {
      const limit = 6000; // pull enough to cover all buckets (table is already aggregated)
      const baseSelectCols = "*";

      const runQuery = async (withLevel) => {
        let q = sb.from(src.table).select(baseSelectCols);
        if (withLevel && levelCol) q = q.eq(levelCol, "world");

        let res = await q.order(cntCol, { ascending: false }).limit(limit);
        if (res?.error) res = await q.order("count", { ascending: false }).limit(limit);
        if (res?.error) res = await q.limit(limit);
        return res;
      };

      let res = await runQuery(true);
      if (res?.error) throw res.error;

      if (!res?.data?.length && levelCol) {
        res = await runQuery(false);
        if (res?.error) throw res.error;
      }

      const pinsAll = normalizeRowsToPins(res.data, { latKey: latCol, lngKey: lngCol, cntKey: cntCol });
      const pinsFinal = pinsAll.length ? pinsAll : normalizeRowsToPins(res.data, {});
      const balanced = balancedSamplePins(pinsFinal, 120);

      setServerPinsError(false);
      setServerPins(balanced);
    } catch (e) {
      log("bootstrap pins failed:", e?.message || e);
      setServerPinsError(true);
      setServerPins([]);
    } finally {
      fetchingRef.current = false;
      if (loadingDelayRef.current) {
        clearTimeout(loadingDelayRef.current);
        loadingDelayRef.current = null;
      }
      setPinsLoading(false);
      if (!initialFetchDoneRef.current) {
        initialFetchDoneRef.current = true;
        setInitialServerPinsReady(true);
      }
    }
  };



  const fetchPinsForFocusedArea = async (force = false) => {
    if (!sb || typeof sb.from !== "function") return;
    if (!pinSourceRef.current) return;
    if (fetchingRef.current && !force) return;

    const src = pinSourceRef.current;
    const { lat, lng, altitude } = getCurrentPOV();

    const level = computeLevelFromAltitude(altitude);
    const delta = computeDeltaDeg(level);

    const key = `${src.table}|${level}|${Math.round(lat * 10) / 10}|${Math.round(lng * 10) / 10}`;
    if (!force && key === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = key;

    // show loading if fetch takes >120ms (avoid flicker)
    if (loadingDelayRef.current) clearTimeout(loadingDelayRef.current);
    loadingDelayRef.current = setTimeout(() => setPinsLoading(true), 120);
    setServerPinsError(false);
    fetchingRef.current = true;

    const latMin = clamp(lat - delta, -89.9, 89.9);
    const latMax = clamp(lat + delta, -89.9, 89.9);
    const lngMin = normalizeLng(lng - delta);
    const lngMax = normalizeLng(lng + delta);

    const limit = level === "world" ? 220 : level === "continent" ? 700 : 1600; // wider window => allow more candidates

    const cols = src.cols || {};
    const latCol = cols.latKey || "latitude";
    const lngCol = cols.lngKey || "longitude";
    const cntCol = cols.cntKey || "cnt";
    const levelCol = cols.levelKey || null;

    try {
      // lat filter
      let q = sb.from(src.table).select("*").gte(latCol, latMin).lte(latCol, latMax);

      // lng range with antimeridian wrap
      if (lngMin <= lngMax) {
        q = q.gte(lngCol, lngMin).lte(lngCol, lngMax);
      } else {
        q = q.or(`${lngCol}.gte.${lngMin},${lngCol}.lte.${lngMax}`);
      }

      const runQuery = async (withLevel) => {
        let qq = q;
        if (withLevel && levelCol) qq = qq.eq(levelCol, level);

        // order by cnt -> fallback to count -> fallback to no order
        let res = await qq.order(cntCol, { ascending: false }).limit(limit);
        if (res?.error) res = await qq.order("count", { ascending: false }).limit(limit);
        if (res?.error) res = await qq.limit(limit);
        return res;
      };

      let res = await runQuery(true);
      if (res?.error) throw res.error;

      if (!res?.data?.length && levelCol) {
        res = await runQuery(false);
        if (res?.error) throw res.error;
      }

      const nextPins = normalizeRowsToPins(res.data, { latKey: latCol, lngKey: lngCol, cntKey: cntCol });
      const nextFinal = nextPins.length ? nextPins : normalizeRowsToPins(res.data, {});

      log("fetched pins:", src.table, "rows:", res.data?.length || 0, "pins:", nextFinal.length);

      // auto-fallback to another table if empty
      if (!nextFinal.length) {
        const fallback = await discoverPinSource();
        if (fallback && fallback.table !== src.table) {
          // Cleanup current attempt before retry (prevents stuck Loading)
          fetchingRef.current = false;
          if (loadingDelayRef.current) {
            clearTimeout(loadingDelayRef.current);
            loadingDelayRef.current = null;
          }
          setPinsLoading(false);
          return fetchPinsForFocusedArea(true);
        }
      }

      setServerPins(nextFinal);
    } catch (e) {
      log("fetch pins failed:", e?.message || e);
      setServerPinsError(true);
      setServerPins([]); // will fall back to `pins` after init if needed
    } finally {
      fetchingRef.current = false;
      if (loadingDelayRef.current) {
        clearTimeout(loadingDelayRef.current);
        loadingDelayRef.current = null;
      }
      setPinsLoading(false);
      if (!initialFetchDoneRef.current) {
        initialFetchDoneRef.current = true;
        setInitialServerPinsReady(true);
      }
    }
  };

  const scheduleFetchPins = (force = false) => {
    if (!sb) return;
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(() => fetchPinsForFocusedArea(force), 120);
  };

  // Discover source + initial fetch
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!sb) return;
      await discoverPinSource();
      if (!mounted) return;

      // Wait for Globe ref to be ready so POV is reliable (reduces “wrong init location”)
      let tries = 0;
      const tick = () => {
        if (!mounted) return;
        const g = globeRef.current;
        if (g && typeof g.pointOfView === "function") {
          pinModeRef.current = "bootstrap";
          setPinMode("bootstrap");
          didAutoFocusRef.current = true;
          fetchWorldBootstrapPins();
          return;
        }
        if (tries++ < 30) setTimeout(tick, 50);
        else fetchWorldBootstrapPins();
      };
      tick();
    })();

    return () => {
      mounted = false;
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
      if (loadingDelayRef.current) clearTimeout(loadingDelayRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb]);

  /* ------------------ layout / controls ------------------ */

  // ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };

    update();

    let ro;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => update());
      ro.observe(el);
    } else {
      window.addEventListener("resize", update);
    }

    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", update);
    };
  }, []);

  // prevent page scroll while interacting globe
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e) => {
      if (e.ctrlKey) return;
      e.preventDefault();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const getCamera = (g) => {
    try {
      if (g && typeof g.camera === "function") return g.camera();
    } catch {}
    return null;
  };

  const getControls = (g) => {
    try {
      if (g && typeof g.controls === "function") return g.controls();
    } catch {}
    return null;
  };

  const scheduleStableCommit = () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      const z = liveZoomRef.current;
      setStableZoomT((prev) => (prev === z ? prev : z));
    }, DEBOUNCE_MS);
  };

  const sampleCameraToRefs = (force = false) => {
    const now = performance.now();
    if (!force && now - lastSampleAtRef.current < 90) return;
    lastSampleAtRef.current = now;

    const g = globeRef.current;
    const cam = getCamera(g);
    if (!cam?.position) return;

    const controls = getControls(g);

    const dist =
      typeof cam.position.length === "function"
        ? cam.position.length()
        : Math.sqrt(cam.position.x ** 2 + cam.position.y ** 2 + cam.position.z ** 2);

    const minD = Number(controls?.minDistance ?? minDistanceRef.current);
    const maxD = Number(controls?.maxDistance ?? maxDistanceRef.current);
    minDistanceRef.current = minD;
    maxDistanceRef.current = maxD;

    const safeMin = Math.max(1, Math.min(minD, maxD - 1));
    const safeMax = Math.max(safeMin + 1, maxD);

    const z =
      (Math.log(clamp(dist, safeMin, safeMax)) - Math.log(safeMin)) /
      (Math.log(safeMax) - Math.log(safeMin));

    const zBucket = Math.round(z * 100) / 100;

    if (liveZoomRef.current === zBucket) return;
    liveZoomRef.current = zBucket;
    scheduleStableCommit();
  };

  // Setup controls + initial POV
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;

    try {
      if (typeof g.pointOfView === "function") {
        g.pointOfView({ lat: 15, lng: 0, altitude: 2.2 }, 0);
      }

      const controls = getControls(g);
      if (controls) {
        controls.enableZoom = true;
        controls.enableRotate = true;
        controls.enablePan = false;

        controls.enableDamping = true;
        controls.dampingFactor = 0.08;

        // Start auto-rotate after initial pins fetch to avoid “random init POV”
        controls.autoRotate = false;
        controls.autoRotateSpeed = 0.55;

        controls.minDistance = 120;
        controls.maxDistance = 2200;
        controls.zoomSpeed = 0.9;
      }
    } catch {}

    // initial sample
    setTimeout(() => {
      sampleCameraToRefs(true);

      if (pinModeRef.current !== "focused") {
        pinModeRef.current = "focused";
        setPinMode("focused");
        setServerPins([]);
      }
      scheduleFetchPins(true);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        setStableZoomT(liveZoomRef.current);
      }, 0);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Enable auto-rotate once after initial server fetch (keeps init stable)
  useEffect(() => {
    if (!sb) return;
    if (!initialFetchDoneRef.current) return;
    if (userInteractedRef.current) return;

    const g = globeRef.current;
    const controls = getControls(g);
    if (!controls) return;

    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.55;
  }, [serverPins, sb]);
  // Stop auto-rotate once user interacts, and sample on change
  useEffect(() => {
    const g = globeRef.current;
    const controls = getControls(g);
    if (!controls) return;

    let autoTimer = null;

    if (!userInteractedRef.current) {
      autoTimer = setInterval(() => sampleCameraToRefs(false), 220);
    }

    const onStart = () => {
      if (userInteractedRef.current) return;
      userInteractedRef.current = true;

      controls.autoRotate = false;
      controls.autoRotateSpeed = 0;

      if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
      }

      sampleCameraToRefs(true);
    };

    const onChange = () => {
      sampleCameraToRefs(false);
      if (!userInteractedRef.current) return;

      if (pinModeRef.current !== "focused") {
        pinModeRef.current = "focused";
        setPinMode("focused");
        setServerPins([]);
      }
      scheduleFetchPins(false);
    };

    controls.addEventListener("start", onStart);
    controls.addEventListener("change", onChange);

    return () => {
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("change", onChange);
      if (autoTimer) clearInterval(autoTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb]);

  // Auto-focus once when pins arrive (prevents "pins on back side" == looks empty)
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    if (!normalizedPins.length) return;
    if (sb && !serverPins.length) return; // wait for server pins to avoid wrong init jump
    if (userInteractedRef.current) return;
    if (didAutoFocusRef.current) return;

    const p = normalizedPins[0];
    didAutoFocusRef.current = true;

    try {
      if (typeof g.pointOfView === "function") {
        g.pointOfView({ lat: p.lat, lng: p.lng, altitude: 2.05 }, 900);
      }
    } catch {}

    setTimeout(() => sampleCameraToRefs(true), 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinsSig]);

  const displayPins = useMemo(() => {
    // If pins come from server-side bucket tables, they are already aggregated.
    // Avoid re-clustering here to keep locations accurate.
    if (serverPins && serverPins.length) {
      const z = clamp(Number(stableZoomT) || 0.75, 0, 1);
      const maxPins = z >= 0.78 ? 220 : z >= 0.48 ? 520 : 1100;

      const sorted = [...normalizedPins].sort((a, b) => (b.count || 0) - (a.count || 0));
      return sorted.slice(0, maxPins).map((p) => ({
        lat: p.lat,
        lng: p.lng,
        label: p.label,
        weight: 1,
      }));
    }

    return buildDisplayPins(normalizedPins, stableZoomT);
  }, [normalizedPins, stableZoomT, serverPins]);

  // HTML marker element (kept lightweight)
  const htmlElement = (d) => {
    const lat = Number(d?.lat);
    const lng = Number(d?.lng);
    const key = `${lat.toFixed(4)}|${lng.toFixed(4)}`;

    const cached = elCacheRef.current.get(key);
    if (cached) return cached;

    const label = String(d?.label || "Unknown");

    const wrap = document.createElement("div");
    wrap.style.width = "14px";
    wrap.style.height = "14px";
    wrap.style.borderRadius = "999px";
    wrap.style.background = "#f97316";
    wrap.style.border = "2px solid rgba(255,255,255,0.95)";
    wrap.style.boxShadow = "0 6px 14px rgba(0,0,0,0.25)";
    wrap.style.position = "relative";
    wrap.style.transform = "translate(-50%, -50%)";
    wrap.style.pointerEvents = "none";
    wrap.title = label;

    const tail = document.createElement("div");
    tail.style.position = "absolute";
    tail.style.left = "50%";
    tail.style.top = "14px";
    tail.style.width = "3px";
    tail.style.height = "14px";
    tail.style.background = "rgba(249,115,22,0.85)";
    tail.style.borderRadius = "2px";
    tail.style.transform = "translateX(-50%)";
    tail.style.boxShadow = "0 6px 10px rgba(0,0,0,0.15)";

    wrap.appendChild(tail);

    elCacheRef.current.set(key, wrap);
    return wrap;
  };

  // prevent cache growing forever
  useEffect(() => {
    const keep = new Set(displayPins.map((p) => `${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`));
    const map = elCacheRef.current;
    if (map.size > 1400) {
      for (const k of map.keys()) {
        if (!keep.has(k)) map.delete(k);
      }
    }
  }, [displayPins]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
      if (loadingDelayRef.current) clearTimeout(loadingDelayRef.current);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        touchAction: "none",
      }}
    >
      {pinsLoading && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 5,
            padding: "6px 10px",
            borderRadius: 10,
            background: "rgba(0,0,0,0.35)",
            color: "rgba(255,255,255,0.9)",
            fontSize: 12,
            pointerEvents: "none",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          Loading…
        </div>
      )}

      <GlobeLib
        ref={globeRef}
        width={size.w}
        height={size.h}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="/textures/earth_day_8k.jpg"
        bumpImageUrl="/textures/earth_bump_8k.png"
        htmlElementsData={displayPins}
        htmlLat={(d) => d.lat}
        htmlLng={(d) => d.lng}
        htmlElement={htmlElement}
        htmlTransitionDuration={0}
      />
    </div>
  );
};

export default RotatingGlobe;

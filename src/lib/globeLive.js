// Live layer for the visitor globe: who is looking right now (Supabase Realtime presence, city-level
// only) and the guestbook flags. One shared connection per tab, however many globes are mounted.
import { useEffect, useState } from "react";
import { supabase } from "../supabase/supabaseClient";
import { cleanPeer } from "./requestGeo.mjs";

const CHANNEL = "globe-live";
const PULSE_MS = 6000;
const FLAG_REFRESH_MS = 60_000;
const MAX_PEERS = 200;

const listeners = new Set();
let state = { count: 0, peers: [], pulses: [], me: null, flags: [], flagsEnabled: true, connected: false };
let refs = 0;
let channel = null;
let synced = false;
let flagTimer = null;
let tabKey = null;
let pulseSeq = 0;

const emit = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
};

function pulse(peer, self = false) {
  if (!peer) return;
  const item = { id: `pulse-${++pulseSeq}`, lat: peer.lat, lng: peer.lng, city: peer.city, self };
  emit({ pulses: [...state.pulses, item].slice(-12) });
  setTimeout(() => emit({ pulses: state.pulses.filter((p) => p.id !== item.id) }), PULSE_MS);
}

function readPresence() {
  if (!channel) return;
  const all = channel.presenceState();
  const keys = Object.keys(all);
  const peers = [];
  for (const key of keys) {
    if (key === tabKey) continue;
    const peer = cleanPeer(all[key]?.[0]);
    if (peer && peers.length < MAX_PEERS) peers.push(peer);
  }
  emit({ count: Math.max(keys.length, 1), peers });
}

async function loadFlags() {
  try {
    const res = await fetch("/api/globe/flags");
    if (!res.ok) return;
    const body = await res.json();
    emit({ flagsEnabled: body.enabled !== false, flags: Array.isArray(body.flags) ? body.flags : [] });
  } catch { /* keep what we have */ }
}

function meta() {
  const me = state.me;
  return me ? { lat: me.lat, lng: me.lng, city: me.city, country: me.country } : {};
}

const onVisibility = () => {
  if (!channel || !synced) return;
  if (document.visibilityState === "hidden") channel.untrack();
  else channel.track(meta());
};

async function start() {
  tabKey = tabKey || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  loadFlags();
  flagTimer = setInterval(loadFlags, FLAG_REFRESH_MS);
  let me = null;
  try {
    const res = await fetch("/api/globe/whereami");
    const body = res.ok ? await res.json() : null;
    me = body?.known ? cleanPeer(body) : null;
  } catch { /* unknown location still counts */ }
  if (!refs) return;
  emit({ me, count: 1 });
  try {
    channel = supabase.channel(CHANNEL, { config: { presence: { key: tabKey } } });
    channel
      .on("presence", { event: "sync" }, () => {
        readPresence();
        if (!synced) { synced = true; pulse(me, true); }
      })
      .on("presence", { event: "join" }, ({ key, newPresences }) => {
        if (!synced || key === tabKey) return;
        pulse(cleanPeer(newPresences?.[0]));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          emit({ connected: true });
          if (document.visibilityState !== "hidden") channel.track(meta());
        }
      });
    document.addEventListener("visibilitychange", onVisibility);
  } catch {
    emit({ connected: false });
  }
}

function stop() {
  clearInterval(flagTimer);
  document.removeEventListener("visibilitychange", onVisibility);
  if (channel) {
    try { supabase.removeChannel(channel); } catch { /* already closed */ }
  }
  channel = null;
  synced = false;
  emit({ connected: false, peers: [], count: 0 });
}

// A flag the visitor just planted shows at once, before the next refresh.
export function addLocalFlag(flag) {
  if (!flag) return;
  emit({ flags: [flag, ...state.flags.filter((f) => f.id !== flag.id)] });
  pulse(flag, true);
}

export function useGlobeLive(enabled = true) {
  const [snapshot, setSnapshot] = useState(state);
  useEffect(() => {
    if (!enabled) return undefined;
    listeners.add(setSnapshot);
    setSnapshot(state);
    refs += 1;
    if (refs === 1) start();
    return () => {
      listeners.delete(setSnapshot);
      refs -= 1;
      if (refs === 0) stop();
    };
  }, [enabled]);
  return snapshot;
}

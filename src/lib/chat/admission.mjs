// First come, first served for the chat.
//
// The assistant can answer only so many people at once, and each day has a spending limit. Without
// a line, whoever happens to send a message at the right moment gets through and everyone else
// fails at random. Here a visitor is given a *place* when they open the chat: a fixed number of
// places, held for a set time and number of messages, with that many messages reserved from the
// day's allowance up front. Once every place is taken, later visitors wait in arrival order and
// can see how many are ahead; when today's allowance cannot cover another place they are told so.
// People who already hold a place are never cut off part-way by those arriving after them.
//
// All of it is one small document (places, line, today's reservations) changed by a pure function,
// so the same rules run in tests, in the local preview and against the shared store.
export const DEFAULTS = Object.freeze({
  capacity: 30,          // places at once (the agent service answers about 32 requests at a time)
  sessionSeconds: 600,   // a place is held this long
  sessionMessages: 15,   // and for this many messages
  dailyMessages: 900,    // messages a day that places may reserve in total (stays under the agent's daily budget)
  queueLimit: 200,       // the line stops growing here
  heartbeatSeconds: 25,  // someone in line who has not checked in for this long has left
  claimSeconds: 45,      // someone promoted from the line has this long to show up
  perIp: 3,              // places plus spots in line that one network may hold
});

const int = (value, fallback, min, max) => { const n = Number(value); return Number.isFinite(n) && n >= min ? Math.min(Math.floor(n), max) : fallback; };
export function admissionSettings(env = process.env) {
  return {
    enabled: env.CHAT_ADMISSION !== 'off',
    capacity: int(env.CHAT_PLACES, DEFAULTS.capacity, 1, 500),
    sessionSeconds: int(env.CHAT_PLACE_SECONDS, DEFAULTS.sessionSeconds, 30, 7200),
    sessionMessages: int(env.CHAT_PLACE_MESSAGES, DEFAULTS.sessionMessages, 1, 200),
    dailyMessages: int(env.CHAT_DAILY_MESSAGES, DEFAULTS.dailyMessages, 1, 1000000),
    queueLimit: int(env.CHAT_LINE_LIMIT, DEFAULTS.queueLimit, 0, 5000),
    heartbeatSeconds: DEFAULTS.heartbeatSeconds, claimSeconds: DEFAULTS.claimSeconds,
    perIp: int(env.CHAT_PLACES_PER_NETWORK, DEFAULTS.perIp, 1, 50),
  };
}

export const emptyState = () => ({ v: 1, day: '', used: 0, seq: 0, active: [], queue: [] });
const dayOf = now => new Date(now).toISOString().slice(0, 10);
const untilTomorrow = now => Math.max(60, Math.ceil((Date.parse(`${dayOf(now)}T00:00:00Z`) + 86400000 - now) / 1000));

// Housekeeping that every action starts with: a new day, places that ended, people who left the
// line, then the head of the line moves into any free place the day's allowance can still cover.
function advance(state, now, cfg) {
  const today = dayOf(now);
  if (state.day !== today) {
    state.day = today;
    // Places still held keep their reservation; everything else starts from zero.
    state.used = state.active.reduce((sum, place) => sum + place.left, 0);
  }
  state.active = state.active.filter(place => {
    const over = place.until <= now || place.left <= 0 || (place.claimBy && place.claimBy <= now);
    if (over) state.used = Math.max(0, state.used - Math.max(0, place.left)); // unused messages go back
    return !over;
  });
  state.queue = state.queue.filter(waiting => now - waiting.seen <= cfg.heartbeatSeconds * 1000);
  while (state.queue.length && state.active.length < cfg.capacity && state.used + cfg.sessionMessages <= cfg.dailyMessages) {
    const next = state.queue.shift();
    state.active.push({ id: next.id, ip: next.ip, until: now + cfg.sessionSeconds * 1000, left: cfg.sessionMessages, claimBy: now + cfg.claimSeconds * 1000 });
    state.used += cfg.sessionMessages;
  }
  return state;
}

const activeResult = (place, now) => ({ status: 'active', left: place.left, seconds: Math.max(0, Math.ceil((place.until - now) / 1000)) });
function queuedResult(state, index, cfg) {
  const position = index + 1;
  // A rough wait: places turn over about once per half a session on average.
  return { status: 'queued', position, ahead: index, eta: Math.max(10, Math.ceil(position * cfg.sessionSeconds / 2 / cfg.capacity)) };
}

// action: 'enter' (opening the chat, or checking in while waiting), 'message' (about to send one),
// 'leave'. Returns { state, result }; `result.allowed` answers a 'message'.
export function applyAdmission(input, { now, id, ip = '', action }, cfg = DEFAULTS) {
  const state = advance(input || emptyState(), now, cfg);
  let place = state.active.find(item => item.id === id);
  const waitingIndex = state.queue.findIndex(item => item.id === id);

  if (action === 'leave') {
    if (place) { state.used = Math.max(0, state.used - place.left); state.active = state.active.filter(item => item.id !== id); }
    if (waitingIndex >= 0) state.queue.splice(waitingIndex, 1);
    advance(state, now, cfg);
    return { state, result: { status: 'left' } };
  }

  if (place) {
    delete place.claimBy; // they showed up
    if (action === 'message') {
      place.left -= 1;
      const result = { ...activeResult(place, now), allowed: true };
      if (place.left <= 0) advance(state, now, cfg); // their last message; the place frees up
      return { state, result };
    }
    return { state, result: activeResult(place, now) };
  }

  if (waitingIndex >= 0) {
    state.queue[waitingIndex].seen = now;
    return { state, result: { ...queuedResult(state, waitingIndex, cfg), allowed: false } };
  }

  // Someone new.
  const held = state.active.filter(item => item.ip && item.ip === ip).length + state.queue.filter(item => item.ip && item.ip === ip).length;
  if (ip && held >= cfg.perIp) return { state, result: { status: 'full', reason: 'network', retry: 60, allowed: false } };
  const affordable = state.used + cfg.sessionMessages <= cfg.dailyMessages;
  if (affordable && state.active.length < cfg.capacity && !state.queue.length) {
    place = { id, ip, until: now + cfg.sessionSeconds * 1000, left: cfg.sessionMessages };
    state.active.push(place);
    state.used += cfg.sessionMessages;
    if (action === 'message') { place.left -= 1; return { state, result: { ...activeResult(place, now), allowed: true } }; }
    return { state, result: activeResult(place, now) };
  }
  // Today's allowance cannot cover another place, and nobody is waiting on places to free up.
  if (!affordable && !state.queue.length) return { state, result: { status: 'full', reason: 'daily', retry: untilTomorrow(now), allowed: false } };
  if (state.queue.length >= cfg.queueLimit) return { state, result: { status: 'full', reason: 'line', retry: 120, allowed: false } };
  state.seq += 1;
  state.queue.push({ id, ip, n: state.seq, seen: now });
  return { state, result: { ...queuedResult(state, state.queue.length - 1, cfg), allowed: false } };
}

// ── Where the document lives ────────────────────────────────────────────────
// A store only has to read the document and replace it if nobody else changed it meanwhile.
export function memoryAdmissionStore() {
  let raw = null;
  return { async read() { return raw; }, async swap(previous, next) { if (raw !== previous) return false; raw = next; return true; } };
}

// Compare-and-set on one Valkey key. `client()` resolves to a node-redis client, or null when the
// shared store is not available.
const SWAP = "local cur = redis.call('GET', KEYS[1]) if (cur == false and ARGV[1] == '') or cur == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2], 'EX', 172800) return 1 end return 0";
export function valkeyAdmissionStore(client, key = 'chat:admission:v1') {
  return {
    async read() { const c = await client(); if (!c) throw new Error('shared store unavailable'); return c.get(key); },
    async swap(previous, next) { const c = await client(); if (!c) throw new Error('shared store unavailable'); return (await c.eval(SWAP, { keys: [key], arguments: [previous ?? '', next] })) === 1; },
  };
}

// Runs one action against the store, retrying when another request changed the document first.
// If the store cannot be reached or stays contended, the answer is { status: 'unknown' }: callers
// let the message through, because a broken line must not take the chat down with it.
export function createAdmission({ store, settings = DEFAULTS, now = Date.now, attempts = 8, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), log = message => console.warn(message) } = {}) {
  return {
    settings,
    async act({ id, ip, action }) {
      if (settings.enabled === false) return { status: 'off', allowed: true };
      try {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const raw = await store.read();
          let state = null;
          try { state = raw ? JSON.parse(raw) : null; } catch { state = null; }
          const { state: next, result } = applyAdmission(state && state.v === 1 ? state : null, { now: now(), id, ip, action }, settings);
          const serialized = JSON.stringify(next);
          if (serialized === raw || await store.swap(raw, serialized)) return result;
          await wait(5 + Math.floor(Math.random() * 20 * (attempt + 1)));
        }
        log('[chat-admission] too much contention; letting the request through');
      } catch (error) { log(`[chat-admission] ${error?.message || error}`); }
      return { status: 'unknown', allowed: true };
    },
  };
}

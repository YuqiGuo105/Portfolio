import { randomUUID } from 'node:crypto';

// Only provider transcripts reach this writer. No browser-supplied history,
// recordings, identity claims, private page text, or API credentials are stored.
export function createVoiceHistory({ env = process.env, fetchImpl = fetch, now = Date.now,
  conversationId = randomUUID(), provider, model, page, onError = () => {} } = {}) {
  if (env.VOICE_RECORD_TRANSCRIPTS !== 'true') return null;
  const base = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const environment = env.NODE_ENV === 'production' ? 'production' : 'development';
  let opened = false, closed = false, failed = false, sequence = 0, timer, inflight, closeReason;
  let user, assistant;
  const pending = new Map();
  const inputTurns = new Map();
  const stamp = () => new Date(now()).toISOString();
  const diagnostics = stage => console.warn(JSON.stringify({ event: stage, conversationId }));

  async function write(path, body, method = 'POST') {
    if (!base || !key) throw new Error('Voice history is not configured');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetchImpl(`${base.replace(/\/$/, '')}/rest/v1/${path}`, {
          method, redirect: 'error', signal: AbortSignal.timeout(1500),
          headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(body),
        });
        if (response.ok) return;
        await response.body?.cancel();
        if (response.status < 500 && response.status !== 429) break;
      } catch { /* Stable UUIDs make a retry after an unknown outcome idempotent. */ }
    }
    throw new Error('Voice history write failed');
  }

  function snapshot(message, completion) {
    if (!message?.content.trim()) return;
    message.metadata_json.completion = completion;
    pending.set(message.id, { ...message, metadata_json: { ...message.metadata_json } });
  }
  function append(current, role, text) {
    if (typeof text !== 'string' || !text) return current;
    const message = current || newMessage(role);
    const max = role === 'user' ? 6000 : 8000;
    if (message.content.length + text.length > max) message.metadata_json.truncated = true;
    message.content = (message.content + text).slice(0, max);
    snapshot(message, 'streaming');
    return message;
  }
  function newMessage(role) {
    return { id: randomUUID(), conversation_id: conversationId, role, content: '', created_at: stamp(),
      metadata_json: { source: 'voice', provider, model, environment, pagePath: page?.path || '/', sequence: ++sequence, completion: 'streaming' } };
  }
  function finish(role, completion) {
    const message = role === 'user' ? user : assistant;
    snapshot(message, completion);
    if (role === 'user') user = null; else assistant = null;
  }
  function reportFailure() {
    if (failed) return;
    failed = true; diagnostics('voice_history_write_failed');
    queueMicrotask(() => onError());
  }
  function flush() {
    clearTimeout(timer); timer = null;
    if (inflight) return inflight;
    if (!opened || failed) return Promise.resolve(false);
    if (!pending.size) return Promise.resolve(true);
    inflight = (async () => {
      try {
        while (pending.size) {
          const batch = [...pending.values()];
          await write('message?on_conflict=id', batch);
          for (const row of batch) if (pending.get(row.id) === row) pending.delete(row.id);
        }
        return true;
      } catch { reportFailure(); return false; }
      finally { inflight = null; }
    })();
    return inflight;
  }

  return {
    conversationId,
    async start() {
      await write('conversation?on_conflict=id', { id: conversationId, tenant_id: 'public', user_id: null,
        channel: environment === 'production' ? 'voice' : 'voice-local', status: 'active', locale: null,
        created_at: stamp(), updated_at: stamp() });
      opened = true;
      if (closed) { closed = false; await this.close(closeReason); }
    },
    observe(event) {
      if (!opened || closed || failed) return;
      const content = event.serverContent;
      if (!content) return;
      if (content.interrupted) { finish('user', 'transcribed'); finish('assistant', 'interrupted'); void flush(); }
      const input = content.inputTranscription;
      const turnId = typeof input?.turnId === 'string' || typeof input?.turnId === 'number' ? String(input.turnId) : null;
      if (input?.started && turnId !== null && !inputTurns.has(turnId)) {
        // ASR may arrive after the answer. Reserve its place when speech starts,
        // without writing an empty message or treating arrival order as turn order.
        const draft = newMessage('user');
        inputTurns.set(turnId, draft);
        if (inputTurns.size > 64) inputTurns.delete(inputTurns.keys().next().value);
      }
      if (input?.text) {
        user = append(turnId === null ? user : inputTurns.get(turnId), 'user', input.text);
        if (turnId !== null) inputTurns.set(turnId, user);
      }
      if (input?.finished) {
        if (turnId !== null) {
          const draft = inputTurns.get(turnId);
          snapshot(draft, 'transcribed');
          if (user === draft) user = null;
          inputTurns.delete(turnId);
        } else finish('user', 'transcribed');
      }
      if (content.outputTranscription?.text) {
        finish('user', 'transcribed');
        assistant = append(assistant, 'assistant', content.outputTranscription.text);
      }
      if (content.turnComplete) { finish('user', 'transcribed'); finish('assistant', 'generated'); void flush(); }
      else if (pending.size && !timer) timer = setTimeout(() => { void flush(); }, 750);
    },
    flush,
    async close(reason = 'ended') {
      if (closed) return inflight;
      closed = true; closeReason = reason; clearTimeout(timer);
      if (!opened) return;
      const endedAt = stamp();
      finish('user', 'transcribed'); finish('assistant', 'call-ended');
      if (!await flush()) return;
      const status = ['ended', 'client_hangup'].includes(reason) ? 'completed'
        : ['client_closed', 'time_limit', 'call_deadline', 'shutdown'].includes(reason) ? 'interrupted' : 'failed';
      try { await write(`conversation?id=eq.${conversationId}`, { status, updated_at: endedAt }, 'PATCH'); }
      catch { reportFailure(); }
    },
  };
}

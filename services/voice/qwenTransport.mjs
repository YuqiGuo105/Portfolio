import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { voiceGreeting } from '../../src/lib/voice/protocol.mjs';
import { QWEN_MODEL, qwenSetup } from '../../src/lib/voice/qwenProtocol.mjs';

const MODELS = new Set([QWEN_MODEL, 'qwen3.5-omni-flash-realtime', 'qwen3.5-omni-plus-realtime']);
const TOOLS = new Set(['get_profile', 'read_page', 'navigate_section']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function qwenConfiguration(env = process.env) {
  const model = env.QWEN_LIVE_MODEL || QWEN_MODEL;
  const workspace = env.QWEN_LIVE_WORKSPACE_ID || '';
  const endpoint = MODELS.has(model) && /^[a-zA-Z0-9-]{1,80}$/.test(workspace)
    ? `wss://${workspace}.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime?model=${model}` : null;
  // Enablement, quotas and trial policy belong to the relay, not this transport.
  return { configured: Boolean(env.QWEN_LIVE_API_KEY && endpoint), model, endpoint };
}

export function createQwenConnection({ env = process.env, page, profile,
  connect = (url, options) => new WebSocket(url, options) } = {}) {
  const config = qwenConfiguration(env);
  if (!config.configured) throw new Error('Qwen voice is not configured.');
  const connection = new EventEmitter();
  const responses = new Map(), calls = new Map(), eventIds = new Set(), inputCaptions = new Map();
  let upstream, closed = false, failed = false, opened = false, setupSent = false, ready = false, greetingSent = false;
  let currentResponse, inputTurn = 0;
  Object.defineProperties(connection, {
    readyState: { get: () => closed ? WebSocket.CLOSED : upstream?.readyState ?? WebSocket.CONNECTING },
    bufferedAmount: { get: () => upstream?.bufferedAmount ?? 0 },
  });
  const emit = event => { if (!closed) connection.emit('message', JSON.stringify(event)); };
  const finish = () => {
    if (closed) return false;
    closed = true; responses.clear(); calls.clear(); eventIds.clear(); inputCaptions.clear(); currentResponse = null;
    return true;
  };
  connection.terminate = () => {
    if (!finish()) return;
    try { if (upstream && upstream.readyState !== WebSocket.CLOSED) upstream.terminate(); }
    finally { connection.emit('close'); }
  };
  const fail = () => {
    if (closed || failed) return;
    failed = true;
    try { emit({ error: {} }); } finally { connection.terminate(); }
  };
  const send = event => {
    if (closed) return;
    if (upstream?.readyState !== WebSocket.OPEN) throw new Error('Qwen connection is not open.');
    upstream.send(JSON.stringify({ ...event, event_id: `event_${randomUUID()}` }));
  };
  const responseFor = event => {
    const id = event.response_id ?? event.response?.id;
    if (id !== undefined && (typeof id !== 'string' || !id || id.length > 200)) throw new Error('Invalid response.');
    let response = id ? responses.get(id) : currentResponse;
    if (!response) {
      response = { id, calls: new Set(), status: null, interrupted: false, continued: false, collecting: false, captions: new Map() };
      responses.set(id || Symbol(), response);
    }
    if (!currentResponse || event.type === 'response.created') currentResponse = response;
    return response;
  };
  const continueResponse = response => {
    if (closed || response.interrupted || response.collecting || response.continued || response.status !== 'completed'
      || !response.calls.size || [...response.calls].some(id => !calls.get(id)?.sent)) return;
    response.continued = true;
    send({ type: 'response.create' });
  };
  const registerCall = (response, item) => {
    if (response.interrupted || calls.has(item.call_id)) return null;
    if (typeof item.call_id !== 'string' || !item.call_id || item.call_id.length > 200
      || !TOOLS.has(item.name) || calls.size >= 24) throw new Error('Invalid tool call.');
    const args = JSON.parse(item.arguments || '{}');
    if (!object(args)) throw new Error('Invalid tool arguments.');
    const call = { id: item.call_id, name: item.name, args, response, sent: false };
    calls.set(call.id, call); response.calls.add(call.id);
    return { id: call.id, name: call.name, args };
  };
  const usage = value => {
    if (!object(value)) return;
    const valid = number => typeof number === 'number' && Number.isFinite(number) && number >= 0;
    const total = valid(value.total_tokens) ? value.total_tokens
      : valid(value.input_tokens) && valid(value.output_tokens) ? value.input_tokens + value.output_tokens : null;
    if (total !== null && Number.isFinite(total)) emit({ usageMetadata: { totalTokenCount: total } });
  };
  const caption = (captions, key, text, final, field, source = '') => {
    if (typeof text !== 'string') return;
    const state = captions.get(key) || { text: '', final: false, source };
    if (state.final || state.source !== source) return;
    const delta = final ? text.startsWith(state.text) ? text.slice(state.text.length) : '' : text;
    state.text += delta; state.final = final; captions.set(key, state);
    if (delta) emit({ serverContent: { [field]: { text: delta } } });
  };

  connection.send = raw => {
    if (closed || failed) return;
    try {
      const message = JSON.parse(raw.toString());
      if (!object(message)) throw new Error('Invalid voice message.');
      // The relay still sends Google's setup on open; Qwen setup is server-owned.
      if (message.setup) return;
      if (!ready) throw new Error('Qwen session is not ready.');
      if (message.clientContent) {
        const content = message.clientContent;
        const text = content.turns?.[0]?.parts?.[0]?.text;
        if (content.turnComplete !== true || content.turns?.length !== 1 || content.turns[0].role !== 'user'
          || content.turns[0].parts?.length !== 1 || text !== voiceGreeting().clientContent.turns[0].parts[0].text) {
          throw new Error('Only the server greeting is supported.');
        }
        if (greetingSent) return;
        greetingSent = true;
        send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
        send({ type: 'response.create' });
      } else if (message.realtimeInput?.audio) {
        send({ type: 'input_audio_buffer.append', audio: message.realtimeInput.audio.data });
      } else if (message.realtimeInput?.audioStreamEnd === true) {
        send({ type: 'input_audio_buffer.clear' });
      } else if (Array.isArray(message.toolResponse?.functionResponses)) {
        for (const result of message.toolResponse.functionResponses) {
          const call = calls.get(result.id);
          if (!call) throw new Error('Unknown tool result.');
          if (call.sent || call.response.interrupted) continue;
          const output = JSON.stringify(result.response);
          if (typeof output !== 'string') throw new Error('Invalid tool result.');
          call.sent = true;
          send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: call.id, output } });
          continueResponse(call.response);
        }
      } else throw new Error('Unsupported voice message.');
    } catch { fail(); }
  };

  const handle = raw => {
    if (closed || failed) return;
    try {
      const event = JSON.parse(raw.toString());
      if (!object(event)) throw new Error('Invalid provider event.');
      // Gateway failures are not always realtime events and can contain secrets.
      if (event.type === 'error' || event.error || (!event.type && ('code' in event || 'message' in event))) { fail(); return; }
      if (typeof event.event_id === 'string') {
        if (eventIds.has(event.event_id)) return;
        eventIds.add(event.event_id);
      }
      if (event.type === 'session.created') {
        if (!setupSent) { setupSent = true; send(qwenSetup(page, profile)); }
        return;
      }
      if (event.type === 'session.updated') {
        if (!setupSent) throw new Error('Unexpected session update.');
        if (!ready) { ready = true; emit({ setupComplete: {} }); }
        return;
      }
      if (!ready) return;
      if (event.type === 'input_audio_buffer.speech_started') {
        inputTurn++;
        // Keep tombstones for every interrupted response, even across later turns.
        for (const response of responses.values()) {
          if (response === currentResponse || response.status === null || (response.calls.size && !response.continued)) response.interrupted = true;
        }
        emit({ serverContent: { interrupted: true } });
        return;
      }
      if (event.type === 'conversation.item.input_audio_transcription.completed' || event.type === 'conversation.item.input_audio_transcription.delta') {
        const final = event.type.endsWith('.completed');
        caption(inputCaptions, event.item_id || inputTurn, final ? event.transcript : event.delta, final, 'inputTranscription');
        return;
      }
      if (typeof event.type !== 'string' || !event.type.startsWith('response.')) return;
      const response = responseFor(event);
      if (event.type === 'response.done') {
        if (response.status !== null) return;
        response.status = event.response?.status || 'completed';
        response.collecting = true;
        // Interrupted work still costs tokens, but must never resume or play.
        usage(event.response?.usage || event.usage);
        if (closed || response.interrupted) return;
        if (response.status === 'failed') { fail(); return; }
        if (response.status !== 'completed') {
          response.interrupted = true;
          if (response === currentResponse) emit({ serverContent: { interrupted: true } });
          return;
        }
        // Register the whole terminal tool inventory before emitting any calls:
        // the relay may synchronously send outputs from inside its message handler.
        const functionCalls = [];
        for (const item of event.response?.output || []) {
          if (item.type === 'function_call') {
            const call = registerCall(response, item);
            if (call) functionCalls.push(call);
          }
        }
        if (functionCalls.length) emit({ toolCall: { functionCalls } });
        response.collecting = false;
        if (response.calls.size) continueResponse(response);
        else emit({ serverContent: { turnComplete: true } });
        return;
      }
      if (response.interrupted) return;
      if (event.type === 'response.function_call_arguments.done' || event.type === 'response.output_item.done') {
        const item = event.type === 'response.output_item.done' ? event.item : event;
        if (!item || (event.type === 'response.output_item.done' && item.type !== 'function_call')) return;
        const call = registerCall(response, item);
        if (call) emit({ toolCall: { functionCalls: [call] } });
        continueResponse(response);
        return;
      }
      if (response.status !== null) return;
      usage(event.usage);
      if (event.type === 'response.audio.delta' && typeof event.delta === 'string') {
        emit({ serverContent: { modelTurn: { parts: [{ inlineData: { data: event.delta, mimeType: 'audio/pcm;rate=24000' } }] } } });
      }
      if (['response.audio_transcript.delta', 'response.audio_transcript.done', 'response.text.delta', 'response.text.done'].includes(event.type)) {
        const final = event.type.endsWith('.done');
        const source = event.type.split('.')[1];
        caption(response.captions, JSON.stringify([event.item_id || event.output_index || 0, event.content_index || 0]),
          final ? event.transcript ?? event.text : event.delta, final, 'outputTranscription', source);
      }
    } catch { fail(); }
  };
  try {
    upstream = connect(config.endpoint, { headers: { Authorization: `Bearer ${env.QWEN_LIVE_API_KEY}` },
      handshakeTimeout: 10000, maxPayload: 1024 * 1024, followRedirects: false, perMessageDeflate: false });
    upstream.on('open', () => { if (!closed && !opened) { opened = true; connection.emit('open'); } });
    upstream.on('message', handle);
    upstream.on('error', fail);
    upstream.on('close', () => { if (finish()) connection.emit('close'); });
  } catch { queueMicrotask(fail); }
  return connection;
}

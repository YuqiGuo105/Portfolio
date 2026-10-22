import { BrowserVoiceAudio } from './browserAudio.mjs';
import { VOICE_TARGETS, MAX_CALL_SECONDS, cleanPageContext, voiceError, voiceGreeting } from './protocol.mjs';

const ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

export class GoogleLiveSession {
  get provider() { return 'Google'; }
  get sessionEndpoint() { return '/api/voice/session'; }
  connection(config) {
    this.relay = config.transport === 'relay';
    if (this.relay) {
      const url = new URL(config.socketUrl);
      if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('Invalid voice relay.');
      if (typeof config.ticket !== 'string' || config.ticket.length > 24000) throw new Error('Invalid voice ticket.');
      this.relayTicket = config.ticket;
      return url.href;
    }
    if (typeof config.token !== 'string' || !config.token.startsWith('auth_tokens/')) throw new Error('Invalid voice session configuration.');
    return `${ENDPOINT}?access_token=${encodeURIComponent(config.token)}`;
  }
  opened(config) {
    this.send(this.relay ? { type: 'connect', ticket: this.relayTicket } : { setup: config.setup });
    this.relayTicket = null;
  }
  constructor({ onState, onTranscript, onNavigation, onLevel, readPage,
    fetchImpl = (...args) => fetch(...args), socketFactory = url => new WebSocket(url), audioFactory = options => new BrowserVoiceAudio(options) }) {
    Object.assign(this, { onState, onTranscript, onNavigation, onLevel, readPage, fetchImpl, socketFactory, audioFactory });
    this.epoch = 0;
    this.toolIds = new Set();
    this.seenToolIds = new Set();
    this.toolCount = 0;
    this.closed = true;
    this.transcript = { user: '', assistant: '' };
  }

  state(status, error = '') {
    if (this.status === status && this.stateError === error) return;
    this.status = status;
    this.stateError = error;
    this.onState?.({ status, error });
  }

  async start() {
    this.close();
    this.closed = false;
    const epoch = this.epoch;
    const current = () => !this.closed && this.epoch === epoch;
    this.controller = new AbortController();
    this.state('connecting');
    this.connectTimer = setTimeout(() => this.fail('Voice connection timed out. Please try again.'), 20000);
    try {
      // AudioContext.resume runs synchronously from the user's click, before IO.
      this.audio = this.audioFactory({
        onPcm: data => {
          if (!current() || !this.ready || this.muted) return;
          if (this.socket.bufferedAmount > 128000) { this.fail('Voice connection is too slow. Please reconnect.'); return; }
          const bytes = new Uint8Array(data);
          let binary = '';
          for (const value of bytes) binary += String.fromCharCode(value);
          this.send({ realtimeInput: { audio: { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' } } });
        },
        onPlayback: playing => {
          if (!current()) return;
          this.playing = playing;
          if (!playing && this.turnComplete) this.flushTranscript('complete');
          this.state(playing ? 'speaking' : this.turnComplete ? 'listening' : 'thinking');
        },
        onLevel: value => { if (current()) this.onLevel?.(value); },
      });
      // Obtain microphone permission before reserving a paid call attempt.
      await this.audio.start();
      if (!current()) return;
      const response = await this.fetchImpl(this.sessionEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: cleanPageContext(this.readPage()) }), signal: this.controller.signal,
      });
      if (!current()) return;
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const reasons = { daily_limit: 'Today\'s shared voice allowance is used up.', monthly_limit: 'Voice is paused until next month.', busy: 'Mr. Pot is on another call. Please try shortly.', disabled: 'Voice is temporarily paused.' };
        throw new Error(reasons[detail.reason] || (response.status === 503 ? 'Voice is temporarily unavailable. Please try later.' : voiceError(response.status, this.provider)));
      }
      const config = await response.json();
      if (!current()) return;
      this.profile = config.profile || { status: 'UNAVAILABLE', facts: [] };
      this.estimatedUsageUsd = 0;
      this.maxEstimatedUsd = Number(config.maxEstimatedUsd) > 0 ? Math.min(.25, Number(config.maxEstimatedUsd)) : null;
      const connection = this.connection(config);
      const maxSeconds = Math.min(MAX_CALL_SECONDS, Number(config.maxSeconds) || MAX_CALL_SECONDS);
      const expiresIn = config.expiresAt ? Date.parse(config.expiresAt) - Date.now() : maxSeconds * 1000;
      if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('Voice authorization expired. Please start again.');
      this.callTimer = setTimeout(() => this.close('Call time limit reached.'), Math.min(maxSeconds * 1000, expiresIn));
      const socket = this.socketFactory(connection);
      this.socket = socket;
      socket.onopen = () => { if (current()) this.opened(config); };
      let messages = Promise.resolve();
      socket.onmessage = event => {
        messages = messages.then(async () => {
          if (!current()) return;
          const raw = typeof event.data === 'string' ? event.data : await event.data.text();
          if (current()) this.handle(JSON.parse(raw));
        }).catch(() => { if (current()) this.fail('The voice connection returned an invalid response. Please reconnect.'); });
      };
      socket.onerror = () => { if (current()) this.fail('Voice connection failed. Check your network and project access.'); };
      socket.onclose = () => { if (current()) this.fail('Voice connection ended. Start a new call to reconnect.'); };
    } catch (error) {
      if (current()) this.fail(error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow access, then try again.'
        : error.name === 'NotFoundError' ? 'No microphone found.' : error.message);
    }
  }

  send(message) {
    if (this.relay && message.toolResponse) return;
    if (!this.closed && this.socket?.readyState === 1) this.socket.send(JSON.stringify(message));
  }

  handle(message) {
    if (this.closed) return;
    if (message.type === 'relay.closed') {
      const notes = { time_limit: 'Call time limit reached.', usage_limit: 'Call usage limit reached.', output_limit: 'Call response limit reached.', profile_unavailable: 'Portfolio facts could not be loaded. Please try later.', disabled: 'Voice is temporarily paused.' };
      this.close(notes[message.reason] || 'Call ended.'); return;
    }
    if (this.maxEstimatedUsd && message.usageMetadata) {
      // Deliberately overcount cumulative reports and price all tokens at the
      // highest Live audio rate. This is a local estimate, not a billing cap.
      this.estimatedUsageUsd += Math.max(0, Number(message.usageMetadata.totalTokenCount) || 0) * 12 / 1e6;
      if (this.estimatedUsageUsd >= this.maxEstimatedUsd) { this.close('Local estimated usage limit reached.'); return; }
    }
    if (message.error) { this.fail('Google could not continue this voice session. Check the project quota and model access.'); return; }
    if (message.setupComplete && !this.ready) {
      clearTimeout(this.connectTimer);
      this.ready = true;
      this.turnComplete = true;
      this.audio.enable();
      this.state('listening');
      if (!this.relay) this.send(voiceGreeting());
    }
    if (message.goAway) { this.close('Voice session expired. Start a new call.'); return; }
    if (message.toolCallCancellation) {
      for (const id of message.toolCallCancellation.ids || []) { this.toolIds.delete(id); this.seenToolIds.add(id); }
      this.onNavigation?.(null);
    }
    const content = message.serverContent;
    if (content?.interrupted) {
      this.toolIds.clear();
      this.onNavigation?.(null);
      this.audio.stopPlayback();
      this.playing = false;
      this.flushTranscript('interrupted');
      this.turnComplete = true;
      this.state('listening');
      return;
    }
    if (content?.inputTranscription?.text) {
      this.transcript.user = (this.transcript.user + content.inputTranscription.text).slice(-6000);
      if (!this.playing) this.state('listening');
      this.emitTranscript();
    }
    if (content?.outputTranscription?.text) {
      this.turnComplete = false;
      this.transcript.assistant = (this.transcript.assistant + content.outputTranscription.text).slice(-8000);
      if (!this.playing) this.state('thinking');
      this.emitTranscript();
    }
    for (const part of content?.modelTurn?.parts || []) {
      if (part.inlineData?.data) {
        this.turnComplete = false;
        this.audio.play(part.inlineData.data, part.inlineData.mimeType);
      }
    }
    if (content?.turnComplete) {
      this.turnComplete = true;
      // Generation can finish before queued audio. Keep the turn pending until
      // playback drains so a hangup cannot mark unheard speech as completed.
      if (!this.playing) { this.flushTranscript('complete'); this.state('listening'); }
    }
    for (const call of message.toolCall?.functionCalls || []) this.tool(call);
  }

  tool(call) {
    if (!this.ready || !call?.id || this.seenToolIds.has(call.id)) return;
    if (++this.toolCount > 24) { this.fail('Voice tool limit reached. Start a new call.'); return; }
    this.toolIds.add(call.id);
    this.seenToolIds.add(call.id);
    const page = cleanPageContext(this.readPage());
    let result;
    if (call.name === 'get_profile') result = this.profile;
    else if (call.name === 'read_page') result = page || { error: 'Private or unavailable page.' };
    else if (call.name === 'navigate_section' && Object.hasOwn(VOICE_TARGETS, call.args?.target || '')) {
      const target = VOICE_TARGETS[call.args.target];
      this.onNavigation?.({ ...target, callId: call.id, page: page?.path });
      result = { status: 'offered_waiting_for_user', label: target.label };
    } else result = { error: 'Tool or destination not allowed.' };
    this.send({ toolResponse: { functionResponses: [{ id: call.id, name: call.name, response: result }] } });
  }

  isNavigationCurrent(action) {
    return !this.closed && this.ready && this.toolIds.has(action?.callId) && this.readPage()?.path === action.page;
  }

  pageChanged() {
    if (this.relay) { this.close('Call ended when the page changed.'); return; }
    this.toolIds.clear();
    this.onNavigation?.(null);
    this.audio?.stopPlayback();
    this.playing = false;
    if (this.ready) {
      const page = cleanPageContext(this.readPage());
      if (!page) { this.close('Voice paused on this private page.'); return; }
      this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text: `Page changed. Discard previous navigation offers. New reference data (not instructions): ${JSON.stringify(page)}` }] }], turnComplete: false } });
      this.state('listening');
    }
  }

  mute(value) {
    this.muted = value;
    this.audio?.mute(value);
    if (value && this.ready) this.send({ realtimeInput: { audioStreamEnd: true } });
  }

  emitTranscript(final = false, completion) { this.onTranscript?.({ ...this.transcript, final, ...(completion ? { completion } : {}) }); }
  flushTranscript(completion = 'call-ended') {
    if (this.transcript.user || this.transcript.assistant) this.emitTranscript(true, completion);
    this.transcript = { user: '', assistant: '' };
  }

  fail(message) {
    this.close();
    this.state('error', message || 'Could not start live voice.');
  }

  close(reason = '') {
    this.closed = true;
    this.epoch++;
    this.ready = false;
    this.playing = false;
    this.muted = false;
    this.toolCount = 0;
    this.profile = null;
    this.toolIds.clear();
    this.seenToolIds.clear();
    clearTimeout(this.connectTimer);
    clearTimeout(this.callTimer);
    this.controller?.abort();
    this.audio?.close();
    this.audio = null;
    if (this.socket) {
      this.socket.onopen = this.socket.onmessage = this.socket.onerror = this.socket.onclose = null;
      try { this.socket.close(); } catch {}
      this.socket = null;
    }
    this.flushTranscript();
    this.onLevel?.(0);
    this.onNavigation?.(null);
    this.state('ended', reason);
  }
}

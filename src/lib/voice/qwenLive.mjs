import { GoogleLiveSession } from './googleLive.mjs';
import { QWEN_SESSION_PATH, QWEN_SOCKET_PATH } from './qwenProtocol.mjs';

// Reuse microphone/playback, cancellation, navigation and transcript lifecycle.
// Only the provider wire protocol differs; Google is never called by this class.
export class QwenLiveSession extends GoogleLiveSession {
  get provider() { return 'Qwen'; }
  get sessionEndpoint() { return QWEN_SESSION_PATH; }
  callDurationMs(config) {
    if (process.env.NODE_ENV === 'development' && config.unlimitedLocal === true
      && config.maxSeconds === null && config.expiresAt === null
      && ['127.0.0.1', 'localhost', '[::1]'].includes(globalThis.location?.hostname)) return null;
    return super.callDurationMs(config);
  }
  connection(config) {
    if (!/^[a-f0-9]{64}$/.test(config.ticket || '') || config.socketPath !== QWEN_SOCKET_PATH) throw new Error('Invalid Qwen session configuration.');
    const origin = globalThis.location?.origin || 'http://127.0.0.1';
    const url = new URL(QWEN_SOCKET_PATH, origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.href;
  }
  opened(config) { this.raw({ type: 'connect', ticket: config.ticket }); }
  raw(message) { super.send(message); }
  send(message) {
    if (message.realtimeInput?.audio) this.raw({ type: 'input_audio_buffer.append', audio: message.realtimeInput.audio.data });
    if (message.realtimeInput?.audioStreamEnd) this.raw({ type: 'input_audio_buffer.clear' });
    for (const result of message.toolResponse?.functionResponses || []) {
      this.toolPending = true;
      this.raw({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: result.id, output: JSON.stringify(result.response) } });
    }
  }
  handle(event) {
    if (this.closed) return;
    if (event.type === 'error') {
      const errors = {
        model_not_activated: 'Alibaba Cloud Model Studio is not activated for this account. Complete activation in the Singapore console before trying again.',
        free_quota_exhausted: 'Qwen free quota is unavailable or exhausted. Check the account quota before trying again.',
      };
      this.fail(errors[event.error?.code] || 'Qwen voice could not continue. Check model access and quota in Model Studio.'); return;
    }
    if (event.type === 'session.updated') { super.handle({ setupComplete: {} }); return; }
    if (event.type === 'input_audio_buffer.speech_started') {
      this.interruptedResponse = this.responseId;
      this.toolPending = false;
      super.handle({ serverContent: { interrupted: true } });
      return;
    }
    if (event.type === 'input_audio_buffer.speech_stopped') { this.state('thinking'); return; }
    if (event.type === 'response.created') { this.responseId = event.response?.id; this.turnComplete = false; this.state('thinking'); return; }
    if (event.response_id && event.response_id === this.interruptedResponse) return;
    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      super.handle({ serverContent: { inputTranscription: { text: event.transcript || '' } } });
    }
    if (event.type === 'response.audio_transcript.delta') super.handle({ serverContent: { outputTranscription: { text: event.delta || '' } } });
    if (event.type === 'response.audio.delta') super.handle({ serverContent: { modelTurn: { parts: [{ inlineData: { data: event.delta, mimeType: 'audio/pcm;rate=24000' } }] } } });
    if (event.type === 'response.function_call_arguments.done') {
      let args;
      try { args = JSON.parse(event.arguments || '{}'); } catch { this.fail('Qwen returned invalid tool arguments.'); return; }
      super.handle({ toolCall: { functionCalls: [{ id: event.call_id, name: event.name, args }] } });
    }
    if (event.type === 'response.done') {
      if (event.response?.id === this.interruptedResponse) return;
      if (event.response?.status && event.response.status !== 'completed') {
        this.audio.stopPlayback(); this.playing = false;
        this.flushTranscript('interrupted'); this.turnComplete = true; this.state('listening');
      } else if (this.toolPending) {
        this.toolPending = false; this.raw({ type: 'response.create' });
      } else super.handle({ serverContent: { turnComplete: true } });
    }
  }
  pageChanged() { this.close('Page changed. Start a new call for the updated page.'); }
  close(reason = '') {
    this.responseId = null; this.interruptedResponse = null; this.toolPending = false;
    super.close(reason);
  }
}

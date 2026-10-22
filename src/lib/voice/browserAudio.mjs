export class BrowserVoiceAudio {
  constructor({ onPcm, onPlayback, onLevel, activation }) {
    if (activation?.error) throw activation.error;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext || !window.AudioWorkletNode || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not support live voice. Try Chrome or Safari over localhost or HTTPS.');
    }
    this.context = activation?.context || new AudioContext({ sampleRate: 16000 });
    this.resumed = activation?.resumed || this.context.resume();
    this.resumed.catch(() => {});
    this.onPcm = onPcm;
    this.onPlayback = onPlayback;
    this.onLevel = onLevel;
    this.sources = new Set();
    this.nextTime = 0;
    this.closed = false;
    this.muted = false;
    this.ready = false;
  }

  async start() {
    await this.resumed;
    if (this.closed) return;
    await this.context.audioWorklet.addModule('/voice/pcm-capture.worklet.js');
    if (this.closed) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    }, video: false });
    if (this.closed) { stream.getTracks().forEach(track => track.stop()); return; }
    this.stream = stream;
    this.input = this.context.createMediaStreamSource(stream);
    this.capture = new AudioWorkletNode(this.context, 'voice-pcm-capture');
    this.silent = this.context.createGain();
    this.silent.gain.value = 0;
    this.capture.port.onmessage = event => {
      if (!this.closed && this.ready && !this.muted) this.onPcm(event.data);
    };
    this.capture.port.postMessage({ enabled: false });
    this.input.connect(this.capture);
    this.capture.connect(this.silent);
    this.silent.connect(this.context.destination);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.connect(this.context.destination);
    const samples = new Float32Array(256);
    this.levelTimer = setInterval(() => {
      if (!this.sources.size) return;
      this.analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
      this.onLevel?.(Math.min(1, rms * 5));
    }, 80);
  }

  enable() {
    this.ready = true;
    this.capture?.port.postMessage({ enabled: !this.muted });
  }

  mute(value) {
    this.muted = value;
    this.stream?.getAudioTracks().forEach(track => { track.enabled = !value; });
    this.capture?.port.postMessage({ enabled: this.ready && !value });
  }

  play(base64, mime = 'audio/pcm;rate=24000') {
    if (this.closed || !this.analyser) return;
    if (!/^audio\/pcm(?:;|$)/.test(mime) || typeof base64 !== 'string' || base64.length > 1500000) throw new Error('Invalid voice audio.');
    const rate = Number(/rate=(\d+)/.exec(mime)?.[1] || 24000);
    if (![16000, 24000, 48000].includes(rate)) throw new Error('Unsupported voice sample rate.');
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    if (!bytes.length || bytes.length % 2) return;
    const view = new DataView(bytes.buffer);
    const buffer = this.context.createBuffer(1, bytes.length / 2, rate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < output.length; i++) output[i] = view.getInt16(i * 2, true) / 32768;
    const startAt = Math.max(this.context.currentTime + 0.02, this.nextTime);
    if (startAt + buffer.duration - this.context.currentTime > 20) throw new Error('Voice playback fell behind. Please reconnect.');
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    this.sources.add(source);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
      if (!this.sources.size && !this.closed) { this.onLevel?.(0); this.onPlayback(false); }
    };
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.onPlayback(true);
  }

  stopPlayback() {
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); source.disconnect(); } catch {}
    }
    this.sources.clear();
    this.nextTime = 0;
    this.onLevel?.(0);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stopPlayback();
    clearInterval(this.levelTimer);
    if (this.capture) {
      this.capture.port.onmessage = null;
      this.capture.port.close();
    }
    this.stream?.getTracks().forEach(track => track.stop());
    for (const node of [this.input, this.capture, this.silent, this.analyser]) {
      try { node?.disconnect(); } catch {}
    }
    this.context.close().catch(() => {});
  }
}

class VoicePcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(1600);
    this.offset = 0;
    this.phase = 0;
    this.total = 0;
    this.count = 0;
    this.enabled = false;
    this.port.onmessage = event => {
      this.enabled = event.data.enabled;
      this.offset = this.phase = this.total = this.count = 0;
    };
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel || !this.enabled) return true;
    // Average native-rate samples into 16 kHz PCM; messages are 100 ms batches.
    for (let i = 0; i < channel.length; i++) {
      this.total += channel[i];
      this.count++;
      this.phase += 16000;
      if (this.phase < sampleRate) continue;
      this.phase -= sampleRate;
      const value = Math.max(-1, Math.min(1, this.total / this.count));
      this.samples[this.offset++] = Math.round(value * (value < 0 ? 32768 : 32767));
      this.total = this.count = 0;
      if (this.offset === this.samples.length) {
        this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
        this.samples = new Int16Array(1600);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('voice-pcm-capture', VoicePcmCapture);

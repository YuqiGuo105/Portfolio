
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Loader2, X } from 'lucide-react';
import { MAX_RECORDING_MS, recordingToBase64 } from '../lib/dictationAudio.mjs';
import { DICTATION_MESSAGES } from '../lib/localAssistant.mjs';
import styles from './VoiceInput.module.css';

const errors = {
  NotAllowedError: 'Allow microphone access in your browser to dictate.',
  NotFoundError: 'No microphone found.',
  NotReadableError: 'Your microphone is being used by another application.',
};

const SAMPLE_MS = 55;      // one bar of the waveform
const BAR = 3, GAP = 3;    // CSS pixels
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// Loudness of the microphone right now, 0 to 1, or null when the browser cannot measure it.
function createMeter(stream) {
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    const context = new Context();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    context.resume?.().catch(() => {});
    return {
      read() {
        if (context.state !== 'running') return null;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const rms = Math.sqrt(sum / samples.length);
        // Speech sits around 0.02 to 0.2; the curve keeps quiet talkers visible.
        return Math.min(1, Math.max(0, (rms - 0.006) / 0.16) ** 0.6);
      },
      close() { try { source.disconnect(); } catch {} context.close().catch(() => {}); },
    };
  } catch {
    return null;
  }
}

export default function VoiceInput({ onInsert, onClose }) {
  const activeRef = useRef(null);
  const callbacksRef = useRef({ onInsert, onClose });
  callbacksRef.current = { onInsert, onClose };
  const canvasRef = useRef(null);
  const doneRef = useRef(null);
  const levelsRef = useRef([]);
  const [status, setStatus] = useState('starting');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');

  const dispose = useCallback(() => {
    const run = activeRef.current;
    activeRef.current = null;
    if (!run) return;
    clearTimeout(run.timeout);
    clearInterval(run.ticker);
    cancelAnimationFrame(run.frame);
    run.meter?.close();
    run.controller.abort();
    if (run.recorder) {
      run.recorder.ondataavailable = run.recorder.onstop = run.recorder.onerror = null;
      if (run.recorder.state !== 'inactive') { try { run.recorder.stop(); } catch {} }
    }
    run.stream?.getTracks().forEach(track => track.stop());
    run.chunks.length = 0;
  }, []);

  // The waveform scrolls right to left: each bar is the loudness of one short slice of speech.
  const draw = useCallback((run, now) => {
    const canvas = canvasRef.current;
    if (!canvas || activeRef.current !== run) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const levels = levelsRef.current;
    if (run.recorder?.state === 'recording' && now - run.sampledAt >= SAMPLE_MS) {
      const level = run.meter?.read();
      run.measured ||= level != null;
      run.peak = Math.max(level ?? 0, (run.peak || 0) * 0.6);
      levels.push(level == null ? 0 : run.peak);
      if (levels.length > 400) levels.splice(0, levels.length - 400);
      run.sampledAt = now;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = getComputedStyle(canvas).color;
    const step = BAR + GAP;
    const slide = run.recorder?.state === 'recording' && !run.still ? Math.min(1, (now - run.sampledAt) / SAMPLE_MS) * step : 0;
    for (let i = 0, x = width - BAR - slide; x > -BAR; i++, x -= step) {
      const level = levels[levels.length - 1 - i] || 0;
      const bar = Math.max(BAR, level * (height - 6));
      // Older speech fades toward the left edge.
      context.globalAlpha = (level ? 0.35 + 0.65 * Math.min(1, x / (width * 0.5)) : 0.22) * Math.min(1, (x + BAR) / 18);
      context.beginPath();
      if (context.roundRect) context.roundRect(x, (height - bar) / 2, BAR, bar, BAR / 2);
      else context.rect(x, (height - bar) / 2, BAR, bar);
      context.fill();
    }
    // Once recording stops the last frame stays on screen; nothing is left to animate.
    if (run.recorder?.state === 'recording') run.frame = requestAnimationFrame(time => draw(run, time));
  }, []);

  const start = useCallback(async () => {
    dispose();
    setError('');
    setSeconds(0);
    levelsRef.current = [];
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !(window.AudioContext || window.webkitAudioContext)) {
      setError('Voice input is unavailable here. Use a supported browser or type your message.');
      setStatus('error');
      return;
    }
    const run = { controller: new AbortController(), chunks: [], bytes: 0, sampledAt: 0,
      still: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches };
    activeRef.current = run;
    setStatus('starting');
    const fail = error => {
      if (activeRef.current !== run) return;
      dispose();
      setError(errors[error.name] || error.message || 'Could not transcribe. Please try again.');
      setStatus('error');
    };
    try {
      run.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (activeRef.current !== run) { run.stream.getTracks().forEach(track => track.stop()); return; }
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      run.recorder = new MediaRecorder(run.stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 });
      run.recorder.ondataavailable = event => {
        if (!event.data?.size || activeRef.current !== run) return;
        run.bytes += event.data.size;
        if (run.bytes > 3 * 1024 * 1024) { fail(new Error('Recording is too large. Try a shorter message.')); return; }
        run.chunks.push(event.data);
      };
      run.recorder.onerror = () => fail(new Error('Recording failed. Please try again.'));
      run.recorder.onstop = async () => {
        if (activeRef.current !== run) return;
        run.stream.getTracks().forEach(track => track.stop());
        run.meter?.close();
        clearTimeout(run.timeout);
        clearInterval(run.ticker);
        setStatus('transcribing');
        run.timeout = setTimeout(() => fail(new Error('Transcription timed out. Please try again.')), 60000);
        try {
          const blob = new Blob(run.chunks, { type: run.recorder.mimeType });
          run.chunks.length = 0;
          const audio = await recordingToBase64(blob, run.controller.signal);
          const response = await fetch('/api/rag/transcribe', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio }), signal: run.controller.signal,
          });
          const result = await response.json();
          if (!response.ok) throw new Error(DICTATION_MESSAGES[result.code] || (response.status === 429 ? 'Voice input is temporarily limited. Please try later or type your message.' : 'The transcription service is unavailable. Please try again later.'));
          if (activeRef.current !== run) return;
          const text = typeof result.text === 'string' ? result.text.trim() : '';
          if (!text) throw new Error('No speech detected. Please try again.');
          dispose();
          callbacksRef.current.onInsert(text);
          callbacksRef.current.onClose();
        } catch (error) { fail(error); }
      };
      run.recorder.start(250);
      run.meter = createMeter(run.stream);
      setStatus('recording');
      const started = Date.now();
      run.ticker = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
      run.timeout = setTimeout(() => { if (run.recorder.state === 'recording') run.recorder.stop(); }, MAX_RECORDING_MS);
      run.frame = requestAnimationFrame(time => draw(run, time));
    } catch (error) { fail(error); }
  }, [dispose, draw]);

  const stop = useCallback(() => {
    const run = activeRef.current;
    if (run?.recorder?.state !== 'recording') return;
    setStatus('transcribing');
    run.recorder.stop();
  }, []);

  const cancel = useCallback(() => { dispose(); callbacksRef.current.onClose(); }, [dispose]);

  useEffect(() => {
    start();
    return dispose;
  }, [start, dispose]);

  // Enter finishes and Escape cancels from anywhere, without the visitor finding a button first.
  useEffect(() => {
    const onKey = event => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
      else if (event.key === 'Enter' && !event.target.closest?.('button, a, input, textarea, select, [contenteditable="true"]')) {
        event.preventDefault();
        stop();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cancel, stop]);

  useEffect(() => {
    if (status === 'recording' || status === 'error') doneRef.current?.focus({ preventScroll: true });
  }, [status]);

  const failed = status === 'error';
  const left = Math.max(0, Math.ceil(MAX_RECORDING_MS / 1000) - seconds);
  const closing = status === 'recording' && left <= 10;
  return <section className={`cw-voice ${styles.voice}`} data-state={status} aria-label="Voice input">
    <div className={styles.field}>
      <button type="button" className={styles.cancel} title="Cancel (Esc)" aria-label="Cancel voice input" onClick={cancel}><X size={18} aria-hidden="true" /></button>
      {failed
        ? <p className={styles.error} role="alert"><CircleAlert size={16} aria-hidden="true" /><span>{error}</span></p>
        : <div className={styles.stage}>
          <canvas ref={canvasRef} className={styles.wave} aria-hidden="true" />
          {status !== 'recording' && <span className={styles.note} role="status">{status === 'starting' ? 'Waiting for the microphone…' : 'Turning speech into text…'}</span>}
          {status === 'recording' && <span className={styles.srOnly} role="status">Listening</span>}
        </div>}
      {status === 'recording' && <time className={styles.time} data-closing={closing || undefined}
        aria-label={closing ? `${left} seconds left` : 'Recording time'}>{closing ? `${left}s left` : clock(seconds)}</time>}
      <button ref={doneRef} type="button" className={styles.done} disabled={status === 'starting' || status === 'transcribing'}
        title={failed ? undefined : 'Finish and turn the recording into text (Enter)'} onClick={failed ? start : stop}>
        {failed ? 'Try again' : status === 'transcribing' || status === 'starting'
          ? <><Loader2 size={16} className={styles.spin} aria-hidden="true" /><span className={styles.srOnly}>Please wait</span></>
          : <><Check size={16} strokeWidth={2.4} aria-hidden="true" />Done</>}
      </button>
    </div>
    {!failed && <p className={styles.hint}>
      {status === 'transcribing' ? 'The text will appear in the message box for you to check before sending.'
        : <><span className={styles.keys}>Speak in any language. Press Enter when you are done, Esc to cancel.</span>
          <span className={styles.touch}>Speak in any language, then tap Done.</span></>}
    </p>}
  </section>;
}

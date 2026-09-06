import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Check, Loader2, Mic, X } from 'lucide-react';
import { MAX_RECORDING_MS, recordingToBase64 } from '../lib/dictationAudio.mjs';

const errors = {
  NotAllowedError: 'Allow microphone access in your browser to dictate.',
  NotFoundError: 'No microphone found.',
  NotReadableError: 'Your microphone is being used by another application.',
};

export default function VoiceInput({ onInsert, onClose }) {
  const activeRef = useRef(null);
  const callbacksRef = useRef({ onInsert, onClose });
  callbacksRef.current = { onInsert, onClose };
  const [status, setStatus] = useState('starting');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');

  const dispose = useCallback(() => {
    const run = activeRef.current;
    activeRef.current = null;
    if (!run) return;
    clearTimeout(run.timeout);
    clearInterval(run.ticker);
    run.controller.abort();
    if (run.recorder) {
      run.recorder.ondataavailable = run.recorder.onstop = run.recorder.onerror = null;
      if (run.recorder.state !== 'inactive') { try { run.recorder.stop(); } catch {} }
    }
    run.stream?.getTracks().forEach(track => track.stop());
    run.chunks.length = 0;
  }, []);

  const start = useCallback(async () => {
    dispose();
    setError('');
    setSeconds(0);
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !(window.AudioContext || window.webkitAudioContext)) {
      setError('Voice input is unavailable here. Use a supported browser or type your message.');
      setStatus('error');
      return;
    }
    const run = { controller: new AbortController(), chunks: [], bytes: 0 };
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
          if (!response.ok) throw new Error(response.status === 429 ? 'Voice input is temporarily limited. Please try later or type your message.' : 'Could not transcribe. Please try again.');
          const result = await response.json();
          if (activeRef.current !== run) return;
          const text = typeof result.text === 'string' ? result.text.trim() : '';
          if (!text) throw new Error('No speech detected. Please try again.');
          dispose();
          callbacksRef.current.onInsert(text);
          callbacksRef.current.onClose();
        } catch (error) { fail(error); }
      };
      run.recorder.start(250);
      setStatus('recording');
      const started = Date.now();
      run.ticker = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
      run.timeout = setTimeout(() => { if (run.recorder.state === 'recording') run.recorder.stop(); }, MAX_RECORDING_MS);
    } catch (error) { fail(error); }
  }, [dispose]);

  const stop = () => {
    const run = activeRef.current;
    if (run?.recorder?.state !== 'recording') return;
    setStatus('transcribing');
    run.recorder.stop();
  };

  useEffect(() => {
    start();
    return dispose;
  }, [start, dispose]);

  const waiting = status === 'starting' || status === 'transcribing';
  const failed = status === 'error';
  return <section className="dictation" aria-label="Voice input">
    <div className="recording-row">
      <button type="button" title="Cancel recording" aria-label="Cancel recording" onClick={() => { dispose(); onClose(); }}><X size={18} /></button>
      <div className="recording-status" role="status" title="Auto-detected languages. Audio is sent to Google Gemini for transcription and is not saved by this site.">
        {waiting ? <Loader2 size={19} className="spinner" /> : <AudioLines size={22} className={failed ? '' : 'listening'} />}
        <span>{status === 'starting' ? 'Connecting...' : status === 'transcribing' ? 'Transcribing...' : failed ? 'Voice input paused' : 'Recording'}</span>
      </div>
      {!failed && <time aria-label="Recording duration">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</time>}
      <button className="complete" type="button" disabled={waiting} title={failed ? 'Try recording again' : 'Finish recording'} aria-label={failed ? 'Try recording again' : 'Finish recording'} onClick={failed ? start : stop}>
        {failed ? <Mic size={18} /> : <Check size={19} />}
      </button>
    </div>
    {error && <p role="alert">{error}</p>}
    <style jsx>{`
      .dictation { padding:6px 0; color:var(--cw-input-text,#202b32); }
      .recording-row { display:flex; align-items:center; gap:10px; min-height:44px; }
      .recording-status { display:flex; align-items:center; gap:8px; flex:1; min-width:0; font-size:13px; }
      .recording-status span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      time { flex:none; font:12px ui-monospace,monospace; font-variant-numeric:tabular-nums; opacity:.7; }
      button { display:grid; place-items:center; flex:0 0 36px; width:36px; height:36px; padding:0; border:1px solid var(--cw-input-border,#cbd5e1); border-radius:50%; background:transparent; color:inherit; cursor:pointer; }
      button.complete { background:var(--cw-input-text,#202b32); color:var(--cw-input-bg,#fff); border-color:transparent; }
      button:disabled { opacity:.45; cursor:default; }
      button::before, button::after { display:none!important; }
      p { margin:6px 0 2px; font-size:12px; line-height:1.45; }
      .dictation :global(.spinner) { animation:rotate 1s linear infinite; }
      .dictation :global(.listening) { animation:pulse 1.1s ease-in-out infinite alternate; }
      @keyframes rotate { to { transform:rotate(360deg); } }
      @keyframes pulse { to { opacity:.35; } }
      @media(prefers-reduced-motion:reduce) { .dictation :global(.spinner), .dictation :global(.listening) { animation:none; } }
    `}</style>
  </section>;
}

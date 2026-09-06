import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Check, Loader2, Mic, X } from 'lucide-react';

const errors = {
  'not-allowed': 'Allow microphone access in your browser to dictate.',
  'service-not-allowed': 'Speech recognition is unavailable in this browser.',
  'audio-capture': 'No microphone found.',
  'no-speech': 'No speech detected. Try again.',
  network: 'Could not transcribe. Check your connection and try again.',
  'language-not-supported': 'Your browser does not support this recognition language.',
};

export default function VoiceInput({ onInsert, onClose }) {
  const recognitionRef = useRef(null);
  const transcriptRef = useRef('');
  const timeoutRef = useRef(null);
  const elapsedRef = useRef(null);
  const callbacksRef = useRef({ onInsert, onClose });
  callbacksRef.current = { onInsert, onClose };
  const [status, setStatus] = useState('starting');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');

  const dispose = useCallback(() => {
    clearTimeout(timeoutRef.current);
    clearInterval(elapsedRef.current);
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onresult = recognition.onend = recognition.onerror = recognition.onstart = null;
      try { recognition.abort(); } catch {}
    }
  }, []);

  const finish = useCallback(() => {
    if (!recognitionRef.current) return;
    const text = transcriptRef.current.trim();
    dispose();
    if (text) {
      callbacksRef.current.onInsert(text);
      callbacksRef.current.onClose();
    } else {
      setError('No speech detected. Try again.');
      setStatus('error');
    }
  }, [dispose]);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    setStatus('transcribing');
    clearTimeout(timeoutRef.current);
    clearInterval(elapsedRef.current);
    // Wait for final recognition results before committing the draft.
    timeoutRef.current = setTimeout(finish, 3000);
    try { recognition.stop(); } catch { finish(); }
  }, [finish]);

  const start = useCallback(() => {
    dispose();
    transcriptRef.current = '';
    setError('');
    setSeconds(0);
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setError('Voice input is unavailable here. Use a supported browser or type your message.');
      setStatus('error');
      return;
    }
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    // Omitting lang uses the browser's configured recognition language.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    setStatus('starting');
    recognition.onstart = () => {
      setStatus('recording');
      const started = Date.now();
      elapsedRef.current = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    };
    recognition.onresult = event => {
      transcriptRef.current = Array.from(event.results, result => result[0]?.transcript || '').join(' ').trim().slice(0, 5000);
    };
    recognition.onend = finish;
    recognition.onerror = event => {
      dispose();
      setError(errors[event.error] || 'Could not transcribe. Please try again.');
      setStatus('error');
    };
    timeoutRef.current = setTimeout(stop, 60000);
    try { recognition.start(); } catch {
      dispose();
      setError('Could not start the microphone. Try again.');
      setStatus('error');
    }
  }, [dispose, finish, stop]);

  useEffect(() => {
    start();
    return dispose;
  }, [start, dispose]);

  const waiting = status === 'starting' || status === 'transcribing';
  const failed = status === 'error';
  return <section className="dictation" aria-label="Voice input">
    <div className="recording-row">
      <button type="button" title="Cancel recording" aria-label="Cancel recording" onClick={() => { dispose(); onClose(); }}><X size={18} /></button>
      <div className="recording-status" role="status">
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

import { useEffect, useRef, useState } from 'react';
import { Mic, Square, X, Check, Loader2 } from 'lucide-react';

const errors = {
  'not-allowed': 'Microphone access was denied. Allow it in your browser settings.',
  'service-not-allowed': 'Speech recognition is not permitted by this browser.',
  'audio-capture': 'No microphone is available.',
  'no-speech': 'No speech detected. Please try again.',
  network: 'Speech recognition could not connect. Please try again.',
  'language-not-supported': 'This recognition language is not supported.',
};

export default function VoiceInput({ onInsert, onClose }) {
  const recognitionRef = useRef(null);
  const timerRef = useRef(null);
  const [supported, setSupported] = useState(null);
  const [language, setLanguage] = useState('en-US');
  const [status, setStatus] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const busy = status === 'starting' || status === 'listening' || status === 'stopping';

  function dispose() {
    clearTimeout(timerRef.current);
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onresult = recognition.onend = recognition.onerror = recognition.onstart = null;
      try { recognition.abort(); } catch {}
    }
  }

  useEffect(() => {
    setSupported(Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));
    setLanguage(navigator.language?.startsWith('zh') ? 'zh-CN' : 'en-US');
    return dispose;
  }, []);

  function stop() {
    if (!recognitionRef.current) return;
    setStatus('stopping');
    clearTimeout(timerRef.current);
    try { recognitionRef.current.stop(); } catch { dispose(); setStatus('idle'); }
    // Release the microphone even if a browser never delivers its final event.
    timerRef.current = setTimeout(() => { dispose(); setStatus('idle'); }, 3000);
  }

  function start() {
    if (recognitionRef.current) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    setError('');
    setTranscript('');
    setStatus('starting');
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setStatus('listening');
    recognition.onresult = event => {
      setTranscript(Array.from(event.results, result => result[0]?.transcript || '').join(' ').trim().slice(0, 5000));
    };
    recognition.onerror = event => {
      setError(errors[event.error] || 'Speech recognition stopped. Please try again.');
      dispose();
      setStatus('idle');
    };
    recognition.onend = () => { dispose(); setStatus('idle'); };
    try {
      recognition.start();
      timerRef.current = setTimeout(stop, 60000);
    } catch {
      dispose();
      setStatus('idle');
      setError('Could not start the microphone. Please try again.');
    }
  }

  return <section className="voice-panel" role="region" aria-label="Voice input">
    <header>
      <strong>Voice input</strong>
      <select aria-label="Recognition language" value={language} disabled={busy} onChange={e => setLanguage(e.target.value)}>
        <option value="en-US">English</option><option value="zh-CN">中文</option>
      </select>
      <button type="button" title="Close voice input" aria-label="Close voice input" onClick={() => { dispose(); onClose(); }}><X size={18} /></button>
    </header>
    <p className="privacy">Your browser may process audio through its speech provider. This site does not store recordings.</p>
    {supported === false && <p role="status">Voice input is unavailable in this browser. Try Chrome or Safari, or type your message.</p>}
    {error && <p role="alert">{error}</p>}
    <textarea aria-label="Voice transcript" value={transcript} disabled={busy} onChange={e => setTranscript(e.target.value)} placeholder={busy ? 'Listening...' : 'Transcript'} rows={3} />
    <footer>
      <span role="status">{busy ? (status === 'starting' ? 'Connecting microphone...' : status === 'stopping' ? 'Finishing...' : 'Listening...') : 'Not recording'}</span>
      <button type="button" disabled={!supported || status === 'stopping'} title={busy ? 'Stop recording' : 'Start recording'} aria-label={busy ? 'Stop recording' : 'Start recording'} onClick={busy ? stop : start}>
        {status === 'starting' ? <Loader2 size={18} /> : busy ? <Square size={18} /> : <Mic size={18} />}
      </button>
      <button type="button" disabled={busy || !transcript.trim()} title="Insert transcript" aria-label="Insert transcript" onClick={() => { dispose(); onInsert(transcript.trim()); onClose(); }}><Check size={18} /></button>
    </footer>
    <style jsx>{`
      .voice-panel { margin-bottom:12px; padding:12px; border:1px solid var(--cw-input-border,#cbd5e1); border-radius:8px; background:var(--cw-input-bg,#fff); color:var(--cw-input-text,#202b32); }
      header, footer { display:flex; align-items:center; gap:8px; }
      header strong, footer span { flex:1; min-width:0; font-size:13px; }
      select { max-width:110px; font-size:13px; background:inherit; color:inherit; }
      button { display:grid; place-items:center; flex:0 0 36px; width:36px; height:36px; padding:0; border:1px solid var(--cw-input-border,#cbd5e1); border-radius:6px; background:transparent; color:inherit; cursor:pointer; }
      button:disabled { opacity:.45; cursor:default; }
      button::before, button::after { display:none!important; }
      p { margin:8px 0; font-size:12px; line-height:1.45; }
      .privacy { opacity:.8; }
      textarea { box-sizing:border-box; width:100%; resize:vertical; min-height:72px; max-height:140px; padding:8px; margin:6px 0; background:transparent; color:inherit; border:1px solid var(--cw-input-border,#cbd5e1); border-radius:6px; font-family:inherit; font-size:16px; line-height:1.4; }
    `}</style>
  </section>;
}

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import { ArrowUpRight, Check, ChevronDown, Loader2, Maximize2, MessageSquareText, Mic, MicOff, Minus, Phone, PhoneOff, X } from 'lucide-react';
import VoiceCallStage from './VoiceCallStage';
import { GoogleLiveSession } from '../lib/voice/googleLive.mjs';
import { QwenLiveSession } from '../lib/voice/qwenLive.mjs';
import { readVoicePage } from '../lib/voice/pageContext.mjs';
import { VOICE_TARGETS } from '../lib/voice/protocol.mjs';
import styles from './LiveVoiceCall.module.css';

const LABELS = { ready: 'Ready when you are', connecting: 'Connecting', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', ended: 'Call ended', error: 'Voice unavailable' };
const END_LABELS = { interrupted: 'Interrupted', 'call-ended': 'Call ended before this reply finished' };
const UNAVAILABLE = { daily_limit: 'Today\'s shared voice allowance is used up. Please return tomorrow.', monthly_limit: 'Voice is paused until next month to keep usage within budget.', busy: 'Mr. Pot is on another call. Please try shortly.', disabled: 'Voice is temporarily paused.', unavailable: 'Voice is temporarily unavailable. Please try later.', trial_ended: 'The approved local voice trial has ended.' };

export default function LiveVoiceCall({ onClose, onStateChange }) {
  const router = useRouter();
  const session = useRef(null);
  const meter = useRef(null);
  const captions = useRef(null);
  const dialog = useRef(null);
  const sceneLevel = useRef(null);
  const startedAt = useRef(0);
  const callbacks = useRef({ onStateChange });
  callbacks.current = { onStateChange };
  const [state, setState] = useState({ status: 'ready', error: '' });
  const [muted, setMuted] = useState(false);
  const [history, setHistory] = useState([]);
  const [partial, setPartial] = useState({ user: '', assistant: '' });
  const [navigation, setNavigation] = useState(null);
  const [config, setConfig] = useState(null);
  const [provider, setProvider] = useState('google');
  const [elapsed, setElapsed] = useState(0);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const active = ['connecting', 'listening', 'thinking', 'speaking'].includes(state.status);
  const connected = ['listening', 'thinking', 'speaking'].includes(state.status);

  useEffect(() => {
    dialog.current.querySelector('[aria-label="Close voice"]').focus();
  }, []);

  useEffect(() => {
    if (!connected) return;
    if (!startedAt.current) startedAt.current = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [connected]);

  useEffect(() => {
    if (active) return;
    const controller = new AbortController();
    setConfig(null);
    fetch(provider === 'qwen' ? '/api/voice/qwen/session' : '/api/voice/session', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Voice configuration unavailable');
      const value = await response.json();
      if (!controller.signal.aborted) setConfig(value);
    }).catch(() => { if (!controller.signal.aborted) setConfig({ configured: false, reason: 'unavailable' }); });
    return () => controller.abort();
  }, [provider, active]);

  useEffect(() => {
    const pageChanged = () => session.current?.pageChanged();
    const pageHidden = () => {
      if (document.visibilityState === 'hidden') session.current?.close('Call ended when the page became hidden.');
    };
    const pageExit = () => session.current?.close();
    router.events.on('routeChangeComplete', pageChanged);
    document.addEventListener('visibilitychange', pageHidden);
    window.addEventListener('pagehide', pageExit);
    return () => {
      const call = session.current;
      session.current = null;
      call?.close();
      callbacks.current.onStateChange?.('idle');
      router.events.off('routeChangeComplete', pageChanged);
      document.removeEventListener('visibilitychange', pageHidden);
      window.removeEventListener('pagehide', pageExit);
    };
  }, [router.events]);

  useEffect(() => {
    if (captions.current) captions.current.scrollTop = captions.current.scrollHeight;
  }, [history, partial]);

  const start = () => {
    session.current?.close();
    setMuted(false);
    startedAt.current = 0;
    setElapsed(0);
    setHistory([]);
    setPartial({ user: '', assistant: '' });
    const Session = provider === 'qwen' ? QwenLiveSession : GoogleLiveSession;
    const call = new Session({
      readPage: () => readVoicePage(),
      onState: next => {
        if (session.current !== call) return;
        setState(next);
        callbacks.current.onStateChange?.(['listening', 'thinking', 'speaking'].includes(next.status) ? next.status : next.status === 'connecting' ? 'thinking' : 'idle');
      },
      onLevel: value => {
        if (meter.current) meter.current.style.setProperty('--voice-level', String(value));
        sceneLevel.current?.(value);
      },
      onTranscript: turn => {
        if (session.current !== call) return;
        if (turn.final) {
          setHistory(previous => [...previous, turn].slice(-24));
          setPartial({ user: '', assistant: '' });
        } else setPartial(turn);
      },
      onNavigation: value => { if (session.current === call) setNavigation(value); },
    });
    session.current = call;
    call.start();
  };

  const navigate = async () => {
    if (!session.current?.isNavigationCurrent(navigation)) { setNavigation(null); return; }
    if (!Object.values(VOICE_TARGETS).some(target => target.href === navigation.href)) return;
    const href = navigation.href;
    setNavigation(null);
    session.current.close();
    onClose();
    await router.push(href);
    document.getElementById(href.split('#')[1])?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  };

  const close = () => { session.current?.close(); onClose(); };
  const turns = [...history, partial].filter(turn => turn.user || turn.assistant);
  const time = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  return createPortal(<section ref={dialog} role="dialog" className={styles.call} aria-modal="false" aria-label="Live voice call" data-no-voice data-status={state.status} data-collapsed={collapsed}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (transcriptOpen) setTranscriptOpen(false); else close(); }
    }}>
    <header className={styles.header}>
      <div className={styles.identity}><h2>Mr. Pot<span>.</span></h2><span className={styles.kicker}>{collapsed ? LABELS[state.status] : 'VOICE CALL'}</span></div>
      <div className={styles.headerActions}>
        {active ? <span className={styles.timer}>{time}</span> : <select className={styles.provider} aria-label="Voice provider" value={provider} onChange={event => {
          session.current?.close(); session.current = null;
          setConfig(null); setProvider(event.target.value); setState({ status: 'ready', error: '' });
          setElapsed(0); startedAt.current = 0; setHistory([]); setPartial({ user: '', assistant: '' }); setNavigation(null);
        }}><option value="google">Google</option>{process.env.NODE_ENV === 'development' && <option value="qwen">Qwen</option>}</select>}
        <button type="button" title={collapsed ? 'Expand call' : 'Minimize call'} aria-label={collapsed ? 'Expand call' : 'Minimize call'} onClick={() => setCollapsed(value => !value)}>{collapsed ? <Maximize2 size={17} /> : <Minus size={18} />}</button>
        <button type="button" title="Close voice" aria-label="Close voice" onClick={close}><X size={22} /></button>
      </div>
    </header>
    <VoiceCallStage status={state.status} level={sceneLevel} visible={!collapsed && !transcriptOpen} />
    <section className={styles.conversation}>
      <div className={styles.status} role="status">
        {state.status === 'connecting' ? <Loader2 size={18} className={styles.spinner} /> : state.status === 'ended' ? <Check size={18} /> :
          <span ref={meter} className={styles.meter} aria-hidden="true"><i /><i /><i /><i /><i /></span>}
        <span>{muted && active ? 'Mic muted' : LABELS[state.status]}</span>
      </div>
      {state.error && <p className={styles.error} role="alert">{state.error}</p>}
      {config && !config.configured && <p className={styles.error}>{provider === 'qwen'
        ? config.reason === 'trial_ended' ? 'Qwen local trial has ended.' : 'Qwen is not available in this local preview. Select Google to try voice.'
        : UNAVAILABLE[config.reason] || 'Voice is temporarily unavailable. Please try later.'}</p>}
      {turns.length > 0 && !transcriptOpen && <div className={styles.latest} aria-live="off">
        {turns.at(-1).user && <p className={styles.userCaption}>{turns.at(-1).user}</p>}
        {turns.at(-1).assistant && <p className={styles.assistantCaption}>{turns.at(-1).assistant}</p>}
        {END_LABELS[turns.at(-1).completion] && <p className={styles.turnNote}>{END_LABELS[turns.at(-1).completion]}</p>}
      </div>}
      {navigation && <button type="button" className={styles.destination} onClick={navigate}><span>{navigation.label}</span><ArrowUpRight size={16} /></button>}
    </section>
    {transcriptOpen && <aside className={styles.transcript} aria-label="Call transcript">
      <div className={styles.transcriptHeader}><h3>Conversation</h3><button type="button" title="Collapse transcript" aria-label="Collapse transcript" onClick={() => setTranscriptOpen(false)}><ChevronDown size={20} /></button></div>
      <div ref={captions} className={styles.captions} role="log" aria-label="Voice captions" aria-live="off">
        {turns.map((turn, index) => <div key={index}>
          {turn.user && <p><strong>You</strong>{turn.user}</p>}
          {turn.assistant && <p><strong>Mr. Pot</strong>{turn.assistant}</p>}
          {END_LABELS[turn.completion] && <p className={styles.turnNote}>{END_LABELS[turn.completion]}</p>}
        </div>)}
      </div>
    </aside>}
    <footer className={styles.footer}>
      <div className={styles.controls}>
        {active && <button type="button" className={styles.secondary} title={muted ? 'Unmute microphone' : 'Mute microphone'} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={muted} disabled={state.status === 'connecting'} onClick={() => {
          session.current?.mute(!muted); setMuted(!muted);
        }}>{muted ? <MicOff size={22} /> : <Mic size={22} />}</button>}
        {active ? <button type="button" className={styles.hangup} title="End call" aria-label="End call" onClick={() => session.current?.close()}><PhoneOff size={23} /></button>
          : <button type="button" className={styles.start} title="Start voice call" aria-label="Start voice call" disabled={!config?.configured} onClick={start}><Phone size={20} /><span>{elapsed ? 'Call again' : 'Start call'}</span></button>}
        <button type="button" className={styles.secondary} title="Show transcript" aria-label="Show transcript" aria-pressed={transcriptOpen} disabled={!turns.length} onClick={() => setTranscriptOpen(value => !value)}><MessageSquareText size={21} /></button>
      </div>
    </footer>
  </section>, document.body);
}

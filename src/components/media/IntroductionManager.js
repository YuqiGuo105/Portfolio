import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Film, Plus, RefreshCw, Upload, X } from 'lucide-react';
import { writerApi } from '../../lib/writerApi';
import { uploadMedia } from '../../lib/media/upload.mjs';
import { mediaPoster } from '../../lib/media/library.mjs';
import { validJobId, pendingPresentationJob, canUploadPresentation, presentationJobLabel,
  presentationJobMessage, presentationUploadApi } from '../../lib/media/presentationJobs.mjs';
import styles from './IntroductionManager.module.css';

const BASE_URL = process.env.NEXT_PUBLIC_MEDIA_BASE_URL || '';

export default function IntroductionManager({ jobId = null, onSelect, api = writerApi.media }) {
  const [current, setCurrent] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [job, setJob] = useState(null);
  const [asset, setAsset] = useState(null);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('Yuqi Guo introduction');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(null);
  const controller = useRef(null);
  const mounted = useRef(true);
  const requestId = useRef(null);
  const refreshing = useRef(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    const version = generation.current;
    refreshing.current = true;
    try {
      const nextCurrent = await api.presentation();
      const nextJobs = await api.presentationJobs();
      const selected = validJobId(jobId) ? await api.presentationJob(jobId) : null;
      const nextAsset = nextCurrent.assetId ? await api.get(nextCurrent.assetId) : null;
      if (mounted.current && version === generation.current) {
        setCurrent(nextCurrent); setJobs(nextJobs); setJob(selected); setAsset(nextAsset); setError('');
      }
    } catch (err) { if (mounted.current && version === generation.current) setError(err.message); }
    finally { refreshing.current = false; if (mounted.current && version === generation.current) setLoading(false); }
  }, [api, jobId]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    generation.current += 1;
    setJob(null); setFile(null); setLoading(true);
    // A previous selection's refresh cannot populate the new selection.
    const timer = setTimeout(refresh, 0);
    return () => clearTimeout(timer);
  }, [refresh]);
  const pending = pendingPresentationJob(job);
  useEffect(() => {
    if (!pending) return undefined;
    let active = true, running = false;
    const poll = async () => {
      if (document.hidden || running || controller.current) return;
      running = true;
      try {
        const next = await api.presentationJob(jobId);
        if (!active) return;
        setJob(next);
        if (!pendingPresentationJob(next)) await refresh();
      } catch (err) { if (active) setError(err.message); }
      finally { running = false; }
    };
    const timer = setInterval(poll, 4000);
    document.addEventListener('visibilitychange', poll);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', poll); };
  }, [api, jobId, pending, refresh]);

  const prepare = async () => {
    if (busy) return;
    setBusy(true); setError('');
    requestId.current ||= crypto.randomUUID();
    try {
      const next = await api.preparePresentationJob({ requestId: requestId.current, placementKey: 'yuqi-intro', title });
      requestId.current = null;
      if (mounted.current) { setJob(next); setJobs(items => [next, ...items.filter(item => item.id !== next.id)]); onSelect(next.id); }
    } catch (err) { if (mounted.current) setError(err.message); }
    finally { if (mounted.current) setBusy(false); }
  };
  const upload = async () => {
    if (!file || busy || !canUploadPresentation(job)) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setProgress(0);
    try {
      await uploadMedia(file, { api: presentationUploadApi(api, job.id), signal: abort.signal,
        onProgress: value => { if (mounted.current) setProgress(value); } });
      if (mounted.current) setFile(null);
      await refresh();
    } catch (err) {
      if (mounted.current) setError(abort.signal.aborted ? 'Upload paused. Select the same file to resume.' : err.message);
    } finally { controller.current = null; if (mounted.current) { setBusy(false); setProgress(null); } }
  };
  const cancel = async () => {
    if (busy || !job) return;
    setBusy(true); setError('');
    try { await api.cancelPresentationJob(job.id); await refresh(); }
    catch (err) { if (mounted.current) setError(err.message); }
    finally { if (mounted.current) setBusy(false); }
  };
  const poster = asset && mediaPoster(asset, BASE_URL);

  return <main className={styles.root}>
    <Link href="/admin/media"><a className={styles.back}><ArrowLeft size={16} />Media library</a></Link>
    <header className={styles.header}><div><p className={styles.eyebrow}>HOMEPAGE VIDEO</p><h1>Introduction</h1></div>
      <button type="button" onClick={refresh} disabled={loading || busy} title="Refresh status" aria-label="Refresh status"><RefreshCw size={18} /></button></header>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {loading ? <p role="status">Loading Introduction...</p> : <>
      <section className={styles.current} aria-label="Current Introduction">
        {poster ? <img src={poster} alt="Current Introduction poster" /> : <span className={styles.poster}><Film size={28} /></span>}
        <div><span className={styles.label}>{current?.enabled ? 'CURRENT VIDEO' : 'NO ACTIVE VIDEO'}</span><h2>{current?.presentation?.title || 'Introduction'}</h2>
          {asset && <p>{asset.filename}</p>}<a href="/" target="_blank" rel="noreferrer">View homepage</a></div>
      </section>
      <div className={styles.workspace}><section className={styles.task} aria-label="Introduction upload">
        <h2>{job ? presentationJobLabel(job) : 'Replace Introduction'}</h2>
        {!job ? <div className={styles.create}><label>Video title<input maxLength={300} value={title} onChange={event => { setTitle(event.target.value); requestId.current = null; }} disabled={busy} /></label>
          <button type="button" className={styles.primary} onClick={prepare} disabled={busy || !title.trim()}><Plus size={17} />New upload</button></div> : <>
          <ol className={styles.steps} aria-label="Replacement progress">{['Upload', 'Process', 'Replace'].map((step, index) => {
            const done = job.status === 'SUCCEEDED' || (index === 0 && job.assetStatus && job.assetStatus !== 'UPLOADING') || (index === 1 && job.assetStatus === 'READY');
            return <li key={step} data-done={!!done}>{done ? <CheckCircle2 size={18} /> : <span>{index + 1}</span>}{step}</li>;
          })}</ol>
          {canUploadPresentation(job) && <div className={styles.upload}>
            <label>Video file<input type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska" disabled={busy} onChange={event => setFile(event.target.files?.[0] || null)} /></label>
            <p>Uploading approves replacement after processing. The current video stays live until then, and the previous asset is retained.</p>
            <button type="button" className={styles.primary} onClick={upload} disabled={busy || !file}><Upload size={17} />{job.assetId ? 'Resume upload & replace' : 'Upload & replace Introduction'}</button>
          </div>}
          {progress !== null && <div className={styles.progress} role="status"><progress value={progress} max="1" /><span>{Math.round(progress * 100)}%</span><button type="button" onClick={() => controller.current?.abort()} title="Pause upload" aria-label="Pause upload"><X size={17} /></button></div>}
          {job.status === 'WAITING_MEDIA' && !canUploadPresentation(job) && <p>Processing continues on the server. This page can be closed.</p>}
          {presentationJobMessage(job) && <p className={styles.message} role="status">{presentationJobMessage(job)}</p>}
          <div className={styles.actions}>
            {pending && <button type="button" onClick={cancel} disabled={busy}><X size={16} />Cancel replacement</button>}
            {!pending && <button type="button" onClick={() => onSelect(null)} disabled={busy}><Plus size={16} />New upload</button>}
          </div>
          <details className={styles.details}><summary>Request details</summary><dl><dt>Request ID</dt><dd>{job.id}</dd><dt>Asset ID</dt><dd>{job.assetId || 'Not uploaded'}</dd><dt>Expires</dt><dd>{new Date(job.expiresAt).toLocaleString()}</dd></dl></details>
        </>}
      </section><section className={styles.history} aria-label="Recent upload requests"><h2>Recent requests</h2>
        {!jobs.length ? <p>No requests yet.</p> : jobs.map(item => <button type="button" key={item.id} disabled={busy} aria-current={jobId === item.id ? 'true' : undefined} onClick={() => onSelect(item.id)}>
          <strong>{item.title}</strong><span>{presentationJobLabel(item)}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></button>)}
      </section></div>
    </>}
  </main>;
}

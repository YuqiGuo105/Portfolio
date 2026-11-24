import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Upload, RefreshCw, Film, Image as ImageIcon, Search, X, RotateCcw, Check, ArrowUpRight, ChevronDown } from 'lucide-react';
import AdminLayout from '../../src/components/admin/AdminLayout';
import { writerApi } from '../../src/lib/writerApi';
import { uploadMedia } from '../../src/lib/media/upload.mjs';
import { mediaPoster, mediaFacts, mediaRenditions, newerMediaAsset, savedUpload } from '../../src/lib/media/library.mjs';
import { formatVideoTime } from '../../src/lib/media/demoCatalog.mjs';
import MediaInspector from '../../src/components/media/MediaInspector';
import styles from '../../src/components/media/MediaLibrary.module.css';

const BASE_URL = process.env.NEXT_PUBLIC_MEDIA_BASE_URL || '';
const ACCEPT = 'video/mp4,video/quicktime,video/webm,video/x-matroska,image/jpeg,image/png,image/webp,image/avif,image/heic';
const RESUME_KEY = 'media-upload-session-v1';
const STATUS = { LOCAL: 'Local sample', READY: 'Ready', PROCESSING: 'Processing', FAILED: 'Failed', UPLOADING: 'Uploading' };

export function MediaLibraryContent({ previewAssets = null, api = writerApi.media }) {
  const readOnly = previewAssets !== null;
  const [assets, setAssets] = useState(previewAssets || []);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [upload, setUpload] = useState(null);
  const [resume, setResume] = useState(null);
  const [loading, setLoading] = useState(!readOnly);
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [dragging, setDragging] = useState(false);
  const [retrying, setRetrying] = useState(null);
  const picker = useRef(null);
  const uploadController = useRef(null);
  const resumeNext = useRef(false);
  const mounted = useRef(true);
  const loadingRef = useRef(false);
  const selected = assets.find(asset => asset.id === selectedId);

  const load = useCallback(async () => {
    if (readOnly) { setAssets(previewAssets); return; }
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const next = await api.list({ limit: 100 });
      if (!mounted.current) return;
      setAssets(items => {
        const currentById = new Map(items.map(item => [item.id, item]));
        return next.map(item => newerMediaAsset(currentById.get(item.id), item));
      }); setError('');
    } catch (err) {
      if (mounted.current) setError(err.status === 404 ? 'The media service is not enabled yet.' : err.message);
    } finally {
      loadingRef.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [api, previewAssets, readOnly]);

  useEffect(() => {
    mounted.current = true;
    if (!readOnly) {
      try { const saved = JSON.parse(sessionStorage.getItem(RESUME_KEY)); if (saved?.assetId) setResume(saved); } catch {}
    }
    load();
    return () => { mounted.current = false; uploadController.current?.abort(); };
  }, [load, readOnly]);

  const busy = assets.some(asset => asset.status === 'PROCESSING');
  useEffect(() => {
    if (!busy || readOnly) return undefined;
    const refresh = () => { if (!document.hidden) load(); };
    const timer = setInterval(refresh, 3000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [busy, load, readOnly]);

  const startUpload = async file => {
    if (!file || uploadController.current || readOnly) return;
    const controller = new AbortController();
    uploadController.current = controller;
    const previous = resumeNext.current ? resume : null;
    resumeNext.current = false;
    setUpload({ name: file.name, progress: 0 }); setError(''); setNotice('');
    try {
      const asset = await uploadMedia(file, {
        api, signal: controller.signal, resume: previous,
        onProgress: progress => { if (mounted.current) setUpload({ name: file.name, progress }); },
        onSession: session => {
          const safe = savedUpload(session);
          if (mounted.current) { setResume(safe); setSelectedId(session.assetId); }
          try { sessionStorage.setItem(RESUME_KEY, JSON.stringify(safe)); } catch {}
        },
      });
      try { sessionStorage.removeItem(RESUME_KEY); } catch {}
      if (mounted.current) { setResume(null); setNotice(`${file.name} uploaded. Processing has started.`); if (asset?.id) setSelectedId(asset.id); }
      await load();
    } catch (err) {
      if (mounted.current) setError(controller.signal.aborted ? 'Upload paused. Select the same file to resume.' : err.message);
    } finally {
      uploadController.current = null;
      if (mounted.current) setUpload(null);
    }
  };

  const retry = async id => {
    if (retrying) return;
    setRetrying(id); setError('');
    try { await api.retry(id); await load(); } catch (err) { setError(err.message); }
    finally { setRetrying(null); }
  };
  const filtered = assets.filter(asset => (filter === 'ALL' || asset.kind === filter || asset.status === filter)
    && `${asset.title} ${asset.filename}`.toLowerCase().includes(query.toLowerCase()));

  return <div className={styles.library}>
    <header className={styles.header}><div><h1>Media library</h1><p>{assets.length} assets{readOnly ? ' / Local review' : ''}</p></div>
      <div className={styles.headerActions}>
        {!readOnly && <Link href="/admin/media-intro"><a className={styles.introLink}><Film size={16} />Homepage intro<ArrowUpRight size={15} /></a></Link>}
        <button type="button" className={styles.iconButton} disabled={loading} onClick={load} aria-label="Refresh media" title="Refresh media"><RefreshCw size={18} /></button>
      </div></header>
    <div className={styles.dropzone} data-dragging={dragging}
      onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); startUpload(event.dataTransfer.files?.[0]); }}>
      <span className={styles.uploadIcon}><Upload size={22} /></span><div className={styles.uploadCopy}><strong>Upload images or videos</strong><p>Private originals. Public playback files.</p></div>
      <button type="button" className={styles.uploadButton} disabled={!!upload || readOnly} onClick={() => { resumeNext.current = false; picker.current?.click(); }}><Upload size={16} />Upload files</button>
    </div>
    <input ref={picker} type="file" accept={ACCEPT} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; startUpload(file); }} hidden />
    {upload && <div className={styles.upload} role="status"><span>{upload.name} <b>{Math.round(upload.progress * 100)}%</b></span><progress value={upload.progress} max="1" /><button type="button" onClick={() => uploadController.current?.abort()} aria-label="Pause upload" title="Pause upload"><X size={17} /></button></div>}
    {resume && !upload && <div className={styles.resume}><span>Unfinished upload</span><button type="button" onClick={() => { resumeNext.current = true; picker.current?.click(); }}><RotateCcw size={16} />Resume with original file</button></div>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.toolbar}><label className={styles.search}><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search media" aria-label="Search media" /></label>
      <div className={styles.filter}><select aria-label="Filter media" value={filter} onChange={event => setFilter(event.target.value)}><option value="ALL">All media</option><option value="VIDEO">Videos</option><option value="IMAGE">Images</option><option value="PROCESSING">Processing</option><option value="FAILED">Failed</option></select><ChevronDown size={16} aria-hidden="true" /></div></div>
    <div className={styles.workspace} data-selected={!!selected}>
      <section className={styles.list} aria-label="Media assets">
        <div className={styles.listHeading}><span>Files <b>{filtered.length}{filtered.length !== assets.length ? ` / ${assets.length}` : ''}</b></span><span>Status / Renditions</span></div>
        {loading ? <p className={styles.empty}>Loading media...</p> : !filtered.length ? <p className={styles.empty}>No media found.</p> : filtered.map(asset => {
          const poster = mediaPoster(asset, BASE_URL);
          const facts = mediaFacts(asset);
          const Icon = asset.kind === 'VIDEO' ? Film : ImageIcon;
          return <button type="button" key={asset.id} className={styles.asset} aria-pressed={selectedId === asset.id} onClick={() => setSelectedId(asset.id)}>
            {poster ? <img src={poster} alt="" loading="lazy" /> : <span className={styles.assetIcon}><Icon size={25} /></span>}
            <span className={styles.assetName}><strong>{asset.title || asset.filename}</strong><small className={styles.assetFacts}><Icon size={13} />{asset.kind === 'VIDEO' ? 'Video' : 'Image'}{facts.seconds ? ` / ${formatVideoTime(facts.seconds)}` : ''}{facts.width ? ` / ${facts.width} x ${facts.height}` : ''}</small><small className={styles.filename}>{asset.filename}</small></span>
            <span className={styles.assetStatus}><b data-status={asset.status}><span className={styles.statusDot} />{STATUS[asset.status] || asset.status}</b><span className={styles.chips}>{mediaRenditions(asset).map(r => <span key={r.name} data-status={r.status} title={`${r.name}: ${r.status === 'SUCCEEDED' ? 'Ready' : r.status === 'LOCAL' ? 'Local file' : r.status}`}><span>{r.name}</span>{r.status === 'SUCCEEDED' && <Check size={11} aria-label="Ready" />}</span>)}</span></span>
          </button>;
        })}
      </section>
      {selected && <MediaInspector asset={selected} baseUrl={BASE_URL} onClose={() => setSelectedId(null)} onRetry={retry} retrying={retrying === selected.id}
        api={readOnly ? null : api} onChanged={next => setAssets(items => items.map(item => item.id === next.id ? newerMediaAsset(item, next) : item))} />}
    </div>
  </div>;
}

export default function MediaLibraryPage() {
  return <AdminLayout><MediaLibraryContent /></AdminLayout>;
}

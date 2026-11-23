import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Loader2, AlertCircle, X, ExternalLink, RotateCcw, Play, FileImage } from 'lucide-react';
import DemoVideo from './DemoVideo';
import { createMediaPlayer } from '../../lib/media/player.mjs';
import { assetUrl } from '../../lib/media/markup.mjs';
import { mediaFacts, mediaPoster, mediaSteps, mediaRenditions, mediaWarnings } from '../../lib/media/library.mjs';
import { formatVideoTime } from '../../lib/media/demoCatalog.mjs';
import styles from './MediaLibrary.module.css';

const LABELS = { PENDING: 'Queued', RUNNING: 'Processing', SUCCEEDED: 'Done', DEAD: 'Failed', LOCAL: 'Local file' };

function PublishedVideo({ asset, baseUrl }) {
  const video = useRef(null);
  const player = useRef(null);
  const [state, setState] = useState('ready');
  const [levels, setLevels] = useState([]);
  const [quality, setQuality] = useState(-1);
  useEffect(() => {
    player.current = createMediaPlayer(video.current, { onState: setState, onLevels: setLevels });
    return () => player.current?.dispose();
  }, [asset.id]);
  return <div className={styles.player}>
    <video ref={video} controls playsInline preload="none" poster={mediaPoster(asset, baseUrl)}
      data-hls={assetUrl(baseUrl, asset.manifest, asset.manifest.hls)}
      data-mp4={assetUrl(baseUrl, asset.manifest, asset.manifest.mp4?.path)} aria-label={`${asset.title || asset.filename} preview`} />
    {state === 'ready' && !video.current?.currentSrc && <button type="button" onClick={() => player.current.start()} aria-label="Play media preview"><Play size={20} /></button>}
    {state === 'loading' && <p role="status">Loading video...</p>}
    {state === 'error' && <p role="alert">Playback failed. <button type="button" onClick={() => player.current.start()}>Retry playback</button></p>}
    {levels.length > 0 && <label className={styles.quality}>Quality<select value={quality} onChange={event => {
      const next = Number(event.target.value); setQuality(next); player.current.setQuality(next);
    }}><option value={-1}>Auto</option>{levels.map(level => <option key={level.index} value={level.index}>{level.height}p</option>)}</select></label>}
  </div>;
}

export default function MediaInspector({ asset, baseUrl, onClose, onRetry, retrying }) {
  const facts = mediaFacts(asset);
  const poster = mediaPoster(asset, baseUrl);
  const renditions = mediaRenditions(asset);
  const warnings = mediaWarnings(asset);
  return <aside className={styles.inspector} aria-label="Media details">
    <header className={styles.detailHeader}><div><h2>{asset.title || asset.filename}</h2><p>{asset.filename}</p></div>
      <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close media details" title="Close details"><X size={18} /></button></header>
    <p className={styles.availability}>{asset.status === 'LOCAL' ? 'Local sample / not published' : asset.status === 'READY' ? 'Available for playback' : 'Not available to visitors until processing completes'}</p>
    {asset.previewDemo ? <DemoVideo key={asset.id} demo={asset.previewDemo} /> : asset.kind === 'VIDEO' && (asset.manifest?.hls || asset.manifest?.mp4) && baseUrl
      ? <PublishedVideo key={asset.id} asset={asset} baseUrl={baseUrl} /> : poster
        ? <img className={styles.still} src={poster} alt={asset.title || asset.filename} />
        : <div className={styles.placeholder}><FileImage size={32} /><span>Preview pending</span></div>}
    <dl className={styles.facts}>
      <div><dt>Source</dt><dd>{facts.width && facts.height ? `${facts.width} x ${facts.height}` : 'Not probed yet'}</dd></div>
      <div><dt>{asset.kind === 'VIDEO' ? 'Duration' : 'Type'}</dt><dd>{asset.kind === 'VIDEO' ? facts.seconds ? formatVideoTime(facts.seconds) : 'Pending' : asset.contentType}</dd></div>
      <div><dt>File size</dt><dd>{asset.sizeBytes ? `${(asset.sizeBytes / 1048576).toFixed(2)} MB` : 'Unknown'}</dd></div>
      <div><dt>Version</dt><dd>{asset.sourceVersion ? `v${asset.sourceVersion}` : asset.status === 'LOCAL' ? 'Local sample' : 'Awaiting upload'}</dd></div>
    </dl>
    {asset.failureMessage && <p className={styles.error} role="alert">{asset.failureMessage}</p>}
    {warnings.map(warning => <p className={styles.warning} key={warning}><AlertCircle size={16} />{warning}</p>)}
    {asset.status === 'LOCAL' ? <section className={styles.section}><h3>Video files</h3><div className={styles.chips}>{renditions.map(r => <span key={r.name}>{r.name}</span>)}</div></section>
      : <ol className={styles.steps}>{mediaSteps(asset).map(step => {
        const Icon = step.state === 'done' ? CheckCircle2 : step.state === 'failed' ? AlertCircle : step.state === 'active' ? Loader2 : Circle;
        return <li key={step.title} data-state={step.state}><Icon size={21} className={step.state === 'active' ? styles.spinner : ''} /><div><strong>{step.title}</strong>
          {step.detail && <p>{step.detail}</p>}
          {step.jobs?.map(job => <div className={styles.job} key={`${job.type}:${job.rendition}`}>
            <span>{job.rendition} <b data-status={job.status}>{LABELS[job.status] || job.status}</b></span>
            {job.attempt > 0 && <small>Attempt {job.attempt}{job.maxAttempts ? ` of ${job.maxAttempts}` : ''}{job.status === 'RUNNING' ? ' / lease active' : ''}</small>}
            {job.error && <small className={styles.error}>{job.error}</small>}
          </div>)}
        </div></li>;
      })}</ol>}
    {asset.status === 'FAILED' && asset.sourceVersion > 0 && <button type="button" className={styles.retry} disabled={retrying} onClick={() => onRetry(asset.id)}><RotateCcw size={17} />{retrying ? 'Retrying...' : 'Retry failed tasks'}</button>}
    <section className={styles.section}><h3>Used in <span>{asset.usages?.length || 0}</span></h3>
      {asset.usages?.length ? <ul className={styles.usages}>{asset.usages.map(use => <li key={`${use.href}:${use.label}`}><a href={use.href} target="_blank" rel="noreferrer">{use.label}<ExternalLink size={15} /></a></li>)}</ul> : <p>No linked pages.</p>}
    </section>
    <details className={styles.technical}><summary>Technical details</summary><dl>
      <dt>Asset ID</dt><dd><code>{asset.id}</code></dd>
      <dt>Uploaded</dt><dd>{asset.createdAt ? new Date(asset.createdAt).toLocaleString() : 'Local file'}</dd>
      <dt>Last update</dt><dd>{asset.updatedAt ? new Date(asset.updatedAt).toLocaleString() : 'Local file'}</dd>
      {facts.codec && <><dt>Codec</dt><dd>{facts.codec}</dd></>}
      {asset.failureCode && <><dt>Error code</dt><dd>{asset.failureCode}</dd></>}
    </dl></details>
  </aside>;
}

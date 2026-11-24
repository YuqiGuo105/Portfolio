import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, FileVideo, Trash2 } from 'lucide-react';
import styles from './OriginalFileActions.module.css';

const BLOCK_REASONS = {
  not_video: 'Only video originals can be deleted.',
  asset_deleted: 'This video has been removed from the media library.',
  not_ready: 'Finish processing this video before deleting its original.',
  original_deleted: 'The original has already been deleted.',
  active_jobs: 'Processing is still active. Try again after it finishes.',
  invalid_playable_manifest: 'A complete playback version is required before deleting the original.',
  original_storage_unverified: 'The private source could not be verified. Nothing was deleted.',
};

export default function OriginalFileActions({ asset, api, onChanged }) {
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef(null);
  const cancel = useRef(null);
  const active = useRef(true);
  const working = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    if (check?.deletable) { dialog.current?.showModal(); cancel.current?.focus(); }
    else dialog.current?.close();
  }, [check]);

  if (asset.kind !== 'VIDEO' || asset.status === 'LOCAL' || !asset.originalStatus || !api) return null;
  const deleted = asset.originalStatus === 'DELETED';
  const eligible = asset.status === 'READY' && !deleted;

  const inspect = async () => {
    if (working.current || !eligible) return;
    working.current = true; setBusy(true); setError('');
    try {
      const result = await api.checkOriginalDeletion(asset.id);
      if (!active.current) return;
      if (result.originalStatus === 'DELETED') {
        const current = await api.get(asset.id);
        if (active.current) onChanged(current);
      } else if (!result.deletable) setError(result.reasons?.map(reason => BLOCK_REASONS[reason] || reason).join(' ') || 'The original cannot be deleted yet. Refresh and try again.');
      else setCheck(result);
    } catch (err) { if (active.current) setError(err.message || 'Could not check the original file.'); }
    finally { working.current = false; if (active.current) setBusy(false); }
  };
  const remove = async () => {
    if (working.current || !check?.deletable) return;
    working.current = true; setBusy(true); setError('');
    try {
      const current = await api.deleteOriginal(asset.id, check.metadataVersion);
      if (active.current) { setCheck(null); onChanged(current); }
    } catch (err) {
      if (active.current) {
        setCheck(null);
        setError(err.status === 409 ? 'This video changed. Check again before deleting its original.' : err.message || 'Deletion was not confirmed. Check again to retry safely.');
      }
    } finally { working.current = false; if (active.current) setBusy(false); }
  };

  return <section className={styles.root} aria-label="Original file">
    <header><FileVideo size={18} /><h3>Original file</h3></header>
    <p className={styles.filename}>{asset.filename}</p>
    {deleted ? <p className={styles.success} role="status"><CheckCircle2 size={17} />Original deleted. Playback files retained.</p> : <>
      <p>{eligible ? 'Private source. Processed videos and page links will be kept.' : 'Available to delete after processing completes.'}</p>
      <button className={styles.remove} type="button" disabled={busy || !eligible} onClick={inspect}><Trash2 size={16} />{busy && !check ? 'Checking...' : asset.originalStatus === 'AVAILABLE' ? 'Delete original' : 'Retry original deletion'}</button>
    </>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={event => { if (working.current) event.preventDefault(); else setCheck(null); }}>
      <h2 id={titleId}>Delete this original file?</h2>
      <p className={styles.filename}>{asset.filename}</p>
      <p id={descriptionId}>This removes the uploaded source from active storage and cannot be undone here. You cannot re-transcode it without uploading it again. Existing playback files, captions and page links stay unchanged. Storage-provider retention may delay final erasure.</p>
      <div className={styles.actions}>
        <button ref={cancel} type="button" disabled={busy} onClick={() => setCheck(null)}>Cancel</button>
        <button className={styles.remove} type="button" disabled={busy} onClick={remove}><Trash2 size={16} />{busy ? 'Deleting...' : 'Confirm deletion'}</button>
      </div>
    </dialog>
  </section>;
}

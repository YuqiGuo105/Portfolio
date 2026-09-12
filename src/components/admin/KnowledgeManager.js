import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Database, FileText, LockKeyhole, Plus, RefreshCw, Save, Search, Trash2, X } from 'lucide-react';
import { writerApi } from '../../lib/writerApi';
import { DataState, PageHeader, StatusPill, adminStyles as ui } from './AdminUI';
import styles from './KnowledgeManager.module.css';

const blank = { title: '', question: '', content: '', status: 'DRAFT', answerVisibility: 'private' };
const PAGE_SIZE = 25;

function draftOf(record) {
  const meta = record?.metadata || {};
  return { title: meta.title || meta.question || '', question: meta.question || '', content: record?.content || '',
    status: ['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(meta.status) ? meta.status : 'DRAFT',
    answerVisibility: meta.answer_visibility === 'public' ? 'public' : 'private' };
}

export default function KnowledgeManager({ api = writerApi.knowledge, readOnly = false }) {
  const [filter, setFilter] = useState({ query: '', scope: 'OWNED', status: 'ALL', offset: 0 });
  const [query, setQuery] = useState('');
  const [result, setResult] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [record, setRecord] = useState(null);
  const [draft, setDraft] = useState(blank);
  const [baseline, setBaseline] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [intent, setIntent] = useState(null);
  const dialog = useRef(null);
  const sequence = useRef(0);
  const selectionSequence = useRef(0);
  const createKey = useRef('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const editable = !readOnly && record?.editable !== false;

  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true); setListError('');
    try {
      const data = await api.list({ ...filter, limit: PAGE_SIZE });
      if (sequence.current === request) setResult(data);
    } catch (err) { if (sequence.current === request) setListError(err.message); }
    finally { if (sequence.current === request) setLoading(false); }
  }, [api, filter]);

  useEffect(() => {
    const guard = sequence;
    void load();
    return () => { guard.current++; };
  }, [load]);
  useEffect(() => {
    const warn = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (intent) dialog.current?.showModal();
    else dialog.current?.close();
  }, [intent]);

  function replaceRecord(value) {
    const next = value?.id ? draftOf(value) : blank;
    setRecord(value); setDraft(next); setBaseline(next); setError(''); setNotice('');
  }
  async function select(id) {
    const request = ++selectionSequence.current;
    setBusy(true); setError('');
    try { const value = await api.get(id); if (selectionSequence.current === request) replaceRecord(value); }
    catch (err) { if (selectionSequence.current === request) setError(err.message); }
    finally { if (selectionSequence.current === request) setBusy(false); }
  }
  function navigate(action) {
    if (dirty) setIntent({ kind: 'discard', action });
    else action();
  }
  function newRecord() {
    navigate(() => { createKey.current = crypto.randomUUID(); replaceRecord({ editable: true }); });
  }
  function edit(name, value) {
    setDraft(current => ({ ...current, [name]: value })); setNotice('');
  }
  async function save() {
    setIntent(null); setBusy(true); setError(''); setNotice('');
    try {
      const value = record.id
        ? await api.update(record.id, { ...draft, expectedRevision: record.revision }, crypto.randomUUID())
        : await api.create(draft, createKey.current);
      replaceRecord(value);
      setNotice(draft.status === 'ACTIVE' ? 'Saved. RAG indexing queued.' : 'Saved. Not available to public answers.');
      void load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function remove() {
    setIntent(null); setBusy(true); setError('');
    try {
      await api.remove(record.id, record.revision, crypto.randomUUID());
      replaceRecord(null); setNotice('Knowledge record deleted.');
      setFilter(current => ({ ...current, offset: 0 }));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  function submit(event) {
    event.preventDefault();
    if (draft.status === 'ACTIVE') setIntent({ kind: 'publish' });
    else void save();
  }

  return <div className={`${ui.page} ${styles.page}`}>
    <PageHeader title="Knowledge base" subtitle={readOnly ? 'Live AI knowledge / Read-only preview' : 'Owner notes, approved answers and retrieval sources.'} actions={<>
      <button className={ui.iconButton} onClick={load} disabled={loading || busy} title="Refresh knowledge" aria-label="Refresh knowledge"><RefreshCw size={16} /></button>
      {!readOnly && <button className={ui.buttonPrimary} onClick={newRecord} disabled={busy}><Plus size={16} />New knowledge</button>}
    </>} />
    <form className={styles.toolbar} onSubmit={event => { event.preventDefault(); setFilter(current => ({ ...current, query, offset: 0 })); }}>
      <div className={styles.search}><Search size={16} /><input aria-label="Search knowledge" value={query} maxLength={300} onChange={event => setQuery(event.target.value)} placeholder="Search questions or answers" /><button className={ui.iconButton} title="Search" aria-label="Search"><ChevronRight size={16} /></button></div>
      <select aria-label="Knowledge scope" value={filter.scope} className={ui.select} onChange={event => setFilter(current => ({ ...current, scope: event.target.value, offset: 0 }))}>
        <option value="OWNED">Owner-managed</option><option value="INDEXED">Indexed sources</option><option value="ALL">All records</option>
      </select>
      <select aria-label="Knowledge status" value={filter.status} className={ui.select} onChange={event => setFilter(current => ({ ...current, status: event.target.value, offset: 0 }))}>
        {['ALL', 'ACTIVE', 'DRAFT', 'ARCHIVED', 'LEGACY', 'SUPERSEDED'].map(value => <option key={value} value={value}>{value === 'ALL' ? 'All statuses' : value.charAt(0) + value.slice(1).toLowerCase()}</option>)}
      </select>
    </form>
    {error && <div className={ui.errorBanner} role="alert">{error}{record?.id && <button className={ui.buttonSecondary} disabled={busy} onClick={() => navigate(() => select(record.id))}>Reload record</button>}</div>}
    {notice && <div role="status" className={styles.notice}><Check size={16} />{notice}</div>}
    <div className={`${styles.workspace} ${record ? styles.hasSelection : ''}`}>
      <section className={styles.library} aria-label="Knowledge records">
        <div className={styles.listHeading}><strong>{result.total} records</strong><LockKeyhole size={14} aria-label="Admin only" /></div>
        <DataState loading={loading} error={listError} empty={!result.items.length} onRetry={load}>
          <div className={styles.records}>{result.items.map(item => <button key={item.id} type="button" disabled={busy}
            className={`${styles.record} ${record?.id === item.id ? styles.selected : ''}`}
            aria-pressed={record?.id === item.id} onClick={() => navigate(() => select(item.id))}>
            <span className={styles.recordHeading}><FileText size={16} /><strong>{item.title}</strong></span>
            <span className={styles.preview}>{item.preview}</span>
            <span className={styles.recordMeta}><StatusPill value={item.status} /><span>{item.editable ? 'Owner note' : item.sourceType}</span></span>
          </button>)}</div>
        </DataState>
        <div className={ui.pagination}><span>{result.total ? `${filter.offset + 1}-${Math.min(filter.offset + PAGE_SIZE, result.total)}` : '0'} of {result.total}</span><div className={ui.paginationActions}>
          <button className={ui.iconButton} aria-label="Previous page" title="Previous page" disabled={loading || filter.offset === 0} onClick={() => setFilter(current => ({ ...current, offset: Math.max(0, current.offset - PAGE_SIZE) }))}><ChevronLeft size={16} /></button>
          <button className={ui.iconButton} aria-label="Next page" title="Next page" disabled={loading || filter.offset + PAGE_SIZE >= result.total} onClick={() => setFilter(current => ({ ...current, offset: current.offset + PAGE_SIZE }))}><ChevronRight size={16} /></button>
        </div></div>
      </section>
      <section className={styles.editor} aria-label="Knowledge editor" aria-busy={busy}>
        {!record ? <div className={styles.empty}><Database size={28} /><h2>Select a knowledge record</h2><span>{busy ? 'Loading record...' : 'Owner notes and source details'}</span>{!readOnly && <button className={ui.buttonSecondary} onClick={newRecord} disabled={busy}><Plus size={15} />New knowledge</button>}</div> : <>
          <div className={styles.editorHeading}><div><button type="button" className={styles.back} onClick={() => navigate(() => replaceRecord(null))} disabled={busy}><ArrowLeft size={16} />All records</button><h2>{readOnly ? 'Knowledge record' : record.id ? editable ? 'Edit knowledge' : 'Indexed source' : 'New knowledge'}</h2></div>
            <button className={ui.iconButton} title="Close editor" aria-label="Close editor" disabled={busy} onClick={() => navigate(() => replaceRecord(null))}><X size={16} /></button></div>
          <form onSubmit={submit} className={styles.form}>
            <fieldset disabled={busy || !editable} className={styles.fields}>
              <label>Title<input required maxLength={240} value={draft.title} onChange={event => edit('title', event.target.value)} /></label>
              <label>Question <span className={styles.optional}>(optional)</span><textarea rows={2} maxLength={1000} value={draft.question} onChange={event => edit('question', event.target.value)} /></label>
              <label>Answer / knowledge<textarea className={styles.answer} required rows={10} maxLength={20000} value={draft.content} onChange={event => edit('content', event.target.value)} /></label>
              <span className={styles.counter}>{draft.content.length.toLocaleString()} / 20,000</span>
              {readOnly ? <div className={styles.access}><span>Record status</span><StatusPill value={record.metadata?.status || 'LEGACY'} /><span>Answer visibility: {record.metadata?.answer_visibility || 'Not specified'}</span></div> : <div className={styles.settings}><label>Status<select value={draft.status} onChange={event => setDraft(current => ({ ...current, status: event.target.value, answerVisibility: event.target.value === 'ACTIVE' ? 'public' : current.answerVisibility }))}><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option></select></label>
                <label>Answer visibility<select value={draft.answerVisibility} onChange={event => setDraft(current => ({ ...current, answerVisibility: event.target.value, status: event.target.value === 'private' && current.status === 'ACTIVE' ? 'DRAFT' : current.status }))}><option value="private">Private</option><option value="public">Public answers</option></select></label></div>}
            </fieldset>
            <div className={styles.access}><LockKeyhole size={15} /><span>Source access: administrators only</span></div>
            {record.id && <div className={styles.indexing}><span>RAG indexing</span><StatusPill value={record.indexing?.status || 'NOT_INDEXED'} /><button type="button" className={ui.iconButton} disabled={busy || dirty} onClick={() => select(record.id)} title="Refresh indexing status" aria-label="Refresh indexing status"><RefreshCw size={14} /></button>{record.indexing?.jobId && <Link href="/admin/jobs"><a>View job</a></Link>}</div>}
            {record.editable === false && <div className={styles.readOnly}>Generated retrieval chunk. Changes belong in its original source.{record.metadata?.source_id && <span>Source: {record.metadata.source_type} / {record.metadata.source_id}</span>}</div>}
            {editable && <div className={styles.actions}><button type="submit" className={ui.buttonPrimary} disabled={busy || !dirty || !draft.title.trim() || !draft.content.trim()}><Save size={16} />{busy ? 'Saving...' : 'Save changes'}</button><span>{dirty ? 'Unsaved changes' : record.id ? 'Saved' : 'Private draft'}</span>{record.id && <button type="button" className={`${ui.iconButton} ${styles.delete}`} title="Delete knowledge" aria-label="Delete knowledge" disabled={busy} onClick={() => setIntent({ kind: 'delete' })}><Trash2 size={16} /></button>}</div>}
          </form>
          {record.id && <details className={styles.details}><summary>Record details</summary><dl><dt>Record ID</dt><dd>{record.id}</dd><dt>Revision</dt><dd>{record.revision}</dd><dt>Created</dt><dd>{record.createdAt}</dd></dl></details>}
        </>}
      </section>
    </div>
    <dialog ref={dialog} className={styles.dialog} onCancel={event => { event.preventDefault(); setIntent(null); }} aria-labelledby="knowledge-confirm-title">
      <h2 id="knowledge-confirm-title">{intent?.kind === 'delete' ? 'Delete this knowledge?' : intent?.kind === 'discard' ? 'Discard unsaved changes?' : 'Enable public answers?'}</h2>
      <p>{intent?.kind === 'delete' ? 'The record and its answer chunks will be removed. An administrator audit snapshot is retained.' : intent?.kind === 'discard' ? 'Your unsaved edits will be lost.' : 'This knowledge may be used in public AI answers. The text will be sent to Gemini for indexing. Its source remains administrator-only.'}</p>
      <div className={styles.dialogActions}><button className={ui.buttonSecondary} onClick={() => setIntent(null)}>Cancel</button><button className={intent?.kind === 'delete' ? ui.buttonDanger : ui.buttonPrimary} onClick={() => { if (intent.kind === 'delete') void remove(); else if (intent.kind === 'publish') void save(); else { const action = intent.action; setIntent(null); action(); } }}>{intent?.kind === 'delete' ? 'Delete knowledge' : intent?.kind === 'discard' ? 'Discard changes' : 'Approve and save'}</button></div>
    </dialog>
  </div>;
}

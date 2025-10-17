'use client';

import { useState } from 'react';
import { useWorkerPool } from '../../os/workers/WorkerPoolProvider';
import { writeClipboard } from '../../os/ipc/gateway';

export default function WorkerConsoleApp() {
  const { pool, snapshot } = useWorkerPool();
  const [logs, setLogs] = useState([]);
  const [input, setInput] = useState('20');
  const [clipboardStatus, setClipboardStatus] = useState(null);

  const runTask = async (task) => {
    try {
      const payload = task === 'hash' ? input : Number(input);
      const result = await pool.run(task, payload);
      setLogs((prev) => [{ task, payload, result, ts: Date.now() }, ...prev].slice(0, 12));
    } catch (error) {
      setLogs((prev) => [{ task, payload: input, result: error.message, ts: Date.now() }, ...prev].slice(0, 12));
    }
  };

  const copyLatest = async () => {
    if (logs.length === 0) return;
    try {
      await writeClipboard(String(logs[0].result));
      setClipboardStatus('Copied to clipboard');
    } catch (error) {
      setClipboardStatus(error.message);
    }
  };

  return (
    <div style={{ padding: '1.5rem', display: 'grid', gap: '1rem' }}>
      <header>
        <h2 style={{ margin: 0 }}>Worker console</h2>
        <p style={{ opacity: 0.75 }}>Dispatch tasks through the 3-thread worker pool.</p>
      </header>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <label style={{ flex: 1 }}>
          <span>Payload</span>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            style={{
              width: '100%',
              marginTop: '0.35rem',
              padding: '0.65rem',
              borderRadius: '0.65rem',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(10,12,20,0.85)',
              color: '#fff',
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => runTask('fibonacci')}
          style={{
            padding: '0.65rem 1.1rem',
            borderRadius: '0.75rem',
            border: 'none',
            background: 'linear-gradient(135deg,#4b6bff,#4bb8ff)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Fibonacci
        </button>
        <button
          type="button"
          onClick={() => runTask('hash')}
          style={{
            padding: '0.65rem 1.1rem',
            borderRadius: '0.75rem',
            border: 'none',
            background: 'rgba(255,255,255,0.12)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Hash
        </button>
      </div>
      <section style={{ background: 'rgba(12,15,24,0.8)', padding: '1rem', borderRadius: '0.85rem' }}>
        <h3 style={{ marginTop: 0 }}>Queue</h3>
        {snapshot.queue.length === 0 && snapshot.activeJobs.length === 0 && <p>Idle</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.35rem' }}>
          {snapshot.activeJobs.map((job) => (
            <li key={job.id} style={{ opacity: 0.9 }}>
              🔄 {job.task}
            </li>
          ))}
          {snapshot.queue.map((job) => (
            <li key={job.id} style={{ opacity: 0.6 }}>
              ⏳ {job.task}
            </li>
          ))}
        </ul>
      </section>
      <section style={{ background: 'rgba(12,15,24,0.8)', padding: '1rem', borderRadius: '0.85rem', minHeight: '150px' }}>
        <h3 style={{ marginTop: 0 }}>Results</h3>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <button
            type="button"
            onClick={copyLatest}
            style={{
              padding: '0.45rem 0.95rem',
              borderRadius: '0.65rem',
              border: 'none',
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Copy latest result
          </button>
          {clipboardStatus && <span style={{ fontSize: '0.8rem', opacity: 0.75 }}>{clipboardStatus}</span>}
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.45rem', fontSize: '0.85rem' }}>
          {logs.length === 0 && <li>No jobs executed yet.</li>}
          {logs.map((entry) => (
            <li key={entry.ts}>
              <strong>{entry.task}</strong>({String(entry.payload)}) → {String(entry.result)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

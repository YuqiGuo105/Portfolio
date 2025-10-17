'use client';

import { useEffect, useMemo, useState } from 'react';
import { fileSystem } from '../../os/fs/fileSystem';
import { useStorageStats } from '../../os/fs/useStorageStats';

const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(1)} ${units[exponent]}`;
};

export default function StorageManagerApp() {
  const [files, setFiles] = useState([]);
  const [draftName, setDraftName] = useState('note.txt');
  const [draftContent, setDraftContent] = useState('Welcome to your virtual file system!');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { stats, refresh } = useStorageStats();

  const loadFiles = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await fileSystem.listFiles();
      setFiles(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles();
  }, []);

  const handleCreate = async () => {
    try {
      setError(null);
      await fileSystem.writeFile(draftName, draftContent);
      await loadFiles();
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (path) => {
    try {
      setError(null);
      await fileSystem.deleteFile(path);
      await loadFiles();
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const usagePercent = useMemo(() => {
    if (!stats.quota) return 0;
    return Math.min(100, Math.round((stats.used / stats.quota) * 100));
  }, [stats.used, stats.quota]);

  return (
    <div style={{ padding: '1.5rem', display: 'grid', gap: '1.25rem' }}>
      <header>
        <h2 style={{ margin: 0 }}>Storage manager</h2>
        <p style={{ opacity: 0.75, marginTop: '0.35rem' }}>
          Manage files stored in IndexedDB via the localforage-powered sandbox.
        </p>
      </header>
      <section style={{ background: 'rgba(12,15,24,0.8)', padding: '1rem', borderRadius: '0.85rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div>
            <strong>{formatBytes(stats.used)}</strong> used of {formatBytes(stats.quota || 1024 * 1024 * 1024)}
          </div>
          <div>{usagePercent}%</div>
        </div>
        <div style={{ width: '100%', background: 'rgba(255,255,255,0.08)', borderRadius: '999px', height: '8px' }}>
          <div
            style={{
              width: `${usagePercent}%`,
              height: '100%',
              borderRadius: '999px',
              background: 'linear-gradient(135deg,#4b6bff,#4bb8ff)',
            }}
          />
        </div>
      </section>
      <section style={{ display: 'grid', gap: '0.75rem' }}>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <label>
            <span>Name</span>
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              style={{
                width: '100%',
                marginTop: '0.35rem',
                padding: '0.65rem',
                borderRadius: '0.65rem',
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(10,12,20,0.8)',
                color: '#fff',
              }}
            />
          </label>
          <label>
            <span>Content</span>
            <textarea
              value={draftContent}
              onChange={(event) => setDraftContent(event.target.value)}
              rows={4}
              style={{
                width: '100%',
                marginTop: '0.35rem',
                padding: '0.65rem',
                borderRadius: '0.65rem',
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(10,12,20,0.8)',
                color: '#fff',
                resize: 'vertical',
              }}
            />
          </label>
          <button
            type="button"
            onClick={handleCreate}
            style={{
              justifySelf: 'flex-start',
              padding: '0.65rem 1.25rem',
              borderRadius: '0.75rem',
              border: 'none',
              background: 'linear-gradient(135deg,#4b6bff,#4bb8ff)',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Save file
          </button>
        </div>
      </section>
      <section style={{ background: 'rgba(12,15,24,0.8)', padding: '1rem', borderRadius: '0.85rem', minHeight: '160px' }}>
        <h3 style={{ marginTop: 0 }}>Files</h3>
        {loading && <p>Loading files…</p>}
        {error && <p style={{ color: '#ff8d8d' }}>{error}</p>}
        {!loading && files.length === 0 && <p>No files stored yet.</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0', display: 'grid', gap: '0.5rem' }}>
          {files.map((file) => (
            <li
              key={file.path}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'rgba(255,255,255,0.06)',
                padding: '0.75rem 1rem',
                borderRadius: '0.75rem',
              }}
            >
              <div>
                <strong>{file.path}</strong>
                <div style={{ fontSize: '0.8rem', opacity: 0.75 }}>
                  {formatBytes(file.size)} · {new Date(file.updatedAt).toLocaleString()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(file.path)}
                style={{
                  border: 'none',
                  borderRadius: '0.65rem',
                  padding: '0.45rem 0.85rem',
                  background: 'rgba(255,99,99,0.45)',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

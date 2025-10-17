'use client';

import { motion } from 'framer-motion';
import { getAllApps } from '../registry';
import { useDesktopStore } from '../store/useDesktopStore';
import AppIcon from './AppIcon';
import AppWindow from './AppWindow';
import Taskbar from './Taskbar';
import { useStorageStats } from '../fs/useStorageStats';
import { useWorkerPool } from '../workers/WorkerPoolProvider';

const wallpaper = 'linear-gradient(135deg, rgba(27,37,67,0.85), rgba(12,14,22,0.9))';

const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(1)} ${units[exponent]}`;
};

export default function Desktop() {
  const windows = useDesktopStore((state) => state.windows);
  const launchApp = useDesktopStore((state) => state.launchApp);
  const { stats, loading } = useStorageStats();
  const { snapshot } = useWorkerPool();

  const icons = getAllApps();

  const activeWindows = windows
    .slice()
    .sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div className="desktop-root">
      <div className="desktop-wallpaper" style={{ backgroundImage: wallpaper }} />
      <div className="desktop-context-panel">
        <strong>System status</strong>
        <div style={{ fontSize: '0.85rem', marginTop: '0.5rem', lineHeight: 1.6 }}>
          <div>
            Storage: {loading ? '…' : `${formatBytes(stats.used)} / ${formatBytes(stats.quota || 1024 * 1024 * 1024)}`}
          </div>
          <div>Queue: {snapshot.queue.length}</div>
          <div>Active workers: {snapshot.activeJobs.length}</div>
        </div>
      </div>
      <motion.div
        className="desktop-grid"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        {icons.map((app) => (
          <AppIcon key={app.id} app={app} onOpen={launchApp} />
        ))}
      </motion.div>
      {activeWindows.map((window) => (
        <AppWindow key={window.id} window={window} />
      ))}
      <Taskbar />
    </div>
  );
}

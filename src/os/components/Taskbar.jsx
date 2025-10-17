'use client';

import { useMemo } from 'react';
import { getAllApps } from '../registry';
import { useDesktopStore } from '../store/useDesktopStore';

export default function Taskbar() {
  const taskbarApps = useDesktopStore((state) => state.taskbar);
  const windows = useDesktopStore((state) => state.windows);
  const focusedWindowId = useDesktopStore((state) => state.focusedWindowId);
  const launchApp = useDesktopStore((state) => state.launchApp);
  const focusWindow = useDesktopStore((state) => state.focusWindow);
  const toggleMinimize = useDesktopStore((state) => state.toggleMinimize);

  const metadata = useMemo(() => {
    const apps = getAllApps();
    const byId = new Map(apps.map((app) => [app.id, app]));
    return taskbarApps
      .map((id) => byId.get(id))
      .filter(Boolean);
  }, [taskbarApps]);

  const handleClick = (app) => {
    const windowInstance = windows.find((win) => win.appId === app.id);
    if (!windowInstance) {
      launchApp(app.id);
      return;
    }

    if (windowInstance.minimized) {
      toggleMinimize(windowInstance.id);
    }
    focusWindow(windowInstance.id);
  };

  if (metadata.length === 0) return null;

  return (
    <nav className="desktop-taskbar" aria-label="Taskbar">
      {metadata.map((app) => {
        const windowInstance = windows.find((win) => win.appId === app.id);
        const isActive = windowInstance && windowInstance.id === focusedWindowId && !windowInstance.minimized;
        return (
          <button
            key={app.id}
            type="button"
            className="taskbar-app"
            data-active={isActive}
            onClick={() => handleClick(app)}
          >
            {app.icon} <span style={{ marginLeft: '0.35rem' }}>{app.title}</span>
          </button>
        );
      })}
    </nav>
  );
}

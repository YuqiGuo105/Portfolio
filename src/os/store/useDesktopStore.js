'use client';

import create from 'zustand';
import { getAppDefinition } from '../registry';

let windowCounter = 0;

const nextWindowId = () => {
  windowCounter += 1;
  return `win-${windowCounter}`;
};

export const useDesktopStore = create((set, get) => ({
  windows: [],
  focusedWindowId: null,
  taskbar: [],
  zIndexCursor: 10,

  launchApp: (appId, options = {}) => {
    const state = get();
    const app = getAppDefinition(appId);
    if (!app) {
      console.warn(`App ${appId} not registered.`);
      return null;
    }
    const enforceSingleton = options.singleton ?? app.singleton ?? true;
    const shouldFocus = options.focus ?? true;

    const existing = state.windows.find((window) => window.appId === appId);
    if (existing && enforceSingleton) {
      set({
        windows: state.windows.map((win) =>
          win.id === existing.id ? { ...win, minimized: false } : win
        ),
        focusedWindowId: existing.id,
      });
      return existing.id;
    }

    const id = nextWindowId();
    const zIndex = state.zIndexCursor + 1;
    const newWindow = {
      id,
      appId,
      title: app.title,
      icon: app.icon,
      component: app.component,
      size: app.defaultSize ?? { width: 960, height: 640 },
      position: app.defaultPosition ?? { x: 120 + state.windows.length * 24, y: 120 },
      minimized: app.autoMinimized ?? false,
      zIndex,
    };

    set({
      windows: [...state.windows, newWindow],
      focusedWindowId: shouldFocus ? id : state.focusedWindowId,
      zIndexCursor: zIndex,
      taskbar: state.taskbar.includes(appId) ? state.taskbar : [...state.taskbar, appId],
    });

    return id;
  },

  closeWindow: (windowId) => {
    const state = get();
    const target = state.windows.find((w) => w.id === windowId);
    const remaining = state.windows.filter((win) => win.id !== windowId);
    set({
      windows: remaining,
      focusedWindowId: state.focusedWindowId === windowId ? null : state.focusedWindowId,
      taskbar: target ? state.taskbar.filter((appId) => appId !== target.appId) : state.taskbar,
    });
  },

  minimizeWindow: (windowId) => {
    set((state) => ({
      windows: state.windows.map((win) =>
        win.id === windowId ? { ...win, minimized: true } : win
      ),
      focusedWindowId: state.focusedWindowId === windowId ? null : state.focusedWindowId,
    }));
  },

  toggleMinimize: (windowId) => {
    set((state) => ({
      windows: state.windows.map((win) =>
        win.id === windowId ? { ...win, minimized: !win.minimized } : win
      ),
      focusedWindowId: windowId,
    }));
  },

  focusWindow: (windowId) => {
    const state = get();
    const zIndex = state.zIndexCursor + 1;
    set({
      windows: state.windows.map((win) =>
        win.id === windowId ? { ...win, minimized: false, zIndex } : win
      ),
      focusedWindowId: windowId,
      zIndexCursor: zIndex,
    });
  },

  moveWindow: (windowId, position) => {
    set((state) => ({
      windows: state.windows.map((win) =>
        win.id === windowId ? { ...win, position } : win
      ),
    }));
  },

  resizeWindow: (windowId, size) => {
    set((state) => ({
      windows: state.windows.map((win) =>
        win.id === windowId ? { ...win, size: { width: size.width, height: size.height }, position: { x: size.x, y: size.y } } : win
      ),
    }));
  },
}));

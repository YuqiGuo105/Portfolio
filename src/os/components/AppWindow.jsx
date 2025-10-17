'use client';

import { memo } from 'react';
import { Rnd } from 'react-rnd';
import { motion } from 'framer-motion';
import { useDesktopStore } from '../store/useDesktopStore';

const WINDOW_TRANSITION = { duration: 0.24, ease: 'easeOut' };

function AppWindowBase({ window }) {
  const closeWindow = useDesktopStore((state) => state.closeWindow);
  const minimizeWindow = useDesktopStore((state) => state.minimizeWindow);
  const focusWindow = useDesktopStore((state) => state.focusWindow);
  const moveWindow = useDesktopStore((state) => state.moveWindow);
  const resizeWindow = useDesktopStore((state) => state.resizeWindow);

  const Component = window.component;

  if (window.minimized) {
    return null;
  }

  return (
    <Rnd
      key={window.id}
      className="desktop-window"
      dragHandleClassName="desktop-window-header"
      size={window.size}
      position={window.position}
      onDrag={(position) => moveWindow(window.id, position)}
      onDragStop={(position) => moveWindow(window.id, position)}
      onResize={(next) => resizeWindow(window.id, next)}
      onResizeStop={(next) => resizeWindow(window.id, next)}
      style={{ zIndex: window.zIndex }}
    >
      <motion.div
        initial={{ opacity: 0.2, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={WINDOW_TRANSITION}
        onMouseDown={() => focusWindow(window.id)}
        onFocus={() => focusWindow(window.id)}
        tabIndex={0}
        style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}
      >
        <header className="desktop-window-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span aria-hidden>{window.icon}</span>
            <span>{window.title}</span>
          </div>
          <div className="controls">
            <button
              type="button"
              aria-label="Minimize"
              style={{ background: '#f5c542' }}
              onClick={() => minimizeWindow(window.id)}
            />
            <button
              type="button"
              aria-label="Close"
              style={{ background: '#f55f5f' }}
              onClick={() => closeWindow(window.id)}
            />
          </div>
        </header>
        <div className="desktop-window-content">
          {Component ? <Component windowId={window.id} /> : null}
        </div>
      </motion.div>
    </Rnd>
  );
}

const AppWindow = memo(AppWindowBase);
export default AppWindow;

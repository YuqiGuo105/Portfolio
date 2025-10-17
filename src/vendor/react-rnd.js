'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function useDrag({ onDrag, onDragStart, onDragStop, disabled }) {
  const pointerOffset = useRef({ x: 0, y: 0 });

  const cleanupRef = useRef(() => {});

  useEffect(() => () => cleanupRef.current?.(), []);

  const onPointerDown = useCallback(
    (event) => {
      if (disabled) return;
      const target = event.currentTarget;
      const { clientX, clientY } = event.touches?.[0] ?? event;
      const rect = target.getBoundingClientRect();
      pointerOffset.current = {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };

      const handleMove = (moveEvent) => {
        const { clientX: moveX, clientY: moveY } = moveEvent.touches?.[0] ?? moveEvent;
        const nextPosition = {
          x: moveX - pointerOffset.current.x,
          y: moveY - pointerOffset.current.y,
        };
        onDrag(nextPosition);
      };

      const handleUp = (upEvent) => {
        const { clientX: upX, clientY: upY } = upEvent.touches?.[0] ?? upEvent;
        const nextPosition = {
          x: upX - pointerOffset.current.x,
          y: upY - pointerOffset.current.y,
        };
        cleanup();
        onDragStop?.(nextPosition);
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('touchmove', handleMove);
        window.removeEventListener('touchend', handleUp);
      };

      cleanupRef.current = cleanup;

      window.addEventListener('pointermove', handleMove, { passive: false });
      window.addEventListener('pointerup', handleUp, { passive: false });
      window.addEventListener('touchmove', handleMove, { passive: false });
      window.addEventListener('touchend', handleUp, { passive: false });

      onDragStart?.(event);
    },
    [disabled, onDrag, onDragStart, onDragStop]
  );

  return onPointerDown;
}

function useResize({ onResize, onResizeStop, bounds }) {
  const initialSizeRef = useRef({ width: 0, height: 0, x: 0, y: 0 });
  const pointerRef = useRef({ x: 0, y: 0 });
  const cleanupRef = useRef(() => {});

  useEffect(() => () => cleanupRef.current?.(), []);

  const onPointerDown = useCallback(
    (direction, event, current) => {
      const { clientX, clientY } = event.touches?.[0] ?? event;
      pointerRef.current = { x: clientX, y: clientY };
      initialSizeRef.current = current;

      const handleMove = (moveEvent) => {
        const { clientX: moveX, clientY: moveY } = moveEvent.touches?.[0] ?? moveEvent;
        const deltaX = moveX - pointerRef.current.x;
        const deltaY = moveY - pointerRef.current.y;
        const next = { ...initialSizeRef.current };

        if (direction.includes('right')) {
          next.width = Math.max(200, initialSizeRef.current.width + deltaX);
        }
        if (direction.includes('bottom')) {
          next.height = Math.max(120, initialSizeRef.current.height + deltaY);
        }
        if (direction.includes('left')) {
          next.width = Math.max(200, initialSizeRef.current.width - deltaX);
          next.x = initialSizeRef.current.x + deltaX;
        }
        if (direction.includes('top')) {
          next.height = Math.max(120, initialSizeRef.current.height - deltaY);
          next.y = initialSizeRef.current.y + deltaY;
        }

        if (bounds) {
          next.x = clamp(next.x, bounds.minX, bounds.maxX);
          next.y = clamp(next.y, bounds.minY, bounds.maxY);
        }

        onResize(next);
      };

      const handleUp = (upEvent) => {
        cleanup();
        onResizeStop?.(upEvent);
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('touchmove', handleMove);
        window.removeEventListener('touchend', handleUp);
      };

      cleanupRef.current = cleanup;

      window.addEventListener('pointermove', handleMove, { passive: false });
      window.addEventListener('pointerup', handleUp, { passive: false });
      window.addEventListener('touchmove', handleMove, { passive: false });
      window.addEventListener('touchend', handleUp, { passive: false });

      event.stopPropagation();
      event.preventDefault();
    },
    [bounds, onResize, onResizeStop]
  );

  return onPointerDown;
}

export function Rnd({
  children,
  className,
  style,
  size,
  position,
  dragHandleClassName,
  disableDragging = false,
  enableResizing = {
    top: true,
    right: true,
    bottom: true,
    left: true,
    topRight: true,
    topLeft: true,
    bottomRight: true,
    bottomLeft: true,
  },
  bounds,
  onDragStop,
  onDragStart,
  onDrag,
  onResizeStop,
  onResize,
}) {
  const [internalSize, setInternalSize] = useState({
    width: size?.width ?? 480,
    height: size?.height ?? 320,
  });
  const [internalPosition, setInternalPosition] = useState({
    x: position?.x ?? 80,
    y: position?.y ?? 80,
  });

  const current = useMemo(
    () => ({ ...internalSize, ...internalPosition }),
    [internalSize, internalPosition]
  );

  useEffect(() => {
    if (size) setInternalSize(size);
  }, [size?.width, size?.height]);

  useEffect(() => {
    if (position) setInternalPosition(position);
  }, [position?.x, position?.y]);

  const dragHandler = useDrag({
    disabled: disableDragging,
    onDragStart,
    onDragStop,
    onDrag: ({ x, y }) => {
      const next = {
        x: bounds ? clamp(x, bounds.minX, bounds.maxX) : x,
        y: bounds ? clamp(y, bounds.minY, bounds.maxY) : y,
      };
      setInternalPosition(next);
      onDrag?.(next);
    },
  });

  const resizeHandler = useResize({
    bounds,
    onResizeStop,
    onResize: (next) => {
      setInternalSize({ width: next.width, height: next.height });
      setInternalPosition({ x: next.x, y: next.y });
      onResize?.(next);
    },
  });

  const enableHandles = Object.entries(enableResizing).filter(([, enabled]) => enabled);

  const handleDragStart = useCallback(
    (event) => {
      if (dragHandleClassName) {
        const handle = event.target.closest(`.${dragHandleClassName}`);
        if (!handle) return;
      }
      dragHandler(event);
    },
    [dragHandler, dragHandleClassName]
  );

  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        transform: `translate(${internalPosition.x}px, ${internalPosition.y}px)`,
        width: internalSize.width,
        height: internalSize.height,
        ...style,
      }}
    >
      <div
        className="rnd__draggable"
        style={{ width: '100%', height: '100%' }}
        onPointerDown={handleDragStart}
        onTouchStart={handleDragStart}
      >
        {children}
      </div>
      {enableHandles.map(([key]) => (
        <span
          key={key}
          className={`rnd__resize-handle rnd__${key}`}
          onPointerDown={(event) => resizeHandler(key, event, { ...internalSize, ...internalPosition })}
          onTouchStart={(event) => resizeHandler(key, event, { ...internalSize, ...internalPosition })}
        />
      ))}
      <style jsx>{`
        .rnd__resize-handle {
          position: absolute;
          width: 12px;
          height: 12px;
          background: transparent;
          z-index: 10;
        }
        .rnd__top {
          top: -6px;
          left: 50%;
          cursor: ns-resize;
        }
        .rnd__bottom {
          bottom: -6px;
          left: 50%;
          cursor: ns-resize;
        }
        .rnd__left {
          left: -6px;
          top: 50%;
          cursor: ew-resize;
        }
        .rnd__right {
          right: -6px;
          top: 50%;
          cursor: ew-resize;
        }
        .rnd__topRight {
          top: -6px;
          right: -6px;
          cursor: nesw-resize;
        }
        .rnd__topLeft {
          top: -6px;
          left: -6px;
          cursor: nwse-resize;
        }
        .rnd__bottomRight {
          bottom: -6px;
          right: -6px;
          cursor: nwse-resize;
        }
        .rnd__bottomLeft {
          bottom: -6px;
          left: -6px;
          cursor: nesw-resize;
        }
      `}</style>
    </div>
  );
}

export default Rnd;

'use client';

import { forwardRef, useEffect, useMemo, useRef } from 'react';

const applyInitial = (node, initial) => {
  if (!node || !initial) return;
  Object.entries(initial).forEach(([key, value]) => {
    node.style.setProperty(key, typeof value === 'number' ? `${value}px` : value);
  });
};

const applyAnimate = (node, animate, transition) => {
  if (!node || !animate) return;
  if (transition?.duration) {
    node.style.transition = `all ${transition.duration}s ${transition?.ease ?? 'ease-in-out'}`;
  }
  Object.entries(animate).forEach(([key, value]) => {
    node.style.setProperty(key, typeof value === 'number' ? `${value}px` : value);
  });
};

const createMotionComponent = (Tag) =>
  forwardRef(({ initial, animate, transition, style, children, ...rest }, ref) => {
    const nodeRef = useRef(null);

    useEffect(() => {
      const node = nodeRef.current;
      if (!node) return;
      applyInitial(node, initial);
      const raf = requestAnimationFrame(() => applyAnimate(node, animate, transition));
      return () => cancelAnimationFrame(raf);
    }, [initial, animate, transition]);

    const mergedRef = useMemo(() => {
      if (!ref) return nodeRef;
      return (value) => {
        nodeRef.current = value;
        if (typeof ref === 'function') ref(value);
        else if (ref) ref.current = value;
      };
    }, [ref]);

    return (
      <Tag ref={mergedRef} style={{ ...style }} {...rest}>
        {children}
      </Tag>
    );
  });

export const motion = {
  div: createMotionComponent('div'),
  section: createMotionComponent('section'),
  article: createMotionComponent('article'),
};

export const AnimatePresence = ({ children }) => children;

export default { motion, AnimatePresence };

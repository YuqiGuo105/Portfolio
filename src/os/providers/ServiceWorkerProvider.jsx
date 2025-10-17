'use client';

import { useEffect } from 'react';

export default function ServiceWorkerProvider({ children }) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register('/sw.js');
      } catch (error) {
        console.warn('Service worker registration failed', error);
      }
    };

    register();
  }, []);

  return children;
}

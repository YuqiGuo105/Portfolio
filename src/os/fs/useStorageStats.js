'use client';

import { useEffect, useState } from 'react';
import { fileSystem } from './fileSystem';

export const useStorageStats = () => {
  const [stats, setStats] = useState({ used: 0, quota: 0, usageDetails: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const run = async () => {
      try {
        setLoading(true);
        const usage = await fileSystem.getUsage();
        if (isMounted) setStats(usage);
      } catch (err) {
        if (isMounted) setError(err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    run();
    const interval = setInterval(run, 30000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return { stats, loading, error, refresh: () => fileSystem.getUsage().then(setStats) };
};

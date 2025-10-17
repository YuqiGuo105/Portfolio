'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { WorkerPool, getWorkerPool } from './pool';

const WorkerPoolContext = createContext(null);

export const WorkerPoolProvider = ({ children }) => {
  const [pool] = useState(() => getWorkerPool());
  const [snapshot, setSnapshot] = useState({ queue: [], activeJobs: [] });

  useEffect(() => {
    if (!(pool instanceof WorkerPool)) return undefined;
    const unsub = pool.subscribe(setSnapshot);
    return () => {
      unsub();
    };
  }, [pool]);

  const value = useMemo(() => ({ pool, snapshot }), [pool, snapshot]);

  return <WorkerPoolContext.Provider value={value}>{children}</WorkerPoolContext.Provider>;
};

export const useWorkerPool = () => {
  const ctx = useContext(WorkerPoolContext);
  if (!ctx) throw new Error('useWorkerPool must be used within WorkerPoolProvider');
  return ctx;
};

'use client';

import dynamic from 'next/dynamic';

const HomeApp = dynamic(() => import('../../apps/home/HomeApp'), { ssr: false });
const CalculatorApp = dynamic(() => import('../../apps/util/CalculatorApp'), { ssr: false });
const StorageManagerApp = dynamic(() => import('../../apps/util/StorageManagerApp'), { ssr: false });
const WorkerConsoleApp = dynamic(() => import('../../apps/util/WorkerConsoleApp'), { ssr: false });

const registry = new Map();
let initialized = false;

const ensureInitialized = () => {
  if (initialized) return;
  baseApps.forEach(registerApp);
  initialized = true;
};

const baseApps = [
  {
    id: 'home',
    title: 'Portfolio',
    icon: '🏠',
    component: HomeApp,
    singleton: true,
    autoStart: true,
    defaultSize: { width: 1200, height: 720 },
  },
  {
    id: 'calculator',
    title: 'Calculator',
    icon: '🧮',
    component: CalculatorApp,
    singleton: true,
    autoStart: false,
    defaultSize: { width: 320, height: 420 },
  },
  {
    id: 'storage',
    title: 'Storage Manager',
    icon: '💾',
    component: StorageManagerApp,
    singleton: true,
    autoStart: false,
    defaultSize: { width: 640, height: 520 },
  },
  {
    id: 'workbench',
    title: 'Worker Console',
    icon: '🛠️',
    component: WorkerConsoleApp,
    singleton: true,
    autoStart: false,
    defaultSize: { width: 600, height: 480 },
  },
];

export const registerApp = (definition) => {
  registry.set(definition.id, definition);
};

export const getAppDefinition = (id) => {
  ensureInitialized();
  return registry.get(id);
};

export const getAllApps = () => {
  ensureInitialized();
  return Array.from(registry.values());
};

export const getAutoStartApps = () => getAllApps().filter((app) => app.autoStart);

export const initializeRegistry = () => {
  ensureInitialized();
};

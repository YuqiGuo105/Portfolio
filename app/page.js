'use client';

import { useEffect } from 'react';
import Desktop from '../src/os/components/Desktop';
import { useDesktopStore } from '../src/os/store/useDesktopStore';
import { getAutoStartApps, initializeRegistry } from '../src/os/registry';

export default function Home() {
  const launchApp = useDesktopStore((state) => state.launchApp);

  useEffect(() => {
    initializeRegistry();
    const autoStarters = getAutoStartApps();
    autoStarters.forEach((app) => launchApp(app.id, { focus: false }));
  }, [launchApp]);

  return <Desktop />;
}

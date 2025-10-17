import './globals.css';
import ServiceWorkerProvider from '../src/os/providers/ServiceWorkerProvider';
import PermissionGateway from '../src/os/ipc/PermissionGateway';
import { WorkerPoolProvider } from '../src/os/workers/WorkerPoolProvider';

export const metadata = {
  title: 'Web OS Portfolio',
  description: 'A desktop-inspired OS experience for the portfolio.',
  manifest: '/manifest.json',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body>
        <ServiceWorkerProvider>
          <WorkerPoolProvider>
            {children}
            <PermissionGateway />
          </WorkerPoolProvider>
        </ServiceWorkerProvider>
      </body>
    </html>
  );
}

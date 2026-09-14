import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import type { AppGateway } from './app/gateway';
import { AppErrorBoundary } from './app/AppErrorBoundary';
const root = createRoot(document.getElementById('root')!);
async function start() {
  try {
    const mode = import.meta.env.VITE_APP_MODE || 'demo';
    const gateway: AppGateway =
      mode === 'demo'
        ? new (await import('./adapters/DemoGateway')).DemoGateway()
        : new (await import('./adapters/FirebaseGateway')).FirebaseGateway(
            mode === 'emulator' ? 'emulator' : 'firebase',
          );
    root.render(
      <React.StrictMode>
        <AppErrorBoundary>
          <App gateway={gateway} />
        </AppErrorBoundary>
      </React.StrictMode>,
    );
  } catch (error) {
    root.render(
      <main style={{ maxWidth: 600, margin: '12vh auto', padding: 24, fontFamily: 'sans-serif' }}>
        <h1>Emergent Hacks needs configuration</h1>
        <p>{error instanceof Error ? error.message : 'Unable to start the application.'}</p>
        <p>
          For a local demo, set <code>VITE_APP_MODE=demo</code> and restart the development server.
        </p>
      </main>,
    );
  }
}
void start();

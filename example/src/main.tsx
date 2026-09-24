import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ConnectionMode } from '@flanksource/mission-control-sdk';
import { Logs } from './Logs';
import { MissionControlProvider } from './MissionControlContext';
import './style.css';

const pluginRef = import.meta.env.VITE_PLUGIN_REF || 'kubernetes-logs';
const defaultMode = (import.meta.env.VITE_MC_MODE || 'proxy') as ConnectionMode;
const proxyBaseUrl = import.meta.env.VITE_MC_PROXY_BASE_URL || '/api/mission-control';
const passThroughBaseUrl = import.meta.env.VITE_MC_TARGET || 'http://localhost:8080';
const defaultBaseUrl = import.meta.env.VITE_MC_BASE_URL ||
  (defaultMode === 'pass-through' ? passThroughBaseUrl : proxyBaseUrl);

function App() {
  const [mode, setMode] = useState<ConnectionMode>(defaultMode);
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);

  function handleModeChange(nextMode: ConnectionMode) {
    setMode(nextMode);
    setBaseUrl(nextMode === 'pass-through' ? passThroughBaseUrl : proxyBaseUrl);
  }

  return (
    <main>
      <h1>Mission Control SDK Demo</h1>
      <p>
        Calls the <code>{pluginRef}</code> plugin using <code>@flanksource/mission-control-sdk</code>.
      </p>

      <section className="card">
        <label>
          Mode
          <select value={mode} onChange={e => handleModeChange(e.target.value as ConnectionMode)}>
            <option value="proxy">proxy</option>
            <option value="pass-through">pass-through</option>
          </select>
        </label>

        <label>
          Base URL
          <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
        </label>
      </section>

      <MissionControlProvider mode={mode} baseUrl={baseUrl}>
        <Logs />
      </MissionControlProvider>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

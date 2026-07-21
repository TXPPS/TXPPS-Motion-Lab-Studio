import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/arrangement.css';
import './styles/mixer.css';
import './styles/pianoroll.css';
import './styles/synth.css';
import './styles/panels.css';
import { installConsoleCapture, diagLog } from './state/diagnostics';
import { bootProject, installAutosave } from './app/projectActions';
import { midi } from './audio/midi';
import { registerPwa } from './pwa/registerPwa';
import { APP_VERSION, GIT_COMMIT } from './diagnostics/report';

installConsoleCapture();
diagLog('info', `TXPPS MotionLab Studio v${APP_VERSION} (${GIT_COMMIT}) starting`);

// Report MIDI support up front (does not prompt — that happens on Enable).
midi.reportSupport();

// Boot: restore last project / seed demo, then wire autosave.
const forceDemo = window.location.hash.includes('demo');
void bootProject(forceDemo).then(() => {
  installAutosave();
});

registerPwa();

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

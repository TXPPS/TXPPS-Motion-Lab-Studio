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
import './styles/recording.css';
import './styles/automation.css';
import './styles/sampler.css';
import { installConsoleCapture, diagLog } from './state/diagnostics';
import { bootProject, installAutosave } from './app/projectActions';
import { midi } from './audio/midi';
import { engine } from './audio/engine';
import { useProjectStore } from './state/projectStore';
import { registerPwa } from './pwa/registerPwa';
import { APP_VERSION, GIT_COMMIT } from './diagnostics/report';

installConsoleCapture();
diagLog('info', `TXPPS MotionLab Studio v${APP_VERSION} (${GIT_COMMIT}) starting`);

// Report MIDI support up front (does not prompt — that happens on Enable).
midi.reportSupport();

// Boot: restore last project / seed demo, then wire autosave.
// #/qa loads the layout stress fixture and deliberately skips autosave so QA
// runs can never overwrite a real project.
const hash = window.location.hash;
const qaFixture = hash.includes('qa');
void bootProject(hash.includes('demo'), qaFixture).then(() => {
  if (!qaFixture) installAutosave();
});

registerPwa();

/**
 * Test handle for automated audio verification.
 *
 * The offline renderer cannot be driven from jsdom (no Web Audio) and cannot be
 * driven through the UI either, since a download dialog is not assertable. This
 * exposes the render path so `e2e/export.spec.ts` can prove the bounce actually
 * contains the project's clips, notes, effects and sends.
 *
 * Read-only module references — no privileged action is reachable through it
 * that the UI does not already offer.
 */
void (async () => {
  const [exportMix, demoProject, uiStoreMod] = await Promise.all([
    import('./audio/exportMix'),
    import('./model/demoProject'),
    import('./state/uiStore'),
  ]);
  const w = window as unknown as { __ml?: Record<string, unknown> };
  // Merge: the engine already publishes meter/transport probes on this handle,
  // and replacing it wholesale would break every test that reads them.
  w.__ml = {
    ...(w.__ml ?? {}),
    exportMix,
    demoProject,
    engine,
    projectStore: useProjectStore,
    uiStore: uiStoreMod.useUiStore,
  };
})();

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

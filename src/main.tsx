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
import { applyAppearance } from './state/prefsStore';
import { bootProject, installAutosave } from './app/projectActions';
import { currentRoute } from './app/router';
import { midi } from './audio/midi';
import { engine } from './audio/engine';
import { useProjectStore } from './state/projectStore';
import { registerPwa } from './pwa/registerPwa';
import { APP_VERSION, GIT_COMMIT } from './diagnostics/report';

// Appearance is applied before React mounts so the first painted frame is
// already in the user's theme and scale — no flash of the default identity.
applyAppearance();

installConsoleCapture();
diagLog('info', `TXPPS MotionLab Studio v${APP_VERSION} (${GIT_COMMIT}) starting`);

// Report MIDI support up front (does not prompt — that happens on Enable).
midi.reportSupport();

// Boot: restore last project / seed demo, then wire autosave. A QA fixture
// route deliberately skips autosave so a QA run can never overwrite real work.
const bootRoute = currentRoute();
void bootProject(bootRoute).then(() => {
  if (!bootRoute.fixture) installAutosave();
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

/**
 * Boot guard: without these the store or the audio engine cannot function at
 * all, and the alternative is a blank white page. Everything else (recording,
 * MIDI, storage) degrades feature-by-feature with in-app messaging instead.
 */
function missingHardRequirements(): string[] {
  const w = window as unknown as Record<string, unknown>;
  const out: string[] = [];
  if (typeof structuredClone !== 'function') out.push('structuredClone');
  if (typeof w.AudioContext !== 'function' && typeof w.webkitAudioContext !== 'function') {
    out.push('Web Audio');
  }
  return out;
}

const rootEl = document.getElementById('root');
if (rootEl) {
  const missing = missingHardRequirements();
  if (missing.length > 0) {
    diagLog('error', `Unsupported browser — missing: ${missing.join(', ')}`);
    rootEl.innerHTML =
      '<div style="max-width:520px;margin:18vh auto;padding:24px;font-family:system-ui,sans-serif;color:#dfe5ec;background:#171c24;border:1px solid #323b47;border-radius:10px">' +
      '<h1 style="font-size:18px;margin:0 0 10px">This browser can’t run MotionLab Studio</h1>' +
      `<p style="line-height:1.5;margin:0 0 8px">It is missing: <strong>${missing.join(', ')}</strong>.</p>` +
      '<p style="line-height:1.5;margin:0">Please use a current version of Chrome, Edge, Firefox, or Safari 15.4+.</p>' +
      '</div>';
  } else {
    createRoot(rootEl).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  }
}

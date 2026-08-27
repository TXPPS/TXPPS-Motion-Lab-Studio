import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startSelectionReconciler } from './state/reconcileSelection';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/arrangement.css';
import './styles/mixer.css';
import './styles/channel.css';
/*
 * The Motion Wave design tokens.
 *
 * The units' panels style themselves from `--mw-*`, and without these they
 * mount unstyled — the face renders, the controls work, and it looks like
 * nothing. Imported here rather than copied into `src/styles/` because a copy
 * would be a second palette: U23 grades these tokens for completeness and
 * contrast in both themes, and it grades the file, not a duplicate of it.
 *
 * The prefix is what keeps the two systems apart. Nothing in MotionLab reads a
 * `--mw-` variable and nothing in a unit reads MotionLab's.
 */
import '../motionwave/ui/design/tokens.css';
import './styles/pianoroll.css';
import './styles/synth.css';
import './styles/panels.css';
import './styles/recording.css';
import './styles/automation.css';
import './styles/sampler.css';
import './styles/pages.css';
import './styles/audioeditor.css';
import './styles/drumeditor.css';
import './styles/score.css';
import './styles/settings.css';
import { installConsoleCapture, diagLog } from './state/diagnostics';
import { applyAppearance } from './state/prefsStore';
import { bootProject, installAutosave } from './app/projectActions';
import { currentRoute } from './app/router';
import { startAutomationRunners } from './app/automationActions';
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

// Write-mode automation records without being touched, so its runner has to be
// live before the first control move rather than started by one.
startAutomationRunners();

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
  const [
    exportMix,
    demoProject,
    uiStoreMod,
    encode,
    freeze,
    effects,
    mwRegistry,
    shortcuts,
    projectRepo,
  ] = await Promise.all([
    import('./audio/exportMix'),
    import('./model/demoProject'),
    import('./state/uiStore'),
    import('./audio/encode'),
    import('./audio/freeze'),
    import('./model/effects'),
    import('./audio/motionwave/registry'),
    import('./app/shortcuts'),
    import('./persistence/projectRepo'),
  ]);
  const w = window as unknown as { __ml?: Record<string, unknown> };
  // Merge: the engine already publishes meter/transport probes on this handle,
  // and replacing it wholesale would break every test that reads them.
  w.__ml = {
    ...(w.__ml ?? {}),
    exportMix,
    // The encoders are here so a test can hand a file the app produced to the
    // browser's own decoder: a format round-tripped only through its own
    // reader is proof of self-consistency, not of a readable file.
    encode,
    demoProject,
    // Freezing is a render into storage, so proving it is transparent needs a
    // real browser — the same reason the export path is exposed here.
    freeze,
    engine,
    projectStore: useProjectStore,
    uiStore: uiStoreMod.useUiStore,
    // The axes the soak sweep enumerates over.
    //
    // Read from the same declarations the UI builds itself from, so a sweep
    // cannot cover a list that has stopped matching the product — which is the
    // failure `docs/FUNCTION_LEDGER.md` exists to make impossible one layer up.
    // They are lists of names, and nothing here is a privileged action.
    shortcuts: shortcuts.SHORTCUTS.map((s) => ({ id: s.id, combo: s.combo, when: s.when ?? null })),
    // Deduplicated: the Motion Wave units appear in both lists, so a sweep over
    // this rendered each of them twice and reported fourteen findings where
    // there are seven.
    effectKinds: [
      ...new Set([
        ...effects.EFFECT_SPECS.map((e) => e.kind),
        ...mwRegistry.MOTIONWAVE_UNITS.map((u) => u.kind),
      ]),
    ],
    instrumentKinds: ['synth', 'quick', 'drum', 'multi'],
    // The real persistence boundary, so a soak can round-trip a project through
    // the code that actually opens one rather than through `JSON.parse`. The two
    // are not the same function: `validateProject` *drops* what it cannot read,
    // which is the behaviour worth fuzzing and the one a shape-only round trip
    // cannot see.
    projectRepo,
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

// Started before anything renders, so no component ever sees a selection that
// names something the project has already lost.
startSelectionReconciler();

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
    loadWebFonts();
  }
}

/**
 * Fetch the type after the chrome is on screen.
 *
 * A `<link rel="stylesheet">` in the head blocks rendering until it resolves,
 * and `display=swap` governs when the *font* swaps in, not when the
 * *stylesheet* arrives — so linking it there held first paint for 12.6
 * seconds when the CDN was unreachable, in a product that claims to work with
 * no network at all. Injecting it after mount is non-blocking by
 * construction: the system UI face paints immediately, Plex swaps in when it
 * lands, and if it never lands nothing is lost but the typeface.
 */
function loadWebFonts(): void {
  const href =
    'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600' +
    '&family=IBM+Plex+Sans+Condensed:wght@500;600' +
    '&family=IBM+Plex+Mono:wght@400;500&display=swap';
  const add = () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    // A failed fetch is not an error worth reporting: the fallback stack is
    // the design's own, not a degradation.
    document.head.appendChild(link);
  };
  if ('requestIdleCallback' in window) {
    (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(add);
  } else {
    setTimeout(add, 0);
  }
}

/**
 * Builds the plain-text diagnostic report and runs the in-app smoke test.
 * The report is designed to be copy-pasted into another AI conversation.
 */
import { engine } from '../audio/engine';
import { layoutReportLines } from './layout';
import { getDbStatus } from '../persistence/db';
import { loadProject, saveProject } from '../persistence/projectRepo';
import { useDiagnosticsStore, type SmokeResult } from '../state/diagnostics';
import { useProjectStore } from '../state/projectStore';
import { useTransportStore } from '../state/transportStore';

declare const __APP_VERSION__: string;
declare const __GIT_COMMIT__: string;
declare const __BUILD_TIME__: string;

export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
export const GIT_COMMIT = typeof __GIT_COMMIT__ !== 'undefined' ? __GIT_COMMIT__ : 'dev';
export const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'dev';

export interface DiagField {
  key: string;
  value: string;
  status?: 'ok' | 'warn' | 'err';
}

function swStatus(): string {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';
  const reg = navigator.serviceWorker.controller;
  return reg ? 'active' : 'registered/none';
}

function displayMode(): string {
  if (typeof window === 'undefined' || !window.matchMedia) return 'unknown';
  if (window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
  if (window.matchMedia('(display-mode: fullscreen)').matches) return 'fullscreen';
  if (window.matchMedia('(display-mode: minimal-ui)').matches) return 'minimal-ui';
  return 'browser';
}

export function collectFields(): DiagField[] {
  const t = useTransportStore.getState();
  const p = useProjectStore.getState().project;
  const db = getDbStatus();
  const nav = typeof navigator !== 'undefined' ? navigator : ({} as Navigator);
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
  const audioOk = t.audioState === 'running';

  return [
    { key: 'App version', value: APP_VERSION },
    { key: 'Git commit', value: GIT_COMMIT },
    { key: 'Build time', value: BUILD_TIME },
    { key: 'User agent', value: nav.userAgent ?? 'n/a' },
    { key: 'Platform', value: (nav as Navigator).platform ?? 'n/a' },
    { key: 'Viewport', value: `${vw}×${vh} @${(window.devicePixelRatio || 1).toFixed(2)}x` },
    { key: 'Online', value: String(online), status: online ? 'ok' : 'warn' },
    { key: 'PWA display', value: displayMode() },
    {
      key: 'Service worker',
      value: swStatus(),
      status: swStatus() === 'active' ? 'ok' : 'warn',
    },
    {
      key: 'AudioContext',
      value: t.audioState,
      status: audioOk ? 'ok' : t.audioState === 'error' ? 'err' : 'warn',
    },
    { key: 'Sample rate', value: t.sampleRate ? `${t.sampleRate} Hz` : 'n/a' },
    { key: 'Active audio sources', value: String(t.activeSources) },
    { key: 'Transport', value: t.playState },
    {
      key: 'MIDI support',
      value: t.midiSupported ? (t.midiEnabled ? 'enabled' : 'supported') : 'unsupported',
      status: t.midiSupported ? 'ok' : 'warn',
    },
    {
      key: 'MIDI device',
      value: t.midiSelectedId
        ? (t.midiInputs.find((i) => i.id === t.midiSelectedId)?.name ?? 'selected')
        : t.midiInputs.length
          ? `${t.midiInputs.length} available`
          : 'none',
    },
    { key: 'Project', value: p.name },
    { key: 'Tempo', value: `${p.bpm} BPM · ${p.timeSig.num}/${p.timeSig.den}` },
    { key: 'Track count', value: String(p.tracks.length) },
    { key: 'Clip count', value: String(p.clips.length) },
    {
      key: 'IndexedDB',
      value: `${db.status} (${db.detail})`,
      status: db.status === 'ok' ? 'ok' : db.status === 'error' ? 'err' : 'warn',
    },
  ];
}

export function buildReport(): string {
  const diag = useDiagnosticsStore.getState();
  const fields = collectFields();
  const warnings = diag.entries.filter((e) => e.level === 'warn');
  const errors = diag.entries.filter((e) => e.level === 'error');
  const lines: string[] = [];
  lines.push('=== TXPPS MotionLab Studio — Diagnostic Report ===');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  for (const f of fields) lines.push(`${f.key.padEnd(22)}: ${f.value}`);
  lines.push('');
  if (typeof document !== 'undefined') {
    for (const line of layoutReportLines()) lines.push(line);
    lines.push('');
  }
  lines.push(`Smoke test status: ${diag.smokeStatus}`);
  for (const r of diag.smokeResults) {
    lines.push(`  [${r.pass ? 'PASS' : 'FAIL'}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  lines.push('');
  lines.push(`Recent warnings (${warnings.length}):`);
  for (const w of warnings.slice(-12))
    lines.push(`  ${new Date(w.time).toLocaleTimeString()}  ${w.message}`);
  lines.push('');
  lines.push(`Recent errors (${errors.length}):`);
  for (const e of errors.slice(-12))
    lines.push(`  ${new Date(e.time).toLocaleTimeString()}  ${e.message}`);
  if (errors.length === 0) lines.push('  (none)');
  lines.push('');
  lines.push('=== end of report ===');
  return lines.join('\n');
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * In-app smoke test: exercises the real audio engine, transport, project
 * mutations, and persistence round-trip. Returns pass/fail per check.
 */
export async function runSmokeTest(): Promise<SmokeResult[]> {
  const diag = useDiagnosticsStore.getState();
  diag.setSmoke('running', []);
  const results: SmokeResult[] = [];
  const check = (name: string, pass: boolean, detail = '') => {
    results.push({ name, pass, detail });
  };

  // 1. audio context
  const started = await engine.start();
  check(
    'Audio engine starts',
    started,
    started ? `state=running` : 'context did not reach running',
  );

  // 2. project has content
  const proj = useProjectStore.getState().project;
  check('Project loaded with tracks', proj.tracks.length > 0, `${proj.tracks.length} tracks`);
  check('Project has clips', proj.clips.length > 0, `${proj.clips.length} clips`);

  // 3. transport play/stop cycle
  let playOk = false;
  let movedOk = false;
  if (started) {
    await engine.play(0);
    await delay(280);
    const pos = engine.getPositionBeats();
    playOk = useTransportStore.getState().playState === 'playing';
    movedOk = pos > 0.05;
    const sourcesWhilePlaying = engine.activeSourceCount();
    engine.stop();
    await delay(140);
    check('Transport plays', playOk, `playing with ${sourcesWhilePlaying} live sources`);
    check('Playhead advances', movedOk, `reached beat ${pos.toFixed(2)}`);
    check(
      'Transport stops cleanly',
      useTransportStore.getState().playState === 'stopped',
      `${engine.activeSourceCount()} sources after stop`,
    );
  } else {
    check('Transport plays', false, 'skipped — audio not started (needs user gesture)');
    check('Playhead advances', false, 'skipped');
    check('Transport stops cleanly', false, 'skipped');
  }

  // 4. no runaway sources
  const srcCount = useTransportStore.getState().activeSources;
  check('No runaway audio sources', srcCount < 64, `${srcCount} active`);

  // 5. state mutation (add/remove track) round-trips
  const store = useProjectStore.getState();
  const before = store.project.tracks.length;
  const newTid = store.addTrack('instrument');
  const added = useProjectStore.getState().project.tracks.length === before + 1;
  store.deleteTrack(newTid);
  const removed = useProjectStore.getState().project.tracks.length === before;
  check('Track add/remove works', added && removed, `count ${before}→${before + 1}→${before}`);

  // 6. persistence round-trip
  try {
    const cur = useProjectStore.getState().project;
    await saveProject(cur);
    const back = await loadProject(cur.id);
    check(
      'Project saves & reloads (IndexedDB)',
      !!back && back.tracks.length === cur.tracks.length,
      back ? `reloaded ${back.tracks.length} tracks` : 'reload returned null',
    );
  } catch (e) {
    check('Project saves & reloads (IndexedDB)', false, e instanceof Error ? e.message : String(e));
  }

  // 7. diagnostics report generates
  const report = buildReport();
  check('Diagnostic report generates', report.length > 100, `${report.length} chars`);

  const allPass = results.every((r) => r.pass);
  diag.setSmoke(allPass ? 'pass' : 'fail', results);
  return results;
}

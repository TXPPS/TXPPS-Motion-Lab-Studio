/**
 * Builds the plain-text diagnostic report and runs the in-app smoke test.
 * The report is designed to be copy-pasted into another AI conversation.
 */
import { engine } from '../audio/engine';
import { audioInput } from '../audio/inputManager';
import { exportState } from '../app/exportActions';
import { cacheStats, isMissing } from '../audio/mediaLibrary';
import { pickMimeType, recorderSupported } from '../audio/recorder';
import { layoutReportLines } from './layout';
import { getDbStatus } from '../persistence/db';
import { listRecoveries, mediaStorageStats, storageEstimate } from '../persistence/mediaStore';
import { loadProject, saveProject } from '../persistence/projectRepo';
import { diagLog, useDiagnosticsStore, type SmokeResult } from '../state/diagnostics';
import { permissionLabel, useInputStore } from '../state/inputStore';
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

/**
 * Storage figures need IndexedDB and `navigator.storage`, both async, while the
 * report is built synchronously. The sheet refreshes this snapshot when it
 * opens; until then the fields say so rather than reporting a stale zero.
 */
interface StorageSnapshot {
  at: number;
  mediaCount: number;
  mediaBytes: number;
  usage: number;
  quota: number;
  recoveries: number;
}
let storageSnapshot: StorageSnapshot | null = null;

export async function refreshStorageDiagnostics(): Promise<void> {
  try {
    const [stats, est, recs] = await Promise.all([
      mediaStorageStats(),
      storageEstimate(),
      listRecoveries(),
    ]);
    storageSnapshot = {
      at: Date.now(),
      mediaCount: stats.count,
      mediaBytes: stats.bytes,
      usage: est?.usage ?? 0,
      quota: est?.quota ?? 0,
      recoveries: recs.length,
    };
    useInputStore.getState().set({ pendingRecoveries: recs.length });
  } catch (e) {
    diagLog('warn', `Could not read storage diagnostics: ${String(e)}`);
  }
}

function mb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Milestone 2 fields: input, recording, media and mixer processing. */
function m2Fields(): DiagField[] {
  const inp = useInputStore.getState();
  const p = useProjectStore.getState().project;
  const cache = cacheStats();
  const tracks = p.tracks;

  const audioTracks = tracks.filter((t) => t.type === 'audio');
  const armed = audioTracks.filter((t) => t.armed);
  const monitoring = tracks.filter((t) => t.monitoring);
  const effects = tracks.flatMap((t) => t.effects ?? []);
  const sends = tracks.flatMap((t) => t.sends ?? []).filter((s) => s.enabled);
  const streams = audioInput.activeTrackStates();
  const exp = exportState();

  // A clip whose media never resolved is the failure users actually notice.
  const audioClips = p.clips.filter((c) => c.type === 'audio');
  const missing = [...new Set(audioClips.map((c) => c.mediaId))].filter((id) => isMissing(id));

  const snap = storageSnapshot;
  const quotaPct =
    snap && snap.quota > 0 ? ` (${((snap.usage / snap.quota) * 100).toFixed(1)}% of quota)` : '';

  return [
    {
      key: 'Mic permission',
      value: permissionLabel(inp.permission),
      status: inp.permission === 'granted' ? 'ok' : inp.permission === 'denied' ? 'err' : 'warn',
    },
    {
      key: 'Input devices',
      // Labels are only populated once the browser allows them.
      value: inp.devices.length
        ? `${inp.devices.length}${inp.devices.some((d) => d.label) ? '' : ' (labels withheld)'}`
        : 'none enumerated',
    },
    {
      key: 'Recorder support',
      value: recorderSupported() ? (pickMimeType() ?? 'browser default') : 'unsupported',
      status: recorderSupported() ? 'ok' : 'err',
    },
    {
      key: 'Recording state',
      value:
        inp.phase === 'recording'
          ? `recording ${inp.recordSeconds.toFixed(1)}s${
              inp.recorderMimeType ? ` (${inp.recorderMimeType})` : ''
            }`
          : inp.phase,
      status: inp.phase === 'error' ? 'err' : 'ok',
    },
    { key: 'Last record error', value: inp.lastRecordError ?? 'none' },
    {
      key: 'Last take',
      value: inp.lastTake
        ? `${inp.lastTake.durationSec.toFixed(2)}s, ${mb(inp.lastTake.bytes)}, ${
            inp.lastTake.mimeType
          }${inp.lastTake.silent ? ' — SILENT' : ''}`
        : 'none this session',
      status: inp.lastTake?.silent ? 'warn' : undefined,
    },
    {
      key: 'Open input streams',
      value: streams.length
        ? streams.map((s) => `${s.device.slice(0, 10)}:${s.readyState}${s.muted ? ':muted' : ''}`).join(', ')
        : 'none',
      status: streams.some((s) => s.muted) ? 'warn' : undefined,
    },
    {
      key: 'Monitoring',
      value: monitoring.length
        ? `${monitoring.length} track(s), engine reports ${engine.monitoringCount()}`
        : 'off',
      status: monitoring.length !== engine.monitoringCount() ? 'warn' : undefined,
    },
    { key: 'Armed audio tracks', value: `${armed.length} of ${audioTracks.length}` },
    { key: 'Project media refs', value: String((p.media ?? []).length) },
    {
      key: 'Stored media',
      value: snap ? `${snap.mediaCount} items, ${mb(snap.mediaBytes)}` : 'not sampled yet',
    },
    {
      key: 'Storage used',
      value: snap ? `${mb(snap.usage)} of ${mb(snap.quota)}${quotaPct}` : 'not sampled yet',
      status: snap && snap.quota > 0 && snap.usage / snap.quota > 0.9 ? 'warn' : undefined,
    },
    {
      key: 'Unrecovered takes',
      value: snap ? String(snap.recoveries) : 'not sampled yet',
      status: snap && snap.recoveries > 0 ? 'warn' : undefined,
    },
    {
      key: 'Decoded buffers',
      value: `${cache.buffers} buffers, ${cache.peaks} peak sets`,
    },
    {
      key: 'Missing media',
      value: missing.length ? `${missing.length}: ${missing.slice(0, 3).join(', ')}` : 'none',
      status: missing.length ? 'err' : 'ok',
    },
    {
      key: 'Insert effects',
      value: effects.length
        ? `${effects.length} (${effects.filter((e) => e.bypass).length} bypassed)`
        : 'none',
    },
    { key: 'Active sends', value: String(sends.length) },
    {
      key: 'Audio graph',
      value: `${tracks.length} channels, ${tracks.filter((t) => t.type === 'bus').length} buses, ${
        effects.length
      } inserts, ${sends.length} sends`,
    },
    {
      key: 'Export status',
      value: exp.stage === 'idle' ? 'idle' : `${exp.stage}${exp.message ? ` — ${exp.message}` : ''}`,
      status: exp.stage === 'error' ? 'err' : undefined,
    },
    { key: 'Last export', value: exp.lastResult ?? 'none this session' },
  ];
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
    ...m2Fields(),
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

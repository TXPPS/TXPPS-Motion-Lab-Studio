/**
 * Automation clipboard + touch/latch capture.
 *
 * The clipboard is app-local (not the OS clipboard): normalized values with
 * beats relative to the earliest copied point, so a paste is defined at any
 * playhead position and across parameters — pasting a volume ride onto a
 * filter lane is a legitimate move, which is exactly why lane values are
 * normalized in the first place.
 *
 * Capture implements touch and latch. While the transport runs and the
 * track's mode is touch or latch, a control move writes points at the
 * playhead, overwriting whatever the pass covers. Touch stops writing when
 * the control is released; latch keeps writing the last value until the
 * transport stops.
 */
import { engine } from '../audio/engine';
import type { CurveShape } from '../model/automation';
import { findAutoParam, normParam } from '../model/paramRegistry';
import { useProjectStore } from '../state/projectStore';
import { useTransportStore } from '../state/transportStore';
import { useUiStore } from '../state/uiStore';

export interface AutoClipboardData {
  /** parameter the points came from (informational only) */
  sourceParamId: string;
  points: { beat: number; value: number; curve: CurveShape }[];
}

let clipboard: AutoClipboardData | null = null;

export function copyAutomationSelection(): boolean {
  const sel = useUiStore.getState().autoSel;
  if (!sel || sel.pointIds.length === 0) return false;
  const p = useProjectStore.getState().project;
  const lane = p.tracks
    .find((t) => t.id === sel.trackId)
    ?.automation?.find((l) => l.id === sel.laneId);
  if (!lane) return false;
  const points = lane.points.filter((x) => sel.pointIds.includes(x.id));
  if (points.length === 0) return false;
  const minBeat = Math.min(...points.map((x) => x.beat));
  clipboard = {
    sourceParamId: lane.paramId,
    points: points.map((x) => ({ beat: x.beat - minBeat, value: x.value, curve: x.curve })),
  };
  useUiStore.getState().toast('info', `Copied ${points.length} automation point${points.length === 1 ? '' : 's'}`);
  return true;
}

export function hasAutomationClipboard(): boolean {
  return clipboard !== null;
}

/** Paste into a lane at a beat (default: the playhead). One undo step. */
export function pasteAutomation(trackId: string, laneId: string, atBeat?: number): boolean {
  if (!clipboard) return false;
  const beat = Math.max(0, atBeat ?? engine.getPositionBeats());
  const ids = useProjectStore
    .getState()
    .insertAutomationPoints(
      trackId,
      laneId,
      clipboard.points.map((x) => ({ beat: beat + x.beat, value: x.value, curve: x.curve })),
    );
  if (ids.length === 0) return false;
  useUiStore.getState().set({ autoSel: { trackId, laneId, pointIds: ids } });
  return true;
}

/** Duplicate the selection immediately after its span. One undo step. */
export function duplicateAutomationSelection(): boolean {
  const sel = useUiStore.getState().autoSel;
  if (!sel || sel.pointIds.length === 0) return false;
  const p = useProjectStore.getState().project;
  const lane = p.tracks
    .find((t) => t.id === sel.trackId)
    ?.automation?.find((l) => l.id === sel.laneId);
  if (!lane) return false;
  const points = lane.points.filter((x) => sel.pointIds.includes(x.id));
  if (points.length === 0) return false;
  const minBeat = Math.min(...points.map((x) => x.beat));
  const span = Math.max(0.25, Math.max(...points.map((x) => x.beat)) - minBeat);
  const ids = useProjectStore.getState().insertAutomationPoints(
    sel.trackId,
    sel.laneId,
    points.map((x) => ({ beat: x.beat + span, value: x.value, curve: x.curve })),
  );
  useUiStore.getState().set({ autoSel: { ...sel, pointIds: ids } });
  return true;
}

export function deleteAutomationSelection(): boolean {
  const sel = useUiStore.getState().autoSel;
  if (!sel || sel.pointIds.length === 0) return false;
  useProjectStore.getState().deleteAutomationPoints(sel.trackId, sel.laneId, sel.pointIds);
  useUiStore.getState().set({ autoSel: { ...sel, pointIds: [] } });
  return true;
}

// ---------------------------------------------------------------------------
// Touch / latch capture
// ---------------------------------------------------------------------------

interface CaptureSession {
  trackId: string;
  paramId: string;
  laneId: string;
  lastBeat: number;
  lastValue: number;
  /** touch sessions end on release; latch sessions persist until stop */
  latch: boolean;
  /** control released (latch keeps writing the held value) */
  released: boolean;
}

const sessions = new Map<string, CaptureSession>();
let frameUnsub: (() => void) | null = null;
let transportUnsub: (() => void) | null = null;

function key(trackId: string, paramId: string): string {
  return `${trackId}|${paramId}`;
}

/**
 * Route a control change into automation when the track is recording it.
 * Returns true when the move was captured (the control still applies its
 * static value; the lane simply records the ride on top).
 */
export function captureParamChange(trackId: string, paramId: string, value: number): boolean {
  if (!engine.isPlaying()) return false;
  const p = useProjectStore.getState().project;
  const track = p.tracks.find((t) => t.id === trackId);
  if (!track) return false;
  const mode = track.automationMode ?? 'read';
  if (mode !== 'touch' && mode !== 'latch') return false;
  const param = findAutoParam(track, p, paramId);
  if (!param) return false;

  let laneId = track.automation?.find((l) => l.paramId === paramId)?.id ?? null;
  if (!laneId) laneId = useProjectStore.getState().addAutomationLane(trackId, paramId);
  if (!laneId) return false;

  const beat = engine.getPositionBeats();
  const norm = normParam(param, value);
  const k = key(trackId, paramId);
  const existing = sessions.get(k);
  const since = existing ? existing.lastBeat : beat;
  useProjectStore.getState().writeAutomationAt(trackId, laneId, beat, norm, since);
  sessions.set(k, {
    trackId,
    paramId,
    laneId,
    lastBeat: beat,
    lastValue: norm,
    latch: mode === 'latch',
    released: false,
  });
  ensureRunners();
  return true;
}

/** The owning control's gesture ended (pointer up on the fader/knob). */
export function captureParamRelease(trackId: string, paramId: string): void {
  const k = key(trackId, paramId);
  const s = sessions.get(k);
  if (!s) return;
  if (s.latch && engine.isPlaying()) {
    s.released = true; // latch: keep writing the held value until stop
  } else {
    sessions.delete(k);
  }
}

/** Latch tick: extend released sessions to the current playhead. */
function tick(): void {
  if (sessions.size === 0) return;
  if (!engine.isPlaying()) {
    sessions.clear();
    return;
  }
  const beat = engine.getPositionBeats();
  for (const s of sessions.values()) {
    if (!s.released) continue;
    if (beat - s.lastBeat < 0.1) continue;
    useProjectStore.getState().writeAutomationAt(s.trackId, s.laneId, beat, s.lastValue, s.lastBeat);
    s.lastBeat = beat;
  }
}

function ensureRunners(): void {
  if (!frameUnsub) frameUnsub = engine.onFrame(() => tick());
  if (!transportUnsub) {
    transportUnsub = useTransportStore.subscribe((s, prev) => {
      if (s.playState !== prev.playState && s.playState !== 'playing') sessions.clear();
    });
  }
}

/** Test hook: active capture sessions. */
export function activeCaptureCount(): number {
  return sessions.size;
}

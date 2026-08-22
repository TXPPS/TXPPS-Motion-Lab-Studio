/**
 * Bend / warp: the lane of markers over the waveform, and the actions under it.
 *
 * The lane is drawn on the recording's own timeline, which is the timeline the
 * waveform beneath it is already drawn on, so a marker sits on the sound it
 * pins. The beat grid is drawn where the map currently puts each beat: warp a
 * take and the grid lines walk onto its transients, which is the picture that
 * tells a musician whether the map is right before they press play.
 *
 * Dragging previews locally and commits on release — one undo step per drag,
 * and one warp render per drag rather than one per pointer event.
 */
import { useRef, useState } from 'react';
import { analyseTransients } from '../../model/transients';
import {
  beatToSource,
  quantizeWarp,
  resetWarp,
  sourceToBeat,
  stretchRatioAt,
  warpFromTransients,
  type WarpMap,
} from '../../model/warp';
import {
  addWarpMarker,
  moveWarpMarker,
  nearestTransient,
  removeWarpMarker,
  warpMarkerNear,
} from '../../model/warpEdit';
import type { AudioClip } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';

/** How close a pointer counts as being on a marker, in pixels. */
const HIT_PX = 7;
/** How close a drag counts as being on a transient, in pixels. */
const SNAP_PX = 6;
/** Arrow-key nudge, in source seconds; a tenth of that is below one sample. */
const NUDGE_SEC = 0.002;
/** A dense grid over a long clip is a grey wash, not a guide. */
const MAX_GRID_LINES = 400;

interface LaneProps {
  map: WarpMap;
  /** The window of the source the waveform beneath is showing. */
  offsetSec: number;
  durationSec: number;
  /** End of the media, past which a marker pins nothing. */
  maxSourceSec: number;
  transients: number[] | undefined;
  gridBeats: number;
  onChange: (map: WarpMap) => void;
}

export function WarpLane({
  map,
  offsetSec,
  durationSec,
  maxSourceSec,
  transients,
  gridBeats,
  onChange,
}: LaneProps) {
  const laneRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ index: number; sourceSec: number } | null>(null);

  const shown = drag ? moveWarpMarker(map, drag.index, drag.sourceSec, maxSourceSec) : map;
  const xOf = (sec: number) => ((sec - offsetSec) / durationSec) * 100;
  const secAt = (clientX: number, rect: DOMRect) =>
    offsetSec + ((clientX - rect.left) / Math.max(1, rect.width)) * durationSec;
  /** Source seconds per pixel: every tolerance below is stated in pixels. */
  const secPerPx = (rect: DOMRect) => durationSec / Math.max(1, rect.width);

  const startDrag = (e: React.PointerEvent, index: number) => {
    const lane = laneRef.current;
    if (!lane || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = lane.getBoundingClientRect();
    const pid = e.pointerId;
    const from = map.markers[index].sourceSec;
    try {
      lane.setPointerCapture(pid);
    } catch {
      /* capture unavailable */
    }
    let at = from;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      const raw = secAt(ev.clientX, rect);
      // Onsets are what a marker wants to be on; shift lets a musician say no.
      const snapped = ev.shiftKey
        ? null
        : nearestTransient(transients, raw, SNAP_PX * secPerPx(rect));
      at = snapped ?? raw;
      setDrag({ index, sourceSec: at });
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      lane.removeEventListener('pointermove', move);
      lane.removeEventListener('pointerup', up);
      lane.removeEventListener('pointercancel', up);
      setDrag(null);
      if (at !== from) onChange(moveWarpMarker(map, index, at, maxSourceSec));
    };
    lane.addEventListener('pointermove', move);
    lane.addEventListener('pointerup', up);
    lane.addEventListener('pointercancel', up);
  };

  const hitAt = (clientX: number): { sec: number; index: number; perPx: number } => {
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect) return { sec: 0, index: -1, perPx: 0 };
    const sec = secAt(clientX, rect);
    const perPx = secPerPx(rect);
    return { sec, perPx, index: warpMarkerNear(map, sec, HIT_PX * perPx) };
  };

  const doubleClick = (e: React.MouseEvent) => {
    const { sec, index, perPx } = hitAt(e.clientX);
    if (index >= 0) {
      onChange(removeWarpMarker(map, index));
      return;
    }
    // An onset a little further off than a marker still wins the double-click:
    // aiming at a transient is what the gesture is for.
    onChange(addWarpMarker(map, nearestTransient(transients, sec, HIT_PX * perPx * 2) ?? sec));
  };

  const contextMenu = (e: React.MouseEvent) => {
    const { index } = hitAt(e.clientX);
    if (index < 0) return;
    e.preventDefault();
    onChange(removeWarpMarker(map, index));
  };

  const key = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onChange(removeWarpMarker(map, index));
      return;
    }
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const by = NUDGE_SEC * (e.shiftKey ? 10 : 1) * step;
    onChange(moveWarpMarker(map, index, map.markers[index].sourceSec + by, maxSourceSec));
  };

  const gridLines: number[] = [];
  if (gridBeats > 0 && durationSec > 0) {
    const first = Math.ceil(sourceToBeat(shown, offsetSec) / gridBeats) * gridBeats;
    const last = sourceToBeat(shown, offsetSec + durationSec);
    for (let b = first; b <= last && gridLines.length < MAX_GRID_LINES; b += gridBeats) {
      gridLines.push(b);
    }
  }

  return (
    <div
      className="ae-warp-lane"
      ref={laneRef}
      role="group"
      aria-label="Warp markers"
      data-testid="warp-lane"
      onDoubleClick={doubleClick}
      onContextMenu={contextMenu}
    >
      {gridLines.map((beat) => (
        <span
          key={`g${beat}`}
          className={`ae-warp-grid${Math.abs(beat % 4) < 1e-6 ? ' bar' : ''}`}
          style={{ left: `${xOf(beatToSource(shown, beat))}%` }}
          aria-hidden
        />
      ))}
      {(transients ?? []).map((t) => (
        <span key={`t${t}`} className="ae-warp-onset" style={{ left: `${xOf(t)}%` }} aria-hidden />
      ))}
      {shown.markers.map((m, i) => {
        const x = xOf(m.sourceSec);
        if (x < -2 || x > 102) return null;
        const ratio = stretchRatioAt(shown, m.beat);
        return (
          <button
            key={`${i}-${m.beat}`}
            type="button"
            className={`ae-warp-marker${drag?.index === i ? ' dragging' : ''}`}
            style={{ left: `${x}%` }}
            data-testid={`warp-marker-${i}`}
            aria-label={`Warp marker at ${m.sourceSec.toFixed(3)} seconds, pinned to beat ${
              Math.round(m.beat * 1000) / 1000
            }`}
            title={`Beat ${Math.round(m.beat * 100) / 100} · ${ratio.toFixed(2)}× from here`}
            onPointerDown={(e) => startDrag(e, i)}
            onKeyDown={(e) => key(e, i)}
          >
            <span className="ae-warp-flag">{Math.round(m.beat * 100) / 100}</span>
          </button>
        );
      })}
    </div>
  );
}

interface PanelProps {
  clip: AudioClip;
  map: WarpMap;
  buffer: AudioBuffer | null;
  gridBeats: number;
  strength: number;
  onGrid: (grid: number) => void;
  onStrength: (strength: number) => void;
  onChange: (map: WarpMap) => void;
}

export function WarpPanel({
  clip,
  map,
  buffer,
  gridBeats,
  strength,
  onGrid,
  onStrength,
  onChange,
}: PanelProps) {
  const [busy, setBusy] = useState(false);

  /**
   * Read the onsets off the audio and pin each one to the grid slot it is
   * nearest. Analysing again rather than reusing the clip's stored transient
   * times is what makes the strengths available, and the strengths are what
   * keep a ghost note from dragging a whole bar onto the wrong beat.
   */
  const detect = () => {
    if (!buffer) {
      useUiStore.getState().toast('error', 'That clip’s audio is not decoded yet.');
      return;
    }
    setBusy(true);
    // A task boundary so the button paints its busy state before the analysis
    // blocks the thread.
    window.setTimeout(() => {
      try {
        const result = analyseTransients(buffer.getChannelData(0), buffer.sampleRate);
        const confident = result.tempo && result.tempo.confidence > 0.3;
        const sourceBpm = confident
          ? Math.round(result.tempo!.bpm * 10) / 10
          : (clip.sourceBpm ?? map.sourceBpm);
        useProjectStore.getState().setClip(clip.id, {
          transients: result.transients.map((t) => Math.round(t.timeSec * 1000) / 1000),
          ...(confident ? { sourceBpm } : {}),
        });
        const next = warpFromTransients(result.transients, sourceBpm, gridBeats);
        onChange(next);
        useUiStore
          .getState()
          .toast(
            'info',
            next.markers.length
              ? `${next.markers.length} markers from ${result.transients.length} onsets`
              : 'No onset landed near enough to a grid slot to pin.',
          );
      } finally {
        setBusy(false);
      }
    }, 16);
  };

  // One ratio per segment — the span after the last marker runs at the
  // recorded tempo and is not something the map bent.
  const ratios = map.markers.slice(0, -1).map((m) => stretchRatioAt(map, m.beat));
  const slowest = ratios.length ? Math.min(...ratios) : 1;
  const fastest = ratios.length ? Math.max(...ratios) : 1;

  return (
    <>
      <p className="t-body">
        Each marker pins one point in the recording to one beat. Drag a marker onto the sound that
        should land on its beat; double-click an empty spot to add one at the nearest onset, and
        double-click or right-click a marker to remove it.
      </p>
      <div className="ae-row">
        <span className="k">Grid</span>
        <select
          value={gridBeats}
          onChange={(e) => onGrid(Number(e.target.value))}
          aria-label="Warp grid"
          data-testid="warp-grid"
        >
          <option value={4}>1 bar</option>
          <option value={1}>1/4</option>
          <option value={0.5}>1/8</option>
          <option value={0.25}>1/16</option>
        </select>
        <span className="v t-num">{map.sourceBpm.toFixed(1)} BPM</span>
      </div>
      <div className="ae-row">
        <span className="k">Quantize</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={strength}
          aria-label="Quantize strength"
          title="0 leaves the performance alone; 1 puts every marker exactly on its slot"
          onChange={(e) => onStrength(Number(e.target.value))}
        />
        <span className="v t-num">{Math.round(strength * 100)}%</span>
      </div>
      <div className="ae-actions">
        <button className="btn" onClick={detect} disabled={busy} data-testid="warp-detect">
          <Icon name="bend" size={13} /> {busy ? 'Listening…' : 'Detect'}
        </button>
        <button
          className="btn"
          onClick={() => onChange(quantizeWarp(map, strength, gridBeats))}
          disabled={map.markers.length === 0}
          data-testid="warp-quantize"
        >
          Quantize
        </button>
        <button
          className="btn"
          onClick={() => onChange(resetWarp(map))}
          disabled={map.markers.length === 0}
          data-testid="warp-reset"
        >
          Reset
        </button>
        <span className="hint" data-testid="warp-summary">
          {/* One marker only anchors: time bends between a pair, never around one. */}
          {map.markers.length === 0
            ? 'No markers — the clip plays at its recorded tempo'
            : map.markers.length === 1
              ? '1 marker — pin a second one to bend the time between them'
              : `${map.markers.length} markers · ${slowest.toFixed(2)}×–${fastest.toFixed(2)}×`}
        </span>
      </div>
      <p className="hint">
        Warping is rendered through the time stretcher, so the pitch stays put while the timing
        moves. The render runs in the background: the first bar or so after a drag can still be the
        unwarped take.
      </p>
    </>
  );
}

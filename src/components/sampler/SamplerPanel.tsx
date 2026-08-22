/**
 * The four sampler instruments.
 *
 * Quick Sampler, Drum Rack, Multisample and Instrument Rack are four different
 * instruments over one zone model, and the reference's rule is that an
 * instrument's face is signal-ordered and that its *performance* surface — the
 * waveform, the pad grid, the key map, the layer stack — is the largest thing
 * on it. A sampler that looks like a synth is a tell that nobody designed it,
 * and so is four samplers that look like each other.
 *
 * So each view owns its own top half, and they share the tail every sampler
 * has: filter, amplitude envelope, modulator, output. Everything drawn there
 * comes from `model/synthFace.ts`, which reports what
 * `audio/samplerInstrument.ts` builds — including the places it builds nothing,
 * which is why "LFO → filter" with no filter now says so instead of offering
 * two controls that reach nothing.
 */
import { memo, useCallback, useMemo, useState } from 'react';
import { engine } from '../../audio/engine';
import { getBufferSync } from '../../audio/mediaLibrary';
import { formatHz } from '../../model/effects';
import { clamp, midiToName } from '../../model/music';
import {
  buildDrumKit,
  detectTransients,
  makeZone,
  snapToZeroCrossing,
  zonePlaybackRate,
  DRUM_PAD_BASE,
  MAX_DRUM_PADS,
  type SamplerParams,
  type SampleZone,
} from '../../model/sampler';
import {
  formatSeconds,
  lfoSweepHz,
  rackLayersAt,
  samplerAmpEnvelope,
  samplerLfoOf,
  samplerVoiceFilter,
  zonePlaySeconds,
  zoneWindowOf,
} from '../../model/synthFace';
import { PROCEDURAL_MEDIA_IDS } from '../../model/media';
import type { RackItem, Track } from '../../model/types';
import { TRACK_COLORS } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { ParamKnob } from '../common/widgets';
import { EnvelopeGraph, FilterCurve, InstrumentSection, LfoScope } from '../instrument/displays';
import { InstrumentFrame } from '../instrument/InstrumentFrame';
import { Waveform } from '../arrangement/Waveform';
import { Keyboard } from '../synth/Keyboard';
import { ZoneMap } from './ZoneMap';

/** One undo entry per knob sweep, not one per animation frame. */
const beginKnob = () => useProjectStore.getState().beginGesture();
const endKnob = () => useProjectStore.getState().endGesture();

const preview = (trackId: string, pitch: number, vel = 110) => {
  void engine.start().then(() => {
    engine.liveNoteOn(trackId, pitch, vel);
    setTimeout(() => engine.liveNoteOff(trackId, pitch), 260);
  });
};

/** Media dropped from the browser (text/x-ml-media) or a browser row id. */
function droppedMediaId(e: React.DragEvent): string | null {
  const id = e.dataTransfer.getData('text/x-ml-media');
  return id || null;
}

function num(v: string, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** The four edges of a zone's playback window that can be dragged. */
type Edge = 'start' | 'end' | 'loopStart' | 'loopEnd';

const EDGE_LABEL: Record<Edge, string> = {
  start: 'Window start',
  end: 'Window end',
  loopStart: 'Loop start',
  loopEnd: 'Loop end',
};

/**
 * Move one edge of the window, with the bounds the voice will apply anyway.
 *
 * Clamping here rather than only in the drawing means the number stored is the
 * number the audio uses, so the marker cannot be pulled somewhere the voice
 * will quietly ignore.
 */
function edgePatch(edge: Edge, sec: number, zone: SampleZone, dur: number): Partial<SampleZone> {
  const w = zoneWindowOf(zone, dur);
  switch (edge) {
    case 'start':
      return { startSec: clamp(sec, 0, w.endSec - 0.01) };
    case 'end':
      return { endSec: clamp(sec, w.startSec + 0.01, dur) };
    case 'loopStart':
      return { loopStartSec: clamp(sec, w.startSec, w.loopEndSec - 0.003) };
    case 'loopEnd':
      return { loopEndSec: clamp(sec, w.loopStartSec + 0.003, w.endSec) };
  }
}

const edgeValue = (edge: Edge, zone: SampleZone, dur: number): number => {
  const w = zoneWindowOf(zone, dur);
  return edge === 'start'
    ? w.startSec
    : edge === 'end'
      ? w.endSec
      : edge === 'loopStart'
        ? w.loopStartSec
        : w.loopEndSec;
};

/** How far one arrow key moves a marker, and how far Shift makes it. */
const NUDGE_SEC = 0.01;

/**
 * One draggable marker on the waveform.
 *
 * A slider, not a decorated div: it carries the second it is on as its value,
 * it takes the arrow keys, and it says which edge it is. The four markers were
 * previously two divs with a `title` and no keyboard route at all.
 */
function WindowHandle({
  edge,
  track,
  zone,
  dur,
}: {
  edge: Edge;
  track: Track;
  zone: SampleZone;
  dur: number;
}) {
  const store = useProjectStore;
  const buf = getBufferSync(zone.mediaId);
  const value = edgeValue(edge, zone, dur);

  const apply = (sec: number) =>
    store.getState().updateSamplerZones(track.id, [zone.id], () => edgePatch(edge, sec, zone, dur));

  const onPointerDown = usePointerDrag<{ v0: number; w: number }>({
    onStart: (e) => {
      store.getState().beginGesture();
      const host = (e.currentTarget as HTMLElement).parentElement;
      return { v0: value, w: host?.clientWidth || 1 };
    },
    onMove: (dx, _dy, e2, d) => {
      let sec = d.v0 + (dx / d.w) * dur;
      // Zero-crossing assist unless Alt is held.
      if (buf && !e2.altKey) {
        sec = snapToZeroCrossing(buf.getChannelData(0), buf.sampleRate, sec, 0.008);
      }
      apply(sec);
    },
    onEnd: () => store.getState().endGesture(),
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    store.getState().beginGesture();
    apply(value + dir * NUDGE_SEC * (e.shiftKey ? 10 : 1));
    store.getState().endGesture();
  };

  const loop = edge === 'loopStart' || edge === 'loopEnd';
  return (
    <button
      type="button"
      className={`smp-handle ${edge === 'start' || edge === 'loopStart' ? 'l' : 'r'}${
        loop ? ' loop' : ''
      }`}
      style={{
        // The clamp keeps the 10px grip fully inside the clipped container at
        // the extremes — Firefox hit-tests overflow-clipped children strictly,
        // so a half-outside handle would be ungrabbable at 0% and 100% there.
        left: `clamp(0px, calc(${(value / dur) * 100}% - 5px), calc(100% - 10px))`,
      }}
      role="slider"
      aria-label={EDGE_LABEL[edge]}
      aria-valuemin={0}
      aria-valuemax={Math.round(dur * 1000) / 1000}
      aria-valuenow={Math.round(value * 1000) / 1000}
      aria-valuetext={`${value.toFixed(3)} seconds`}
      title={`${EDGE_LABEL[edge]} — drag, or arrow keys (Alt bypasses zero-crossing snap)`}
      data-testid={
        edge === 'start' ? 'smp-trim-start' : edge === 'end' ? 'smp-trim-end' : `smp-${edge}`
      }
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}

function ZoneWaveEditor({ track, zone }: { track: Track; zone: SampleZone }) {
  const buf = getBufferSync(zone.mediaId);
  const dur = buf?.duration ?? 4;
  // The window the voice will actually play, not the raw fields: a loop point
  // authored outside the trim is pulled inside it before a note sounds, and
  // drawing the raw number puts the band where nothing happens.
  const w = zoneWindowOf(zone, dur);
  const pct = (sec: number) => `${(sec / dur) * 100}%`;

  return (
    <>
      <div className="smp-wave" data-testid="smp-wave">
        <Waveform
          mediaId={zone.mediaId}
          offsetSec={0}
          durationSec={dur}
          // A canvas cannot resolve a custom property, so this has to be a
          // real colour. The track's is the right one: a sample loaded into a
          // channel is that channel's material, and identity is track colour.
          color={track.color}
          gain={zone.gain}
          fadeIn={0}
          fadeOut={0}
          widthPx={640}
          heightPx={90}
        />
        {/* dimmed outside the playback window */}
        <div className="smp-dim" style={{ left: 0, width: pct(w.startSec) }} />
        <div className="smp-dim" style={{ left: pct(w.endSec), right: 0 }} />
        {w.loop && (
          <div
            className="smp-loop"
            style={{ left: pct(w.loopStartSec), width: pct(w.loopEndSec - w.loopStartSec) }}
          />
        )}
        {(zone.slices ?? []).map((s, i) => (
          <div
            key={i}
            className="smp-slice"
            style={{ left: pct(s) }}
            title={`Slice ${i + 1}`}
            aria-hidden
          />
        ))}
        <WindowHandle edge="start" track={track} zone={zone} dur={dur} />
        <WindowHandle edge="end" track={track} zone={zone} dur={dur} />
        {w.loop && <WindowHandle edge="loopStart" track={track} zone={zone} dur={dur} />}
        {w.loop && <WindowHandle edge="loopEnd" track={track} zone={zone} dur={dur} />}
      </div>
      <div className="ins-legend smp-wave-axis">
        <span className="t-label">
          Window <span className="t-num">{formatSeconds(w.windowSec)}</span>
        </span>
        <span className="grow" />
        <span className="t-label">
          At root, plays{' '}
          <span className="t-num">{formatSeconds(zonePlaySeconds(zone, dur, zone.rootNote))}</span>
        </span>
      </div>
    </>
  );
}

function QuickView({ track, params }: { track: Track; params: SamplerParams }) {
  const store = useProjectStore;
  const ui = useUiStore;
  const zone = params.zones[0];
  if (!zone) {
    return (
      <InstrumentSection title="Sample" wide testId="smp-quick">
        <div
          className="smp-drop"
          data-testid="smp-drop"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('text/x-ml-media')) e.preventDefault();
          }}
          onDrop={(e) => {
            const id = droppedMediaId(e);
            if (!id) return;
            e.preventDefault();
            store.getState().addSamplerZones(track.id, [makeZone({ mediaId: id, name: id })]);
          }}
        >
          Drag a sample here from the Browser → Samples tab
          <button
            className="btn"
            onClick={() =>
              store
                .getState()
                .addSamplerZones(track.id, [
                  makeZone({ mediaId: PROCEDURAL_MEDIA_IDS[0], name: 'Perc Loop' }),
                ])
            }
          >
            Load demo loop
          </button>
        </div>
      </InstrumentSection>
    );
  }
  const upd = (patch: Partial<SampleZone>) =>
    store.getState().updateSamplerZones(track.id, [zone.id], () => patch);
  const buf = getBufferSync(zone.mediaId);

  return (
    <InstrumentSection
      title="Sample"
      aside={`${zone.name} · ${midiToName(zone.rootNote)}`}
      wide
      testId="smp-quick"
    >
      <ZoneWaveEditor track={track} zone={zone} />
      <div className="smp-row">
        <button
          className="btn"
          onClick={() => preview(track.id, zone.rootNote)}
          data-testid="smp-preview"
        >
          Preview
        </button>
        <label>
          Root
          <input
            type="number"
            min={0}
            max={127}
            value={zone.rootNote}
            onChange={(e) => upd({ rootNote: num(e.target.value, 60) })}
            aria-label="Root note"
          />
          <span className="mono">{midiToName(zone.rootNote)}</span>
        </label>
        <label>
          Tune
          <input
            type="number"
            min={-48}
            max={48}
            value={zone.tuneCoarse}
            onChange={(e) => upd({ tuneCoarse: num(e.target.value, 0) })}
            aria-label="Coarse tune (semitones)"
          />
          st
          <input
            type="number"
            min={-100}
            max={100}
            value={zone.tuneFine}
            onChange={(e) => upd({ tuneFine: num(e.target.value, 0) })}
            aria-label="Fine tune (cents)"
          />
          ct
        </label>
        <button
          className={`th-mini wide${zone.loop ? ' on' : ''}`}
          aria-pressed={zone.loop}
          onClick={() => upd({ loop: !zone.loop })}
          title="Loop the playback window"
        >
          LOOP
        </button>
        <button
          className={`th-mini wide${zone.reverse ? ' on' : ''}`}
          aria-pressed={zone.reverse}
          onClick={() => upd({ reverse: !zone.reverse })}
          title="Reverse playback"
          data-testid="smp-reverse"
        >
          REV
        </button>
        <button
          className={`th-mini wide${zone.oneShot ? ' on' : ''}`}
          aria-pressed={zone.oneShot}
          onClick={() => upd({ oneShot: !zone.oneShot })}
          title="One-shot: ignore note-off"
        >
          1SHOT
        </button>
        <button
          className="btn"
          title="Set zone gain so the window peaks at -0.3 dBFS"
          onClick={() => {
            if (!buf) {
              ui.getState().toast('error', 'Start audio once so the sample can be decoded.');
              return;
            }
            const data = buf.getChannelData(0);
            const w = zoneWindowOf(zone, buf.duration);
            const from = Math.floor(w.startSec * buf.sampleRate);
            const to = Math.min(data.length, Math.floor(w.endSec * buf.sampleRate));
            let peak = 0;
            for (let i = from; i < to; i++) {
              const a = Math.abs(data[i]);
              if (a > peak) peak = a;
            }
            if (peak > 1e-6) upd({ gain: Math.min(4, Math.pow(10, -0.3 / 20) / peak) });
          }}
        >
          Normalize
        </button>
      </div>
      <div className="smp-row">
        <span className="hint">Slices: {zone.slices?.length ?? 0}</span>
        <button
          className="btn"
          data-testid="smp-detect"
          onClick={() => {
            if (!buf) {
              ui.getState().toast('error', 'Start audio once so the sample can be decoded.');
              return;
            }
            const w = zoneWindowOf(zone, buf.duration);
            const markers = detectTransients(buf.getChannelData(0), buf.sampleRate).filter(
              (s) => s >= w.startSec && s <= w.endSec,
            );
            store.getState().setZoneSlices(track.id, zone.id, markers);
            ui.getState().toast(
              'info',
              `${markers.length} transient${markers.length === 1 ? '' : 's'} marked`,
            );
          }}
        >
          Detect transients
        </button>
        <button
          className="btn"
          onClick={() => store.getState().setZoneSlices(track.id, zone.id, [])}
        >
          Clear
        </button>
        <button
          className="btn"
          data-testid="smp-to-pads"
          disabled={!zone.slices?.length}
          onClick={() => {
            const n = store.getState().sliceToPads(track.id, zone.id);
            ui.getState().toast('info', `${n} slices → drum pads`);
          }}
        >
          Slices → pads
        </button>
        <button
          className="btn"
          disabled={!zone.slices?.length}
          onClick={() => {
            const id = store
              .getState()
              .sliceToMidiClip(track.id, zone.id, Math.floor(engine.getPositionBeats()));
            if (id) ui.getState().toast('info', 'MIDI clip created from slices');
          }}
        >
          Slices → MIDI
        </button>
      </div>
    </InstrumentSection>
  );
}

/**
 * Velocity from where the pad was struck.
 *
 * A pad grid is a performance surface, and the one thing a real one has that a
 * button does not is that it answers to how you hit it. The top of the pad is
 * full velocity and the bottom is a ghost note; the keyboard route plays the
 * pad at a fixed strong velocity, because a key press has no position.
 */
const PAD_MIN_VELOCITY = 34;
function padVelocity(e: React.MouseEvent<HTMLElement>): number {
  const box = e.currentTarget.getBoundingClientRect();
  if (box.height <= 0) return 110;
  const down = clamp((e.clientY - box.top) / box.height, 0, 1);
  return Math.round(PAD_MIN_VELOCITY + (1 - down) * (127 - PAD_MIN_VELOCITY));
}

function DrumView({ track, params }: { track: Track; params: SamplerParams }) {
  const store = useProjectStore;
  const [selected, setSelected] = useState<string | null>(null);
  const [padCount, setPadCount] = useState(16);
  const byIndex = useMemo(() => {
    const m = new Map<number, SampleZone>();
    for (const z of params.zones) {
      if (z.keyLo === z.keyHi) m.set(z.keyLo - DRUM_PAD_BASE, z);
    }
    return m;
  }, [params.zones]);
  const maxIndex = Math.max(15, ...[...byIndex.keys()]);
  const count = Math.min(MAX_DRUM_PADS, Math.max(padCount, maxIndex + 1));
  const sel = params.zones.find((z) => z.id === selected) ?? null;
  const anySolo = params.zones.some((z) => z.solo);

  return (
    <div className="smp-drum" data-testid="smp-drum">
      <div className="pad-grid" data-testid="pad-grid">
        {Array.from({ length: count }, (_, i) => {
          const z = byIndex.get(i);
          const key = DRUM_PAD_BASE + i;
          // A pad that will not sound reads as switched off, not as disabled:
          // the zone matcher drops muted zones, and un-soloed ones whenever
          // anything is soloed.
          const silenced = !!z && (z.muted || (anySolo && !z.solo));
          const trigger = (velocity: number) => {
            if (!z) return;
            setSelected(z.id);
            preview(track.id, key, velocity);
          };
          return (
            <div
              key={i}
              className={`pad${z ? '' : ' empty'}${z && z.id === selected ? ' selected' : ''}${
                silenced ? ' muted' : ''
              }`}
              style={
                z?.color
                  ? ({ ['--pad-color' as string]: z.color } as React.CSSProperties)
                  : undefined
              }
              data-testid={`pad-${i}`}
              role="button"
              tabIndex={z ? 0 : -1}
              aria-label={
                z
                  ? `Pad ${i + 1}: ${z.name} (${midiToName(key)})${silenced ? ', silent' : ''}`
                  : `Empty pad ${i + 1}`
              }
              onClick={(e) => trigger(padVelocity(e))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  trigger(110);
                }
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('text/x-ml-media')) e.preventDefault();
              }}
              onDrop={(e) => {
                const id = droppedMediaId(e);
                if (!id) return;
                e.preventDefault();
                store.getState().assignPad(track.id, i, id, id.replace(/^hit-/, ''));
              }}
              title={
                z
                  ? `${z.name} — strike low for soft, high for hard; drop a sample to replace`
                  : 'Drop a sample here'
              }
            >
              <span className="pad-index t-num">{i + 1}</span>
              {z?.chokeGroup !== undefined && (
                <span className="pad-choke t-num" title={`Choke group ${z.chokeGroup}`}>
                  C{z.chokeGroup}
                </span>
              )}
              <span className="pad-name">{z?.name ?? '—'}</span>
              <span className="pad-key mono">{midiToName(key)}</span>
            </div>
          );
        })}
      </div>
      <div className="smp-row">
        <button className="btn" onClick={() => setPadCount((c) => Math.min(MAX_DRUM_PADS, c + 8))}>
          + 8 pads
        </button>
        <button
          className="btn"
          onClick={() => store.getState().applySamplerPreset(track.id, buildDrumKit())}
          data-testid="load-kit"
        >
          Load 808-ish kit
        </button>
        <span className="hint">Strike a pad low for soft, high for hard.</span>
      </div>
      {sel && (
        <div className="smp-row pad-detail" data-testid="pad-detail">
          <input
            type="text"
            value={sel.name}
            onChange={(e) =>
              store
                .getState()
                .updateSamplerZones(track.id, [sel.id], () => ({ name: e.target.value }))
            }
            aria-label="Pad name"
            style={{ width: 90 }}
          />
          <select
            value={sel.color ?? TRACK_COLORS[0]}
            onChange={(e) =>
              store
                .getState()
                .updateSamplerZones(track.id, [sel.id], () => ({ color: e.target.value }))
            }
            aria-label="Pad color"
          >
            {TRACK_COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            className={`th-mini${sel.muted ? ' m-on' : ''}`}
            aria-pressed={!!sel.muted}
            aria-label="Mute pad"
            onClick={() =>
              store.getState().updateSamplerZones(track.id, [sel.id], (z) => ({ muted: !z.muted }))
            }
          >
            M
          </button>
          <button
            className={`th-mini${sel.solo ? ' s-on' : ''}`}
            aria-pressed={!!sel.solo}
            aria-label="Solo pad"
            onClick={() =>
              store.getState().updateSamplerZones(track.id, [sel.id], (z) => ({ solo: !z.solo }))
            }
          >
            S
          </button>
          <ParamKnob
            label="Gain"
            norm={clamp(sel.gain / 2, 0, 1)}
            onNorm={(n) =>
              store.getState().updateSamplerZones(track.id, [sel.id], () => ({
                gain: Math.round(n * 2 * 100) / 100,
              }))
            }
            display={`${Math.round(sel.gain * 100)}%`}
            size={34}
            onGestureStart={beginKnob}
            onGestureEnd={endKnob}
          />
          <ParamKnob
            label="Pan"
            norm={(sel.pan + 1) / 2}
            onNorm={(n) =>
              store.getState().updateSamplerZones(track.id, [sel.id], () => ({
                pan: Math.round((n * 2 - 1) * 100) / 100,
              }))
            }
            display={
              sel.pan === 0
                ? 'C'
                : `${Math.abs(Math.round(sel.pan * 100))}${sel.pan < 0 ? 'L' : 'R'}`
            }
            size={34}
            onGestureStart={beginKnob}
            onGestureEnd={endKnob}
          />
          <label>
            Pitch
            <input
              type="number"
              min={-24}
              max={24}
              value={sel.tuneCoarse}
              onChange={(e) =>
                store.getState().updateSamplerZones(track.id, [sel.id], () => ({
                  tuneCoarse: num(e.target.value, 0),
                }))
              }
              aria-label="Pad pitch (semitones)"
            />
            <span className="hint t-num">{zonePlaybackRate(sel, sel.rootNote).toFixed(2)}×</span>
          </label>
          <label>
            Choke
            <input
              type="number"
              min={0}
              max={8}
              value={sel.chokeGroup ?? 0}
              onChange={(e) => {
                const g = num(e.target.value, 0);
                store.getState().updateSamplerZones(track.id, [sel.id], () => ({
                  chokeGroup: g > 0 ? g : undefined,
                }));
              }}
              aria-label="Choke group (0 = none)"
            />
          </label>
          <button
            className="th-mini"
            title="Remove pad"
            aria-label="Remove pad"
            onClick={() => {
              store.getState().removeSamplerZones(track.id, [sel.id]);
              setSelected(null);
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One multisample zone row. The store clones the whole project per update, so
 * zone identity never survives an edit — the memo comparator checks the fields
 * this row actually renders, which keeps a 500-zone instrument responsive by
 * re-rendering one row per edit instead of all of them.
 */
const zoneRowEq = (a: SampleZone, b: SampleZone) =>
  a.id === b.id &&
  a.name === b.name &&
  a.mediaId === b.mediaId &&
  a.keyLo === b.keyLo &&
  a.keyHi === b.keyHi &&
  a.velLo === b.velLo &&
  a.velHi === b.velHi &&
  a.rootNote === b.rootNote &&
  a.rrGroup === b.rrGroup;

const ZoneRow = memo(
  function ZoneRow({
    trackId,
    z,
    selected,
    onSelect,
  }: {
    trackId: string;
    z: SampleZone;
    selected: boolean;
    onSelect: (id: string) => void;
  }) {
    const store = useProjectStore;
    const upd = (patch: Partial<SampleZone>) =>
      store.getState().updateSamplerZones(trackId, [z.id], () => patch);
    return (
      // Reaching a row — by pointer or by tab — is what selects it on the map
      // above. Selection is a consequence of where you are, so it needs no
      // control of its own and no second keyboard route.
      <div
        className={`zone-row${selected ? ' selected' : ''}`}
        data-testid="zone-row"
        onFocusCapture={() => onSelect(z.id)}
        onPointerDown={() => onSelect(z.id)}
      >
        <button
          className="th-mini"
          title="Preview at root"
          aria-label={`Preview ${z.name}`}
          onClick={() => preview(trackId, z.rootNote)}
        >
          ▶
        </button>
        <span className="alh-name" title={`${z.name} (${z.mediaId})`}>
          {z.name}
        </span>
        <label>
          Key
          <input
            type="number"
            min={0}
            max={127}
            value={z.keyLo}
            aria-label="Key low"
            onChange={(e) => upd({ keyLo: num(e.target.value, 0) })}
          />
          –
          <input
            type="number"
            min={0}
            max={127}
            value={z.keyHi}
            aria-label="Key high"
            onChange={(e) => upd({ keyHi: num(e.target.value, 127) })}
          />
        </label>
        <label>
          Root
          <input
            type="number"
            min={0}
            max={127}
            value={z.rootNote}
            aria-label="Zone root"
            onChange={(e) => upd({ rootNote: num(e.target.value, 60) })}
          />
        </label>
        <label>
          Vel
          <input
            type="number"
            min={1}
            max={127}
            value={z.velLo}
            aria-label="Velocity low"
            onChange={(e) => upd({ velLo: num(e.target.value, 1) })}
          />
          –
          <input
            type="number"
            min={1}
            max={127}
            value={z.velHi}
            aria-label="Velocity high"
            onChange={(e) => upd({ velHi: num(e.target.value, 127) })}
          />
        </label>
        <label>
          RR
          <input
            type="number"
            min={0}
            max={99}
            value={z.rrGroup ?? 0}
            aria-label="Round-robin group"
            onChange={(e) => {
              const g = num(e.target.value, 0);
              upd({ rrGroup: g > 0 ? g : undefined });
            }}
          />
        </label>
        <div className="zone-strip" aria-hidden="true">
          <div
            style={{
              left: `${(z.keyLo / 127) * 100}%`,
              width: `${(Math.max(1, z.keyHi - z.keyLo) / 127) * 100}%`,
            }}
          />
        </div>
        <button
          className="th-mini"
          title="Remove zone"
          aria-label={`Remove ${z.name}`}
          onClick={() => store.getState().removeSamplerZones(trackId, [z.id])}
        >
          ×
        </button>
      </div>
    );
  },
  (prev, next) =>
    prev.trackId === next.trackId && prev.selected === next.selected && zoneRowEq(prev.z, next.z),
);

function MultiView({ track, params }: { track: Track; params: SamplerParams }) {
  const store = useProjectStore;
  const [selected, setSelected] = useState<string | null>(null);
  const onSelect = useCallback((id: string) => setSelected(id), []);
  const selectedId = params.zones.some((z) => z.id === selected) ? selected : null;

  return (
    <>
      <InstrumentSection
        title="Key and velocity map"
        wide
        testId="smp-multi"
        aside={`${params.zones.length} zone${params.zones.length === 1 ? '' : 's'}`}
      >
        <ZoneMap zones={params.zones} selectedId={selectedId} />
        <div className="ins-legend">
          <span className="t-label">Overlaps crossfade</span>
          <span className="grow" />
          <span className="t-label">Focus a zone below to trace it</span>
        </div>
      </InstrumentSection>
      <InstrumentSection title="Zones" wide>
        <div className="zone-list">
          {params.zones.map((z) => (
            <ZoneRow
              key={z.id}
              trackId={track.id}
              z={z}
              selected={z.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
        <div className="smp-row">
          <button
            className="btn"
            data-testid="add-zone"
            onClick={() =>
              store.getState().addSamplerZones(track.id, [
                makeZone({
                  mediaId: PROCEDURAL_MEDIA_IDS[1],
                  name: `Zone ${params.zones.length + 1}`,
                }),
              ])
            }
          >
            + Zone
          </button>
          <span className="hint">
            Overlapping key ranges crossfade; drop samples from the browser onto rows to replace.
          </span>
        </div>
      </InstrumentSection>
    </>
  );
}

/** The key span of one layer, drawn where the rack will actually reach it. */
function LayerBar({ item, audible }: { item: RackItem; audible: boolean }) {
  return (
    <div className={`layer-bar${audible ? '' : ' off'}`} aria-hidden="true">
      <div
        style={{
          left: `${(item.keyLo / 127) * 100}%`,
          width: `${(Math.max(1, item.keyHi - item.keyLo) / 127) * 100}%`,
          background: item.color,
        }}
      />
    </div>
  );
}

function RackSection({ track }: { track: Track }) {
  const store = useProjectStore;
  const items = useMemo(() => track.rack?.items ?? [], [track.rack]);
  // A layer is audible where the rack sends it anything at all: the middle of
  // its own range is the honest place to ask.
  const audible = useMemo(() => {
    const set = new Set<string>();
    for (const i of items) {
      const mid = Math.round((i.keyLo + i.keyHi) / 2);
      for (const l of rackLayersAt(items, mid)) set.add(l.id);
    }
    return set;
  }, [items]);

  return (
    <div className="smp-rack" data-testid="smp-rack">
      <div className="ps-title">
        Instrument rack{' '}
        <span className="hint">{items.length ? '(overrides the instrument above)' : ''}</span>
      </div>
      {items.map((it) => (
        <div key={it.id} className="zone-row layer-row" data-testid="rack-item">
          <span className="alh-dot" style={{ background: it.color }} />
          <input
            type="text"
            value={it.name}
            onChange={(e) =>
              store.getState().rackUpdateItem(track.id, it.id, { name: e.target.value })
            }
            aria-label="Layer name"
            style={{ width: 90 }}
          />
          <span className="hint">{it.kind}</span>
          <label>
            Key
            <input
              type="number"
              min={0}
              max={127}
              value={it.keyLo}
              aria-label="Layer key low"
              onChange={(e) =>
                store.getState().rackUpdateItem(track.id, it.id, { keyLo: num(e.target.value, 0) })
              }
            />
            –
            <input
              type="number"
              min={0}
              max={127}
              value={it.keyHi}
              aria-label="Layer key high"
              onChange={(e) =>
                store
                  .getState()
                  .rackUpdateItem(track.id, it.id, { keyHi: num(e.target.value, 127) })
              }
            />
          </label>
          <LayerBar item={it} audible={audible.has(it.id)} />
          <span className="hint t-num" title="Key range">
            {midiToName(it.keyLo)}–{midiToName(it.keyHi)}
          </span>
          <button
            className={`th-mini${it.muted ? ' m-on' : ''}`}
            aria-pressed={it.muted}
            aria-label={`Mute ${it.name}`}
            onClick={() => store.getState().rackUpdateItem(track.id, it.id, { muted: !it.muted })}
          >
            M
          </button>
          <button
            className={`th-mini${it.solo ? ' s-on' : ''}`}
            aria-pressed={it.solo}
            aria-label={`Solo ${it.name}`}
            onClick={() => store.getState().rackUpdateItem(track.id, it.id, { solo: !it.solo })}
          >
            S
          </button>
          <button
            className="th-mini"
            title="Move up"
            aria-label={`Move ${it.name} up`}
            onClick={() => store.getState().rackMoveItem(track.id, it.id, -1)}
          >
            ↑
          </button>
          <button
            className="th-mini"
            title="Remove layer"
            aria-label={`Remove ${it.name}`}
            onClick={() => store.getState().rackRemoveItem(track.id, it.id)}
          >
            ×
          </button>
        </div>
      ))}
      <div className="smp-row">
        <button
          className="btn"
          onClick={() => store.getState().rackAddItem(track.id, 'synth')}
          data-testid="rack-add-synth"
        >
          + Synth layer
        </button>
        <button className="btn" onClick={() => store.getState().rackAddItem(track.id, 'sampler')}>
          + Sampler layer
        </button>
      </div>
    </div>
  );
}

/**
 * Instrument-kind switch, shown in both the synth panel and the sampler panel
 * headers so a track can move between synth, sampler views and the rack.
 */
export function InstrumentKindSelect({ track }: { track: Track }) {
  const store = useProjectStore;
  const value = track.rack?.items.length ? 'rack' : track.sampler ? track.sampler.view : 'synth';
  return (
    <select
      value={value}
      aria-label="Instrument type"
      data-testid="instrument-kind"
      className="pw-preset"
      onChange={(e) => {
        const v = e.target.value;
        if (v === 'rack') {
          if (!track.rack?.items.length) store.getState().rackAddItem(track.id, 'synth');
        } else {
          store.getState().setInstrument(track.id, v as 'synth' | 'quick' | 'drum' | 'multi');
        }
      }}
    >
      <option value="synth">Synth</option>
      <option value="quick">Quick Sampler</option>
      <option value="drum">Drum Rack</option>
      <option value="multi">Multisample</option>
      <option value="rack">Instrument Rack</option>
    </select>
  );
}

/** The filter, envelope, modulator and output every sampler view shares. */
function VoiceSections({ track, params }: { track: Track; params: SamplerParams }) {
  const store = useProjectStore;
  const setP = (patch: Partial<SamplerParams>) =>
    store.getState().setSamplerParams(track.id, patch);
  const gesture = {
    onGestureStart: () => store.getState().beginGesture(),
    onGestureEnd: () => store.getState().endGesture(),
  };

  const filter = samplerVoiceFilter(params);
  const lfo = samplerLfoOf(params);
  const envelope = samplerAmpEnvelope(params);

  return (
    <>
      <InstrumentSection
        title="Filter"
        wide
        aside={filter ? `${formatHz(filter.freqHz)} · ${filter.qDb.toFixed(1)} dB` : 'Off'}
      >
        <div className="seg" role="group" aria-label="Filter type">
          {(['off', 'lowpass', 'highpass'] as const).map((t) => (
            <button
              key={t}
              className={params.filterType === t ? 'on' : ''}
              aria-pressed={params.filterType === t}
              onClick={() => setP({ filterType: t })}
            >
              {t === 'off' ? 'Off' : t === 'lowpass' ? 'Low-pass' : 'High-pass'}
            </button>
          ))}
        </div>
        {filter ? (
          <>
            <FilterCurve
              filter={filter}
              testId="smp-filter"
              label="Sampler filter response"
              sweep={lfo?.target === 'filter' ? lfoSweepHz(filter, lfo) : null}
              cutoff={{
                value: params.filterCutoff,
                min: 40,
                max: 18000,
                onChange: (hz) => setP({ filterCutoff: Math.round(hz) }),
              }}
              resonance={{
                value: params.filterRes,
                min: 0.1,
                max: 20,
                onChange: (db) => setP({ filterRes: Math.round(db * 100) / 100 }),
              }}
              {...gesture}
            />
            <div className="syn-knobs">
              <ParamKnob
                label="Cutoff"
                norm={clamp(Math.log(params.filterCutoff / 40) / Math.log(18000 / 40), 0, 1)}
                onNorm={(n) => setP({ filterCutoff: Math.round(40 * Math.pow(18000 / 40, n)) })}
                display={formatHz(params.filterCutoff)}
                onGestureStart={beginKnob}
                onGestureEnd={endKnob}
              />
              <ParamKnob
                label="Res"
                norm={clamp((params.filterRes - 0.1) / 19.9, 0, 1)}
                onNorm={(n) => setP({ filterRes: Math.round((0.1 + n * 19.9) * 10) / 10 })}
                // Q on a pass filter is decibels, so this is the lift at the
                // corner rather than an abstract quality factor.
                display={`${params.filterRes.toFixed(1)} dB`}
                onGestureStart={beginKnob}
                onGestureEnd={endKnob}
              />
            </div>
          </>
        ) : (
          <div className="hint">
            No filter node is built, so the voice passes the sample through.
          </div>
        )}
      </InstrumentSection>

      <InstrumentSection
        title="Amp envelope"
        wide
        aside={`${formatSeconds(params.attack)} · ${formatSeconds(params.decay)} · ${Math.round(
          params.sustain * 100,
        )}% · ${formatSeconds(params.release)}`}
      >
        <EnvelopeGraph env={envelope} label="Sampler amplitude envelope" testId="smp-env" />
        <div className="syn-knobs">
          <ParamKnob
            label="A"
            norm={Math.pow(params.attack / 2, 1 / 3)}
            onNorm={(n) => setP({ attack: Math.round(Math.pow(n, 3) * 2 * 1000) / 1000 })}
            display={formatSeconds(params.attack)}
            onGestureStart={beginKnob}
            onGestureEnd={endKnob}
          />
          <ParamKnob
            label="D"
            norm={Math.pow(params.decay / 2, 1 / 3)}
            onNorm={(n) =>
              setP({ decay: Math.max(0.001, Math.round(Math.pow(n, 3) * 2 * 1000) / 1000) })
            }
            display={formatSeconds(params.decay)}
            onGestureStart={beginKnob}
            onGestureEnd={endKnob}
          />
          <ParamKnob
            label="S"
            norm={params.sustain}
            onNorm={(n) => setP({ sustain: Math.round(n * 100) / 100 })}
            display={`${Math.round(params.sustain * 100)}%`}
            onGestureStart={beginKnob}
            onGestureEnd={endKnob}
          />
          <ParamKnob
            label="R"
            norm={Math.pow(params.release / 3, 1 / 3)}
            onNorm={(n) =>
              setP({ release: Math.max(0.005, Math.round(Math.pow(n, 3) * 3 * 1000) / 1000) })
            }
            display={formatSeconds(params.release)}
            onGestureStart={beginKnob}
            onGestureEnd={endKnob}
          />
          <ParamKnob
            label="Vel"
            norm={params.velToGain}
            onNorm={(n) => setP({ velToGain: Math.round(n * 100) / 100 })}
            display={`${Math.round(params.velToGain * 100)}%`}
            onGestureStart={beginKnob}
            onGestureEnd={endKnob}
          />
        </div>
      </InstrumentSection>

      <InstrumentSection
        title="LFO"
        aside={
          lfo
            ? `${lfo.rateHz.toFixed(2)} Hz · ${
                lfo.target === 'pitch'
                  ? `±${Math.round(lfo.depthCents ?? 0)} cents`
                  : `±${formatHz(lfo.depthHz ?? 0)}`
              }`
            : 'Off'
        }
      >
        <div className="seg" role="group" aria-label="LFO target">
          {(['off', 'pitch', 'filter'] as const).map((t) => (
            <button
              key={t}
              className={params.lfoTarget === t ? 'on' : ''}
              aria-pressed={params.lfoTarget === t}
              onClick={() => setP({ lfoTarget: t })}
            >
              {t === 'off' ? 'Off' : t === 'pitch' ? 'Pitch' : 'Filter'}
            </button>
          ))}
        </div>
        {lfo && <LfoScope lfo={lfo} label={`Modulator, ${lfo.rateHz.toFixed(2)} Hz`} />}
        {params.lfoTarget !== 'off' && !lfo && (
          <div className="hint" data-testid="lfo-inert">
            {params.lfoDepth <= 0
              ? 'Depth is zero, so no modulator is built.'
              : 'The filter is off, so this modulator reaches nothing.'}
          </div>
        )}
        {params.lfoTarget !== 'off' && (
          <div className="syn-knobs">
            <ParamKnob
              label="Rate"
              norm={clamp(Math.log(params.lfoRate / 0.05) / Math.log(20 / 0.05), 0, 1)}
              onNorm={(n) =>
                setP({ lfoRate: Math.round(0.05 * Math.pow(20 / 0.05, n) * 100) / 100 })
              }
              display={`${params.lfoRate.toFixed(2)} Hz`}
              onGestureStart={beginKnob}
              onGestureEnd={endKnob}
            />
            <ParamKnob
              label="Depth"
              norm={params.lfoDepth}
              onNorm={(n) => setP({ lfoDepth: Math.round(n * 100) / 100 })}
              display={`${Math.round(params.lfoDepth * 100)}%`}
              onGestureStart={beginKnob}
              onGestureEnd={endKnob}
            />
          </div>
        )}
      </InstrumentSection>

      <InstrumentSection title="Output">
        <div className="syn-knobs">
          <ParamKnob
            label="Volume"
            norm={clamp(params.volume / 1.5, 0, 1)}
            onNorm={(n) => setP({ volume: Math.round(n * 1.5 * 100) / 100 })}
            display={`${Math.round(params.volume * 100)}%`}
            onGestureStart={beginKnob}
            onGestureEnd={endKnob}
          />
          <ParamKnob
            label="Pan"
            norm={(track.pan + 1) / 2}
            onNorm={(n) =>
              store.getState().setTrack(track.id, { pan: Math.round((n * 2 - 1) * 100) / 100 })
            }
            display={
              track.pan === 0
                ? 'C'
                : `${Math.abs(Math.round(track.pan * 100))}${track.pan < 0 ? 'L' : 'R'}`
            }
            onGestureStart={beginKnob}
            onGestureEnd={endKnob}
          />
        </div>
      </InstrumentSection>
    </>
  );
}

const VIEW_NAME: Record<SamplerParams['view'], string> = {
  quick: 'Quick Sampler',
  drum: 'Drum Rack',
  multi: 'Multisample',
};

/** One line for the frame's footer: what this instrument is, right now. */
function describeSampler(
  params: SamplerParams | undefined,
  hasRack: boolean,
  track: Track,
): string {
  if (hasRack) {
    const items = track.rack?.items ?? [];
    return `${items.length} layer${items.length === 1 ? '' : 's'} · ${items
      .map((i) => `${midiToName(i.keyLo)}–${midiToName(i.keyHi)}`)
      .join(', ')}`;
  }
  if (!params) return 'No sampler loaded';
  const filter = samplerVoiceFilter(params);
  const lfo = samplerLfoOf(params);
  return [
    `${params.zones.length} zone${params.zones.length === 1 ? '' : 's'}`,
    filter ? `${filter.type === 'lowpass' ? 'LP' : 'HP'} ${formatHz(filter.freqHz)}` : 'no filter',
    `A ${formatSeconds(params.attack)} · R ${formatSeconds(params.release)}`,
    lfo ? `LFO ${lfo.rateHz.toFixed(2)} Hz → ${lfo.target}` : 'no LFO',
  ].join(' · ');
}

export function SamplerPanel({ track, performMode }: { track: Track; performMode?: boolean }) {
  const store = useProjectStore;
  const params = track.sampler;
  const hasRack = !!track.rack?.items.length;
  const name = hasRack ? 'Instrument Rack' : params ? VIEW_NAME[params.view] : 'TX Sampler';

  return (
    <InstrumentFrame<SamplerParams>
      name={name}
      track={track}
      testId="sampler-panel"
      className={`smp${performMode ? ' perform-page' : ''}`}
      summary={describeSampler(params, hasRack, track)}
      controls={<InstrumentKindSelect track={track} />}
      compare={
        params && !hasRack
          ? {
              take: () => ({ ...params, zones: params.zones.map((z) => ({ ...z })) }),
              put: (v) => store.getState().applySamplerPreset(track.id, v),
            }
          : undefined
      }
      performance={hasRack || params?.view !== 'drum' ? <Keyboard track={track} /> : undefined}
    >
      {/* A rack has no instrument of its own: its layers each carry theirs, so
          the voice sections would be four displays of nothing. */}
      {!hasRack && params && (
        <div className="ins-sections">
          {params.view === 'quick' && <QuickView track={track} params={params} />}
          {params.view === 'drum' && (
            <InstrumentSection title="Pads" wide aside={`${params.zones.length} assigned`}>
              <DrumView track={track} params={params} />
            </InstrumentSection>
          )}
          {params.view === 'multi' && <MultiView track={track} params={params} />}
          <VoiceSections track={track} params={params} />
        </div>
      )}
      <RackSection track={track} />
    </InstrumentFrame>
  );
}

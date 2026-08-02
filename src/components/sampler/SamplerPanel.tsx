/**
 * Sampler workstation panel: Quick, Drum Rack and Multisample are three views
 * over one zone model, plus the instrument-rack section. Mounted wherever the
 * synth panel mounts; the synth panel delegates here when the track has a
 * sampler or a rack.
 */
import { memo, useMemo, useState } from 'react';
import { engine } from '../../audio/engine';
import { getBufferSync } from '../../audio/mediaLibrary';
import { midiToName } from '../../model/music';
import {
  buildDrumKit,
  detectTransients,
  makeZone,
  snapToZeroCrossing,
  DRUM_PAD_BASE,
  MAX_DRUM_PADS,
  type SamplerParams,
  type SampleZone,
} from '../../model/sampler';
import { PROCEDURAL_MEDIA_IDS } from '../../model/media';
import type { Track } from '../../model/types';
import { TRACK_COLORS } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { Waveform } from '../arrangement/Waveform';
import { Keyboard } from '../synth/Keyboard';

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

/** Drag handler for one trim edge of the wave editor. */
function useDragEdge(track: Track, zone: SampleZone, dur: number, which: 'start' | 'end') {
  const store = useProjectStore;
  const buf = getBufferSync(zone.mediaId);
  const endSec = zone.endSec ?? dur;
  return usePointerDrag<{ v0: number; w: number }>({
    onStart: (e) => {
      store.getState().beginGesture();
      const host = (e.currentTarget as HTMLElement).parentElement!;
      return { v0: which === 'start' ? zone.startSec : endSec, w: host.clientWidth };
    },
    onMove: (dx, _dy, e2, d) => {
      let sec = d.v0 + (dx / d.w) * dur;
      // Zero-crossing assist unless Alt is held.
      if (buf && !e2.altKey) {
        sec = snapToZeroCrossing(buf.getChannelData(0), buf.sampleRate, sec, 0.008);
      }
      store
        .getState()
        .updateSamplerZones(track.id, [zone.id], () =>
          which === 'start'
            ? { startSec: Math.max(0, Math.min(sec, endSec - 0.01)) }
            : { endSec: Math.max(zone.startSec + 0.01, Math.min(sec, dur)) },
        );
    },
    onEnd: () => store.getState().endGesture(),
  });
}

function ZoneWaveEditor({ track, zone }: { track: Track; zone: SampleZone }) {
  const buf = getBufferSync(zone.mediaId);
  const dur = buf?.duration ?? 4;
  const endSec = zone.endSec ?? dur;
  const dragStart = useDragEdge(track, zone, dur, 'start');
  const dragEnd = useDragEdge(track, zone, dur, 'end');

  return (
    <div className="smp-wave" data-testid="smp-wave">
      <Waveform
        mediaId={zone.mediaId}
        offsetSec={0}
        durationSec={dur}
        color="#37b89a"
        gain={zone.gain}
        fadeIn={0}
        fadeOut={0}
        widthPx={640}
        heightPx={90}
      />
      {/* dimmed outside the playback window */}
      <div className="smp-dim" style={{ left: 0, width: `${(zone.startSec / dur) * 100}%` }} />
      <div className="smp-dim" style={{ left: `${(endSec / dur) * 100}%`, right: 0 }} />
      {zone.loop && (
        <div
          className="smp-loop"
          style={{
            left: `${((zone.loopStartSec ?? zone.startSec) / dur) * 100}%`,
            width: `${(((zone.loopEndSec ?? endSec) - (zone.loopStartSec ?? zone.startSec)) / dur) * 100}%`,
          }}
        />
      )}
      {(zone.slices ?? []).map((s, i) => (
        <div
          key={i}
          className="smp-slice"
          style={{ left: `${(s / dur) * 100}%` }}
          title={`Slice ${i + 1}`}
        />
      ))}
      <div
        className="smp-handle l"
        style={{ left: `calc(${(zone.startSec / dur) * 100}% - 5px)` }}
        title="Trim start (Alt bypasses zero-crossing snap)"
        onPointerDown={dragStart}
        data-testid="smp-trim-start"
      />
      <div
        className="smp-handle r"
        style={{ left: `calc(${(endSec / dur) * 100}% - 5px)` }}
        title="Trim end (Alt bypasses zero-crossing snap)"
        onPointerDown={dragEnd}
        data-testid="smp-trim-end"
      />
    </div>
  );
}

function num(v: string, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function QuickView({ track, params }: { track: Track; params: SamplerParams }) {
  const store = useProjectStore;
  const ui = useUiStore;
  const zone = params.zones[0];
  if (!zone) {
    return (
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
    );
  }
  const upd = (patch: Partial<SampleZone>) =>
    store.getState().updateSamplerZones(track.id, [zone.id], () => patch);
  const buf = getBufferSync(zone.mediaId);

  return (
    <div className="smp-quick" data-testid="smp-quick">
      <ZoneWaveEditor track={track} zone={zone} />
      <div className="smp-row">
        <button
          className="btn"
          onClick={() => preview(track.id, zone.rootNote)}
          data-testid="smp-preview"
        >
          ▶ Preview
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
          className={`th-mini${zone.loop ? ' s-on' : ''}`}
          aria-pressed={zone.loop}
          onClick={() => upd({ loop: !zone.loop })}
          title="Loop the playback window"
        >
          LOOP
        </button>
        <button
          className={`th-mini${zone.reverse ? ' s-on' : ''}`}
          aria-pressed={zone.reverse}
          onClick={() => upd({ reverse: !zone.reverse })}
          title="Reverse playback"
          data-testid="smp-reverse"
        >
          REV
        </button>
        <button
          className={`th-mini${zone.oneShot ? ' s-on' : ''}`}
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
            const from = Math.floor(zone.startSec * buf.sampleRate);
            const to = Math.min(
              data.length,
              Math.floor((zone.endSec ?? buf.duration) * buf.sampleRate),
            );
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
            const markers = detectTransients(buf.getChannelData(0), buf.sampleRate).filter(
              (s) => s >= zone.startSec && s <= (zone.endSec ?? buf.duration),
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
    </div>
  );
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

  return (
    <div className="smp-drum" data-testid="smp-drum">
      <div className="pad-grid" data-testid="pad-grid">
        {Array.from({ length: count }, (_, i) => {
          const z = byIndex.get(i);
          return (
            <div
              key={i}
              className={`pad${z ? '' : ' empty'}${z && z.id === selected ? ' selected' : ''}${z?.muted ? ' muted' : ''}`}
              style={
                z?.color
                  ? ({ ['--pad-color' as string]: z.color } as React.CSSProperties)
                  : undefined
              }
              data-testid={`pad-${i}`}
              onClick={() => {
                if (z) {
                  setSelected(z.id);
                  preview(track.id, DRUM_PAD_BASE + i);
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
                z ? `${z.name} — click to preview, drop a sample to replace` : 'Drop a sample here'
              }
            >
              <span className="pad-name">{z?.name ?? '—'}</span>
              <span className="pad-key mono">{midiToName(DRUM_PAD_BASE + i)}</span>
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
            onClick={() =>
              store.getState().updateSamplerZones(track.id, [sel.id], (z) => ({ muted: !z.muted }))
            }
          >
            M
          </button>
          <button
            className={`th-mini${sel.solo ? ' s-on' : ''}`}
            aria-pressed={!!sel.solo}
            onClick={() =>
              store.getState().updateSamplerZones(track.id, [sel.id], (z) => ({ solo: !z.solo }))
            }
          >
            S
          </button>
          <label>
            Gain
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={sel.gain}
              onChange={(e) =>
                store
                  .getState()
                  .updateSamplerZones(track.id, [sel.id], () => ({ gain: num(e.target.value, 1) }))
              }
              aria-label="Pad gain"
            />
          </label>
          <label>
            Pan
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={sel.pan}
              onChange={(e) =>
                store
                  .getState()
                  .updateSamplerZones(track.id, [sel.id], () => ({ pan: num(e.target.value, 0) }))
              }
              aria-label="Pad pan"
            />
          </label>
          <label>
            Pitch
            <input
              type="number"
              min={-24}
              max={24}
              value={sel.tuneCoarse}
              onChange={(e) =>
                store
                  .getState()
                  .updateSamplerZones(track.id, [sel.id], () => ({
                    tuneCoarse: num(e.target.value, 0),
                  }))
              }
              aria-label="Pad pitch (semitones)"
            />
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
                store
                  .getState()
                  .updateSamplerZones(track.id, [sel.id], () => ({
                    chokeGroup: g > 0 ? g : undefined,
                  }));
              }}
              aria-label="Choke group (0 = none)"
            />
          </label>
          <button
            className="th-mini"
            title="Remove pad"
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

const ZoneRow = memo(function ZoneRow({ trackId, z }: { trackId: string; z: SampleZone }) {
  const store = useProjectStore;
  const upd = (patch: Partial<SampleZone>) =>
    store.getState().updateSamplerZones(trackId, [z.id], () => patch);
  return (
    <div className="zone-row" data-testid="zone-row">
      <button className="th-mini" title="Preview at root" onClick={() => preview(trackId, z.rootNote)}>
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
        onClick={() => store.getState().removeSamplerZones(trackId, [z.id])}
      >
        ×
      </button>
    </div>
  );
},
(prev, next) => prev.trackId === next.trackId && zoneRowEq(prev.z, next.z));

function MultiView({ track, params }: { track: Track; params: SamplerParams }) {
  const store = useProjectStore;
  return (
    <div className="smp-multi" data-testid="smp-multi">
      <div className="zone-list">
        {params.zones.map((z) => (
          <ZoneRow key={z.id} trackId={track.id} z={z} />
        ))}
      </div>
      <div className="smp-row">
        <button
          className="btn"
          data-testid="add-zone"
          onClick={() =>
            store
              .getState()
              .addSamplerZones(track.id, [
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
    </div>
  );
}

function RackSection({ track }: { track: Track }) {
  const store = useProjectStore;
  const items = track.rack?.items ?? [];
  return (
    <div className="smp-rack" data-testid="smp-rack">
      <div className="ps-title">
        Instrument rack{' '}
        <span className="hint">{items.length ? '(overrides the instrument above)' : ''}</span>
      </div>
      {items.map((it) => (
        <div key={it.id} className="zone-row" data-testid="rack-item">
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
          <button
            className={`th-mini${it.muted ? ' m-on' : ''}`}
            aria-pressed={it.muted}
            onClick={() => store.getState().rackUpdateItem(track.id, it.id, { muted: !it.muted })}
          >
            M
          </button>
          <button
            className={`th-mini${it.solo ? ' s-on' : ''}`}
            aria-pressed={it.solo}
            onClick={() => store.getState().rackUpdateItem(track.id, it.id, { solo: !it.solo })}
          >
            S
          </button>
          <button
            className="th-mini"
            title="Move up"
            onClick={() => store.getState().rackMoveItem(track.id, it.id, -1)}
          >
            ↑
          </button>
          <button
            className="th-mini"
            title="Remove layer"
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

export function SamplerPanel({ track, performMode }: { track: Track; performMode?: boolean }) {
  const store = useProjectStore;
  const params = track.sampler;
  const hasRack = !!track.rack?.items.length;
  const setP = (patch: Partial<SamplerParams>) =>
    store.getState().setSamplerParams(track.id, patch);

  return (
    <div className={`syn smp${performMode ? ' perform-page' : ''}`} data-testid="sampler-panel">
      <div className="syn-scroll">
        <div className="smp-row smp-head">
          <span className="syn-title" title={track.name}>
            <span className="swatch" style={{ background: track.color }} />
            <span className="syn-title-text">
              {hasRack ? 'Instrument Rack' : params?.view === 'drum' ? 'Drum Rack' : 'TX Sampler'} —{' '}
              {track.name}
            </span>
          </span>
          <InstrumentKindSelect track={track} />
          {params && !hasRack && (
            <>
              <label>
                A
                <input
                  type="range"
                  min={0.001}
                  max={2}
                  step={0.001}
                  value={params.attack}
                  onChange={(e) => setP({ attack: num(e.target.value, 0.002) })}
                  aria-label="Attack"
                />
              </label>
              <label>
                D
                <input
                  type="range"
                  min={0.001}
                  max={2}
                  step={0.001}
                  value={params.decay}
                  onChange={(e) => setP({ decay: num(e.target.value, 0.08) })}
                  aria-label="Decay"
                />
              </label>
              <label>
                S
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={params.sustain}
                  onChange={(e) => setP({ sustain: num(e.target.value, 1) })}
                  aria-label="Sustain"
                />
              </label>
              <label>
                R
                <input
                  type="range"
                  min={0.005}
                  max={3}
                  step={0.005}
                  value={params.release}
                  onChange={(e) => setP({ release: num(e.target.value, 0.12) })}
                  aria-label="Release"
                />
              </label>
              <label>
                Vol
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.01}
                  value={params.volume}
                  onChange={(e) => setP({ volume: num(e.target.value, 0.9) })}
                  aria-label="Sampler volume"
                />
              </label>
              <select
                value={params.filterType}
                aria-label="Filter type"
                onChange={(e) =>
                  setP({ filterType: e.target.value as SamplerParams['filterType'] })
                }
              >
                <option value="off">No filter</option>
                <option value="lowpass">Low-pass</option>
                <option value="highpass">High-pass</option>
              </select>
              {params.filterType !== 'off' && (
                <label>
                  Cutoff
                  <input
                    type="range"
                    min={40}
                    max={18000}
                    step={10}
                    value={params.filterCutoff}
                    onChange={(e) => setP({ filterCutoff: num(e.target.value, 12000) })}
                    aria-label="Filter cutoff"
                  />
                </label>
              )}
              <select
                value={params.lfoTarget}
                aria-label="LFO target"
                onChange={(e) => setP({ lfoTarget: e.target.value as SamplerParams['lfoTarget'] })}
              >
                <option value="off">LFO off</option>
                <option value="pitch">LFO → pitch</option>
                <option value="filter">LFO → filter</option>
              </select>
              {params.lfoTarget !== 'off' && (
                <>
                  <label>
                    Rate
                    <input
                      type="range"
                      min={0.05}
                      max={20}
                      step={0.05}
                      value={params.lfoRate}
                      onChange={(e) => setP({ lfoRate: num(e.target.value, 4) })}
                      aria-label="LFO rate"
                    />
                  </label>
                  <label>
                    Depth
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={params.lfoDepth}
                      onChange={(e) => setP({ lfoDepth: num(e.target.value, 0) })}
                      aria-label="LFO depth"
                    />
                  </label>
                </>
              )}
            </>
          )}
        </div>
        {!hasRack && params?.view === 'quick' && <QuickView track={track} params={params} />}
        {!hasRack && params?.view === 'drum' && <DrumView track={track} params={params} />}
        {!hasRack && params?.view === 'multi' && <MultiView track={track} params={params} />}
        <RackSection track={track} />
      </div>
      {(hasRack || params?.view !== 'drum') && <Keyboard track={track} />}
    </div>
  );
}

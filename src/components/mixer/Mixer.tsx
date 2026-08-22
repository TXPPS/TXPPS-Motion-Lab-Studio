import { useEffect, useRef } from 'react';
import { engine } from '../../audio/engine';
import { formatDb } from '../../model/music';
import type { Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Fader, Meter, PanKnob, PeakReadout, panText } from '../common/widgets';
import { captureParamChange, captureParamRelease } from '../../app/automationActions';

/**
 * One channel strip. Geometry is fully bounded by CSS grid rows — the only
 * flexible row is the fader/meter row, and the strip clips its own overflow, so
 * no control can escape into a neighbour regardless of panel height.
 */
function ChannelStrip({
  track,
  outputName,
  buses,
  feeds,
}: {
  track: Track;
  outputName: string;
  buses: Track[];
  /** For a bus strip: names of the tracks routed or sending into it. */
  feeds?: string[];
}) {
  const selected = useUiStore((s) => s.selectedTrackId === track.id);
  const store = useProjectStore;
  const isBus = track.type === 'bus';
  const effects = track.effects ?? [];
  const fxCount = effects.length;
  const allBypassed = fxCount > 0 && effects.every((e) => e.bypass);
  const sendCount = (track.sends ?? []).filter((s) => s.enabled && s.amount > 0).length;
  const autoLanes = (track.automation ?? []).filter((l) => l.enabled && l.points.length > 0);
  const autoMode = track.automationMode ?? 'read';

  return (
    <div
      className={`strip${selected ? ' selected' : ''}${isBus ? ' bus' : ''}`}
      style={{ ['--strip-color' as string]: track.color }}
      onPointerDown={() => useUiStore.getState().selectTrack(track.id)}
      data-testid={`strip-${track.name}`}
      data-strip="channel"
    >
      <div className="strip-name" title={track.name}>
        {isBus && (
          <span
            className="strip-bus-tag"
            title={`Bus · fed by ${feeds?.length ?? 0} source${(feeds?.length ?? 0) === 1 ? '' : 's'}${feeds?.length ? `: ${feeds.join(', ')}` : ''}`}
          >
            BUS{feeds?.length ? ` ${feeds.length}` : ''}
          </span>
        )}
        {track.name}
        {autoLanes.length > 0 && autoMode !== 'off' && (
          <span
            className="strip-auto-dot"
            title={`${autoLanes.length} automation lane${autoLanes.length === 1 ? '' : 's'} (${autoMode})`}
            data-testid={`strip-auto-${track.name}`}
          >
            A
          </span>
        )}
      </div>

      {/* Compact insert/send status. Editing happens in the inspector, which has
          the room for it; the strip keeps its bounded six-row geometry. */}
      <div className="strip-fx">
        <button
          className={`fx-chip${fxCount ? ' on' : ''}${allBypassed ? ' bypassed' : ''}`}
          title={
            fxCount
              ? `${fxCount} insert${fxCount === 1 ? '' : 's'}${allBypassed ? ' (all bypassed)' : ''}`
              : 'No inserts'
          }
          aria-label={`${track.name} inserts: ${fxCount}`}
          data-testid={`strip-fx-${track.name}`}
          onClick={() => {
            useUiStore.getState().selectTrack(track.id);
            useUiStore.getState().set({ panelInspector: true, phoneMode: 'browse' });
          }}
        >
          FX {fxCount || '–'}
        </button>
        <button
          className={`fx-chip${sendCount ? ' on' : ''}`}
          title={sendCount ? `${sendCount} active send${sendCount === 1 ? '' : 's'}` : 'No sends'}
          aria-label={`${track.name} sends: ${sendCount}`}
          onClick={() => {
            useUiStore.getState().selectTrack(track.id);
            useUiStore.getState().set({ panelInspector: true, phoneMode: 'browse' });
          }}
        >
          SND {sendCount || '–'}
        </button>
      </div>

      <div className="strip-pan">
        <PanKnob
          size={26}
          value={track.pan}
          onChange={(v) => {
            store.getState().setTrack(track.id, { pan: v });
            captureParamChange(track.id, 'pan', v);
          }}
          onGestureStart={() => store.getState().beginGesture()}
          onGestureEnd={() => {
            store.getState().endGesture();
            captureParamRelease(track.id, 'pan');
          }}
          label={`${track.name} pan`}
        />
        <span className="pan-val">{panText(track.pan)}</span>
      </div>

      <div className="strip-mid">
        <Fader
          value={track.volume}
          label={`${track.name} volume`}
          onGestureStart={() => store.getState().beginGesture()}
          onGestureEnd={() => {
            store.getState().endGesture();
            captureParamRelease(track.id, 'volume');
          }}
          onChange={(v) => {
            store.getState().setTrack(track.id, { volume: v });
            captureParamChange(track.id, 'volume', v);
          }}
        />
        <Meter meterId={track.id} />
      </div>

      <div className="strip-btns">
        <button
          className={`th-mini${track.mute ? ' m-on' : ''}`}
          aria-pressed={track.mute}
          aria-label={`Mute ${track.name}`}
          title="Mute"
          data-testid={`mix-mute-${track.name}`}
          onClick={() => store.getState().setTrack(track.id, { mute: !track.mute })}
        >
          M
        </button>
        <button
          className={`th-mini${track.solo ? ' s-on' : ''}`}
          aria-pressed={track.solo}
          aria-label={`Solo ${track.name}`}
          title="Solo"
          data-testid={`mix-solo-${track.name}`}
          onClick={() => store.getState().setTrack(track.id, { solo: !track.solo })}
        >
          S
        </button>
        {!isBus && (
          <button
            className={`th-mini${track.armed ? ' r-on' : ''}`}
            aria-pressed={track.armed}
            aria-label={`Record arm ${track.name}`}
            title="Record arm"
            onClick={() => store.getState().setTrack(track.id, { armed: !track.armed })}
          >
            ●
          </button>
        )}
      </div>

      <div className="strip-readout">
        <span className="rd-db" data-testid={`db-${track.name}`}>
          {formatDb(track.volume)}
        </span>
        <span className="rd-pk">
          <PeakReadout meterId={track.id} />
        </span>
      </div>

      {isBus ? (
        <div className="strip-route static">&rarr; MASTER</div>
      ) : buses.length > 0 ? (
        <select
          className="strip-route"
          value={track.output}
          aria-label={`${track.name} output`}
          onChange={(e) => store.getState().setTrack(track.id, { output: e.target.value })}
        >
          <option value="master">Master</option>
          {buses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      ) : (
        <div className="strip-route static" title={outputName}>
          &rarr; {outputName}
        </div>
      )}
    </div>
  );
}

function MasterStrip() {
  const masterVolume = useProjectStore((s) => s.project.masterVolume);
  const store = useProjectStore;
  return (
    <div
      className="strip master"
      data-testid="strip-master"
      data-strip="master"
      style={{ ['--strip-color' as string]: 'var(--warm)' }}
    >
      <div className="strip-name">Master</div>
      {/* Placeholder keeps the master strip's rows aligned with the channels. */}
      <div className="strip-fx" aria-hidden="true" />
      <div className="strip-pan">
        <span className="knob-label">STEREO OUT</span>
      </div>
      <div className="strip-mid">
        <Fader
          value={masterVolume}
          label="Master volume"
          onGestureStart={() => store.getState().beginGesture()}
          onGestureEnd={() => store.getState().endGesture()}
          onChange={(v) => store.getState().setMasterVolume(v)}
        />
        <Meter meterId="master" wide />
      </div>
      <div className="strip-btns">
        <button
          className="th-mini"
          title="Reset peak and clip indicators"
          aria-label="Reset peak indicators"
          onClick={() => engine.resetClipIndicators()}
        >
          PK
        </button>
      </div>
      <div className="strip-readout">
        <span className="rd-db">{formatDb(masterVolume)}</span>
        <span className="rd-pk">
          <PeakReadout meterId="master" />
        </span>
      </div>
      <div className="strip-route static">OUTPUT</div>
    </div>
  );
}

/**
 * The mixer is one horizontal scroller containing a single row of fixed-width
 * strips. A vertical wheel over the mixer is translated to horizontal scroll so
 * mouse users can pan the row; trackpads keep their native two-axis deltas.
 */
export function Mixer({ touch }: { touch?: boolean }) {
  const tracks = useProjectStore((s) => s.project.tracks);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const buses = tracks.filter((t) => t.type === 'bus');
  const channels = tracks.filter((t) => t.type !== 'bus');
  const nameOf = (id: string) =>
    id === 'master' ? 'Master' : (tracks.find((t) => t.id === id)?.name ?? 'Master');
  /** Which tracks feed each bus (output routing or an enabled send). */
  const feedsOf = (busId: string) =>
    channels
      .filter(
        (t) =>
          t.output === busId ||
          (t.sends ?? []).some((s) => s.busId === busId && s.enabled && s.amount > 0),
      )
      .map((t) => t.name);

  return (
    <div
      ref={ref}
      className={`mixer${touch ? ' touch' : ''}`}
      data-testid="mixer"
      role="group"
      aria-label="Mixer"
    >
      {channels.map((t) => (
        <ChannelStrip key={t.id} track={t} outputName={nameOf(t.output)} buses={buses} />
      ))}
      {buses.map((t) => (
        <ChannelStrip key={t.id} track={t} outputName="Master" buses={[]} feeds={feedsOf(t.id)} />
      ))}
      <MasterStrip />
    </div>
  );
}

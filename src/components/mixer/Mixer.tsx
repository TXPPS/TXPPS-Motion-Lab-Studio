import { useEffect, useRef } from 'react';
import { engine } from '../../audio/engine';
import { formatDb } from '../../model/music';
import type { Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Fader, Meter, PanKnob, PeakReadout, panText } from '../common/widgets';

/**
 * One channel strip. Geometry is fully bounded by CSS grid rows — the only
 * flexible row is the fader/meter row, and the strip clips its own overflow, so
 * no control can escape into a neighbour regardless of panel height.
 */
function ChannelStrip({
  track,
  outputName,
  buses,
}: {
  track: Track;
  outputName: string;
  buses: Track[];
}) {
  const selected = useUiStore((s) => s.selectedTrackId === track.id);
  const store = useProjectStore;
  const isBus = track.type === 'bus';

  return (
    <div
      className={`strip${selected ? ' selected' : ''}${isBus ? ' bus' : ''}`}
      style={{ ['--strip-color' as string]: track.color }}
      onPointerDown={() => useUiStore.getState().selectTrack(track.id)}
      data-testid={`strip-${track.name}`}
      data-strip="channel"
    >
      <div className="strip-name" title={track.name}>
        {track.name}
      </div>

      <div className="strip-pan">
        <PanKnob
          size={26}
          value={track.pan}
          onChange={(v) => store.getState().setTrack(track.id, { pan: v })}
          onGestureStart={() => store.getState().beginGesture()}
          onGestureEnd={() => store.getState().endGesture()}
          label={`${track.name} pan`}
        />
        <span className="pan-val">{panText(track.pan)}</span>
      </div>

      <div className="strip-mid">
        <Fader
          value={track.volume}
          label={`${track.name} volume`}
          onGestureStart={() => store.getState().beginGesture()}
          onGestureEnd={() => store.getState().endGesture()}
          onChange={(v) => store.getState().setTrack(track.id, { volume: v })}
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
        <ChannelStrip key={t.id} track={t} outputName="Master" buses={[]} />
      ))}
      <MasterStrip />
    </div>
  );
}

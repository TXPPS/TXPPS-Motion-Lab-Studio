import { engine } from '../../audio/engine';
import { formatDb } from '../../model/music';
import type { Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Fader, Meter, PanKnob, PeakReadout } from '../common/widgets';

function ChannelStrip({ track, faderHeight }: { track: Track; faderHeight: number }) {
  const selected = useUiStore((s) => s.selectedTrackId === track.id);
  const store = useProjectStore;
  // Select the stable tracks array, then derive buses in render (a selector that
  // returns a fresh .filter() array re-fires forever under zustand v5).
  const allTracks = useProjectStore((s) => s.project.tracks);
  const buses = allTracks.filter((t) => t.type === 'bus');
  const isBus = track.type === 'bus';

  return (
    <div
      className={`strip${selected ? ' selected' : ''}${isBus ? ' bus' : ''}`}
      style={{ ['--strip-color' as string]: track.color }}
      onPointerDown={() => useUiStore.getState().selectTrack(track.id)}
      data-testid={`strip-${track.name}`}
    >
      <div className="strip-name" title={track.name}>
        {track.name}
      </div>
      <div className="strip-pan">
        <PanKnob
          value={track.pan}
          onChange={(v) => store.getState().setTrack(track.id, { pan: v })}
          label={`${track.name} pan`}
        />
        <div className="knob-label">
          {track.pan === 0
            ? 'C'
            : `${Math.abs(Math.round(track.pan * 100))}${track.pan < 0 ? 'L' : 'R'}`}
        </div>
      </div>
      <div className="strip-mid">
        <Fader
          value={track.volume}
          height={faderHeight}
          label={`${track.name} volume`}
          onGestureStart={() => store.getState().beginGesture()}
          onGestureEnd={() => store.getState().endGesture()}
          onChange={(v) => store.getState().setTrack(track.id, { volume: v })}
        />
        <Meter meterId={track.id} height={faderHeight} />
      </div>
      <div className="strip-btns">
        <button
          className={`th-mini${track.mute ? ' m-on' : ''}`}
          aria-pressed={track.mute}
          title="Mute"
          data-testid={`mix-mute-${track.name}`}
          onClick={() => store.getState().setTrack(track.id, { mute: !track.mute })}
        >
          M
        </button>
        <button
          className={`th-mini${track.solo ? ' s-on' : ''}`}
          aria-pressed={track.solo}
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
            title="Record arm"
            onClick={() => store.getState().setTrack(track.id, { armed: !track.armed })}
          >
            ●
          </button>
        )}
      </div>
      <div className="strip-db" data-testid={`db-${track.name}`}>
        {formatDb(track.volume)} dB
      </div>
      <div className="strip-db">
        pk <PeakReadout meterId={track.id} />
      </div>
      {!isBus && buses.length > 0 && (
        <select
          value={track.output}
          aria-label={`${track.name} output`}
          style={{ fontSize: 10, height: 22, padding: '0 3px' }}
          onChange={(e) => store.getState().setTrack(track.id, { output: e.target.value })}
        >
          <option value="master">Master</option>
          {buses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function MasterStrip({ faderHeight }: { faderHeight: number }) {
  const masterVolume = useProjectStore((s) => s.project.masterVolume);
  const store = useProjectStore;
  return (
    <div className="strip master" data-testid="strip-master">
      <div className="strip-name" style={{ ['--strip-color' as string]: 'var(--warm)' }}>
        Master
      </div>
      <div className="strip-pan">
        <div className="knob-label" style={{ paddingTop: 8 }}>
          OUT
        </div>
      </div>
      <div className="strip-mid">
        <Fader
          value={masterVolume}
          height={faderHeight}
          label="Master volume"
          onGestureStart={() => store.getState().beginGesture()}
          onGestureEnd={() => store.getState().endGesture()}
          onChange={(v) => store.getState().setMasterVolume(v)}
        />
        <Meter meterId="master" height={faderHeight} wide />
      </div>
      <div className="strip-btns">
        <button
          className="th-mini"
          title="Reset peak / clip indicators"
          onClick={() => engine.resetClipIndicators()}
        >
          PK
        </button>
      </div>
      <div className="strip-db">{formatDb(masterVolume)} dB</div>
      <div className="strip-db">
        pk <PeakReadout meterId="master" />
      </div>
    </div>
  );
}

export function Mixer({ faderHeight = 118 }: { faderHeight?: number }) {
  const tracks = useProjectStore((s) => s.project.tracks);
  const normal = tracks.filter((t) => t.type !== 'bus');
  const buses = tracks.filter((t) => t.type === 'bus');
  return (
    <div className="mixer" data-testid="mixer">
      {normal.map((t) => (
        <ChannelStrip key={t.id} track={t} faderHeight={faderHeight} />
      ))}
      {buses.map((t) => (
        <ChannelStrip key={t.id} track={t} faderHeight={faderHeight} />
      ))}
      <MasterStrip faderHeight={faderHeight} />
    </div>
  );
}

/**
 * VCA strip.
 *
 * A VCA carries no audio: its fader scales the gain of every member without
 * changing their routing, so members keep their own fader positions and their
 * own automation. That is the whole point — riding a chorus does not destroy
 * the balance you spent an hour setting.
 */
import { memo } from 'react';
import { formatDb } from '../../model/music';
import type { Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Fader } from '../common/widgets';
import { Icon } from '../common/Icon';

export const VcaStrip = memo(function VcaStrip({
  track,
  members,
}: {
  track: Track;
  members: Track[];
}) {
  const selected = useUiStore((s) => s.selectedTrackId === track.id);
  const store = useProjectStore;
  return (
    <div
      className={`strip vca${selected ? ' selected' : ''}`}
      style={{ ['--strip-color' as string]: track.color }}
      onPointerDown={() => useUiStore.getState().selectTrack(track.id)}
      data-testid={`strip-${track.name}`}
      data-strip="vca"
    >
      <div className="strip-name" title={`${track.name} — ${members.length} member(s)`}>
        <Icon name="vca" size={11} />
        <span className="strip-bus-tag">VCA {members.length || ''}</span>
        <span className="strip-label" title={track.name}>
          {track.name}
        </span>
      </div>

      <div className="strip-input">
        <span className="vca-members" title={members.map((m) => m.name).join(', ') || 'No members'}>
          {members.length === 0 ? 'no members' : members.map((m) => m.name).join(', ')}
        </span>
      </div>

      <div className="strip-mid vca-mid">
        <Fader
          value={track.volume}
          label={`${track.name} VCA level`}
          onGestureStart={() => store.getState().beginGesture()}
          onGestureEnd={() => store.getState().endGesture()}
          onChange={(v) => store.getState().setTrack(track.id, { volume: v })}
        />
      </div>

      <div className="strip-btns">
        <button
          className={`th-mini${track.mute ? ' m-on' : ''}`}
          aria-pressed={track.mute}
          aria-label={`Mute ${track.name}`}
          title="Mute every member"
          onClick={() => store.getState().setTrack(track.id, { mute: !track.mute })}
        >
          M
        </button>
        <button
          className={`th-mini${track.solo ? ' s-on' : ''}`}
          aria-pressed={track.solo}
          aria-label={`Solo ${track.name}`}
          title="Solo every member"
          onClick={() => store.getState().setTrack(track.id, { solo: !track.solo })}
        >
          S
        </button>
      </div>

      <div className="strip-readout">
        <span className="rd-db">{formatDb(track.volume)}</span>
        <span className="rd-pk">VCA</span>
      </div>

      <div className="strip-foot">
        <div className="strip-route static">SCALES {members.length}</div>
      </div>
    </div>
  );
});

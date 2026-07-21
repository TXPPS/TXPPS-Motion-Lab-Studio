import { memo } from 'react';
import type { Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { longPress } from '../../hooks/usePointerDrag';
import { Icon, type IconName } from '../common/Icon';
import { PanKnob } from '../common/widgets';

const TYPE_ICON: Record<Track['type'], IconName> = {
  audio: 'wave',
  instrument: 'piano',
  drum: 'grid',
  bus: 'mixer',
};

export const TrackHeader = memo(function TrackHeader({
  track,
  height,
}: {
  track: Track;
  height: number;
}) {
  const selected = useUiStore((s) => s.selectedTrackId === track.id);
  const store = useProjectStore;
  const ui = useUiStore;

  const rename = () =>
    ui.getState().showDialog({
      kind: 'prompt',
      title: 'Rename track',
      initialValue: track.name,
      confirmLabel: 'Rename',
      onSubmit: (v) => v && store.getState().setTrack(track.id, { name: v }),
    });

  const openMenu = (x: number, y: number) => {
    ui.getState().selectTrack(track.id);
    const items = [
      { label: 'Rename…', action: rename },
      { label: 'Duplicate', action: () => store.getState().duplicateTrack(track.id) },
      ...(track.type === 'instrument' || track.type === 'drum'
        ? [
            {
              label: 'Add MIDI clip',
              action: () => {
                const beat = Math.floor(useProjectStore.getState().project.loop.start);
                const id = store.getState().addMidiClip(track.id, beat, 4);
                ui.getState().selectClip(id, track.id);
              },
            },
          ]
        : []),
      {
        label: 'Delete track',
        danger: true,
        action: () =>
          ui.getState().showDialog({
            kind: 'confirm',
            title: `Delete "${track.name}"?`,
            message: 'The track and all of its clips will be removed.',
            confirmLabel: 'Delete',
            danger: true,
            onSubmit: () => store.getState().deleteTrack(track.id),
          }),
      },
    ];
    ui.getState().showMenu({ x, y, items });
  };

  const collapsed = height <= 32;
  return (
    <div
      className={`th${selected ? ' selected' : ''}`}
      style={{ height, ['--th-color' as string]: track.color }}
      onClick={() => ui.getState().selectTrack(track.id)}
      onDoubleClick={rename}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.clientX, e.clientY);
      }}
      onPointerDown={longPress((x, y) => openMenu(x, y))}
      data-testid={`track-header-${track.name}`}
    >
      <div className="th-row">
        <span className="th-type">
          <Icon name={TYPE_ICON[track.type]} size={11} />
        </span>
        <span className="th-name">{track.name}</span>
        <button
          className="th-mini"
          title="Collapse/expand"
          onClick={(e) => {
            e.stopPropagation();
            store.getState().setTrack(track.id, { collapsed: !track.collapsed });
          }}
        >
          <Icon name={track.collapsed ? 'chevron-down' : 'chevron-up'} size={10} />
        </button>
        <button
          className="th-mini"
          title="Track menu"
          onClick={(e) => {
            e.stopPropagation();
            openMenu(e.clientX, e.clientY);
          }}
          data-testid={`track-menu-${track.name}`}
        >
          <Icon name="dots" size={11} />
        </button>
      </div>
      {!collapsed && (
        <div className="th-controls" onClick={(e) => e.stopPropagation()}>
          <button
            className={`th-mini${track.mute ? ' m-on' : ''}`}
            title="Mute"
            aria-pressed={track.mute}
            onClick={() => store.getState().setTrack(track.id, { mute: !track.mute })}
            data-testid={`mute-${track.name}`}
          >
            M
          </button>
          <button
            className={`th-mini${track.solo ? ' s-on' : ''}`}
            title="Solo"
            aria-pressed={track.solo}
            onClick={() => store.getState().setTrack(track.id, { solo: !track.solo })}
            data-testid={`solo-${track.name}`}
          >
            S
          </button>
          {track.type !== 'bus' && (
            <button
              className={`th-mini${track.armed ? ' r-on' : ''}`}
              title="Record arm (routes live input here)"
              aria-pressed={track.armed}
              onClick={() => store.getState().setTrack(track.id, { armed: !track.armed })}
            >
              ●
            </button>
          )}
          <div className="th-vol">
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.01}
              value={track.volume}
              aria-label={`${track.name} volume`}
              data-testid={`vol-${track.name}`}
              onChange={(e) =>
                store.getState().setTrack(track.id, { volume: Number(e.target.value) })
              }
            />
            <PanKnob
              size={20}
              value={track.pan}
              onChange={(v) => store.getState().setTrack(track.id, { pan: v })}
              label={`${track.name} pan`}
            />
          </div>
        </div>
      )}
    </div>
  );
});

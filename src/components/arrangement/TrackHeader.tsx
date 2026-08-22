import { memo } from 'react';
import type { Track } from '../../model/types';
import {
  AUTOMATION_MODES,
  AUTOMATION_MODE_BLURBS,
  modeRecords,
  type AutomationMode,
} from '../../model/automation';
import { listAutoParams } from '../../model/paramRegistry';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { longPress } from '../../hooks/usePointerDrag';
import { Icon, type IconName } from '../common/Icon';
import { PanKnob } from '../common/widgets';
import { captureParamChange, captureParamRelease } from '../../app/automationActions';

const TYPE_ICON: Record<Track['type'], IconName> = {
  audio: 'wave',
  instrument: 'piano',
  drum: 'grid',
  bus: 'mixer',
  fx: 'zap',
  folder: 'folder',
  vca: 'vca',
};

export const TrackHeader = memo(function TrackHeader({
  track,
  height,
  depth = 0,
}: {
  track: Track;
  height: number;
  /** How many folders deep this track sits, for the indent guide. */
  depth?: number;
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

  /** Parameters not yet automated on this track, offered as new lanes. */
  const openAddLaneMenu = (x: number, y: number) => {
    const p = useProjectStore.getState().project;
    const t = p.tracks.find((tr) => tr.id === track.id);
    if (!t) return;
    const existing = new Set((t.automation ?? []).map((l) => l.paramId));
    const candidates = listAutoParams(t, p).filter((param) => !existing.has(param.id));
    ui.getState().showMenu({
      x,
      y,
      items: candidates.length
        ? candidates.map((param) => ({
            label: param.name,
            action: () => store.getState().addAutomationLane(track.id, param.id),
          }))
        : [{ label: 'Every parameter already has a lane', disabled: true, action: () => {} }],
    });
  };

  const openMenu = (x: number, y: number) => {
    ui.getState().selectTrack(track.id);
    const items = [
      { label: 'Rename…', action: rename },
      { label: 'Duplicate', action: () => store.getState().duplicateTrack(track.id) },
      ...(track.type === 'folder'
        ? [
            {
              label: track.folded ? 'Unfold' : 'Fold',
              action: () => store.getState().setTrack(track.id, { folded: !track.folded }),
            },
            {
              label: 'Ungroup (keep the tracks)',
              action: () => store.getState().ungroupFolder(track.id),
            },
          ]
        : [
            {
              label: 'Group into a new folder',
              action: () => {
                const id = store.getState().groupTracks([track.id]);
                if (id) ui.getState().selectTrack(id);
              },
            },
            ...(track.folderId
              ? [
                  {
                    label: 'Remove from folder',
                    action: () => store.getState().setFolderFor(track.id, undefined),
                  },
                ]
              : []),
          ]),
      {
        label: track.automationOpen ? 'Hide automation lanes' : 'Show automation lanes',
        shortcut: 'A btn',
        action: () =>
          store.getState().setTrack(track.id, { automationOpen: !track.automationOpen }),
      },
      { label: 'Add automation lane…', action: () => openAddLaneMenu(x, y) },
      {
        label: track.locked ? 'Unlock track' : 'Lock track (blocks clip edits)',
        action: () => store.getState().setTrack(track.id, { locked: !track.locked }),
      },
      ...[1, 2, 3, 4].map((g) => ({
        label: `${track.editGroup === g ? '● ' : ''}Edit group ${g}`,
        action: () =>
          store.getState().setTrack(track.id, { editGroup: track.editGroup === g ? undefined : g }),
      })),
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
      className={`th${selected ? ' selected' : ''}${track.type === 'folder' ? ' folder' : ''}`}
      style={{
        height,
        ['--th-color' as string]: track.color,
        ['--th-depth' as string]: String(depth),
      }}
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
        {track.type === 'folder' ? (
          <button
            className="th-type th-fold"
            title={track.folded ? 'Unfold this group' : 'Fold this group'}
            aria-expanded={!track.folded}
            aria-label={`${track.folded ? 'Unfold' : 'Fold'} ${track.name}`}
            onClick={(e) => {
              e.stopPropagation();
              store.getState().setTrack(track.id, { folded: !track.folded });
            }}
            data-testid={`fold-${track.name}`}
          >
            <Icon name={track.folded ? 'folder' : 'folder-open'} size={12} />
          </button>
        ) : (
          <span className="th-type">
            <Icon name={TYPE_ICON[track.type]} size={11} />
          </span>
        )}
        <span className="th-name">
          {track.locked && <Icon name="lock" size={9} />}
          {track.name}
          {track.editGroup ? <span className="th-group">G{track.editGroup}</span> : null}
        </span>
        <button
          className={`th-mini th-auto${track.automationOpen ? ' a-on' : ''}`}
          title={
            (track.automation ?? []).length
              ? track.automationOpen
                ? 'Hide automation lanes'
                : 'Show automation lanes'
              : 'Add an automation lane'
          }
          aria-pressed={!!track.automationOpen}
          data-testid={`auto-toggle-${track.name}`}
          onClick={(e) => {
            e.stopPropagation();
            if ((track.automation ?? []).length === 0) {
              openAddLaneMenu(e.clientX, e.clientY);
            } else {
              store.getState().setTrack(track.id, { automationOpen: !track.automationOpen });
            }
          }}
        >
          A
        </button>
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
              title={
                track.type === 'audio'
                  ? 'Record arm — routes live input here'
                  : 'Record arm — what you play is recorded here'
              }
              aria-label={`Record arm ${track.name}`}
              aria-pressed={track.armed}
              data-testid={`arm-${track.name}`}
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
              onChange={(e) => {
                const v = Number(e.target.value);
                store.getState().setTrack(track.id, { volume: v });
                captureParamChange(track.id, 'volume', v);
              }}
              onPointerUp={() => captureParamRelease(track.id, 'volume')}
            />
            <PanKnob
              size={20}
              value={track.pan}
              onChange={(v) => {
                store.getState().setTrack(track.id, { pan: v });
                captureParamChange(track.id, 'pan', v);
              }}
              onGestureEnd={() => captureParamRelease(track.id, 'pan')}
              label={`${track.name} pan`}
            />
          </div>
          {track.automationOpen && (
            <select
              className={`th-automode${modeRecords(track.automationMode) ? ' recording' : ''}`}
              value={track.automationMode ?? 'read'}
              title={AUTOMATION_MODE_BLURBS[track.automationMode ?? 'read']}
              aria-label={`${track.name} automation mode`}
              data-testid={`automode-${track.name}`}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                store.getState().setAutomationMode(track.id, e.target.value as AutomationMode)
              }
            >
              {AUTOMATION_MODES.map((m) => (
                <option key={m} value={m} title={AUTOMATION_MODE_BLURBS[m]}>
                  {m[0].toUpperCase() + m.slice(1)}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
});

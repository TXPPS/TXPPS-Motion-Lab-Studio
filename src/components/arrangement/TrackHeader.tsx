import { memo } from 'react';
import type { Track } from '../../model/types';
import {
  AUTOMATION_MODES,
  AUTOMATION_MODE_BLURBS,
  modeRecords,
  type AutomationMode,
} from '../../model/automation';
import { listAutoParams } from '../../model/paramRegistry';
import { isFrozen } from '../../model/freeze';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { longPress, usePointerDrag } from '../../hooks/usePointerDrag';
import { useTapOrDouble } from '../../hooks/useTapOrDouble';
import { clampTrackHeight, isCollapsedHeight } from './trackHeight';
import { trackMenuItems } from './trackMenu';
import { Icon, type IconName } from '../common/Icon';
import { PanKnob } from '../common/widgets';
import { captureParamChange, captureParamRelease } from '../../app/automationActions';
import { isMonitoring, setArmed, toggleMonitoring } from '../../app/monitorActions';
import { useTransportStore } from '../../state/transportStore';

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
  silencedBySolo = false,
}: {
  track: Track;
  height: number;
  /** How many folders deep this track sits, for the indent guide. */
  depth?: number;
  /**
   * True when this track is silent because something else is soloed. Passed in
   * rather than resolved here: the mixer graph resolves every channel at once,
   * and a header that worked it out for itself would be a second opinion about
   * what is audible — the exact thing that lets a header and a meter disagree.
   */
  silencedBySolo?: boolean;
}) {
  const selected = useUiStore((s) => s.selectedTrackId === track.id);
  // `engine.isMonitoring` is the truth; the stored flag is what survives a
  // reload. Subscribing to the transport's stream count is what re-renders this
  // when monitoring is started or stopped from another surface.
  useTransportStore((s) => s.audioState);
  const monitoring = track.type === 'audio' && isMonitoring(track.id);
  // The global multiplier, for the menu's height steps. A step has to be a step
  // in *drawn* pixels, and what the track is drawn at depends on this.
  const laneScale = useProjectStore((s) => s.project.workspace.laneScale);
  const toggleMonitor = () => toggleMonitoring(track.id);
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

  /**
   * The track menu: every command the header cannot draw a control for.
   *
   * The list lives in `trackMenu.ts`. It is the destination for everything a
   * small screen takes away — the fader, the pan knob, solo, and the height
   * grip — so it grows whenever a control goes, and it was most of this file.
   */
  const openMenu = (x: number, y: number) => {
    ui.getState().selectTrack(track.id);
    ui.getState().showMenu({
      x,
      y,
      items: trackMenuItems({ track, monitoring, laneScale, rename, openAddLaneMenu }, x, y),
    });
  };

  // Not `height <= 32`, which was a second constant that agreed with the 30 px
  // collapsed lane by coincidence — and which the touch floor breaks in both
  // directions at once, since it raises a collapsed lane to 44 and the
  // shortest open one to 44 as well. `isCollapsedHeight` says why the flag has
  // to be the input rather than the height.
  const collapsed = isCollapsedHeight(height, track.collapsed);

  /**
   * Drag the bottom edge to set this track's height.
   *
   * The automation lane's grip, one row up. `h0` is captured at the press and
   * every move is measured from it rather than from the move before, so a
   * gesture that wanders cannot accumulate drift — the same reason the zoom
   * drag does it that way.
   */
  const dragResize = usePointerDrag<{ h0: number }>({
    onStart: () => ({ h0: height }),
    onMove: (_dx, dy, _e, d) =>
      store.getState().setTrackHeight(track.id, clampTrackHeight(d.h0 + dy)),
  });

  /**
   * Two presses on the grip put the track back to the layout default.
   *
   * The grip's only other gesture is a drag, so a press that never moves is
   * unambiguous and costs nothing — and without it there is no route back to
   * "whatever the global height says" once a track has been resized, short of
   * dragging until it looks right. `useTapOrDouble` reads the event's own
   * timestamp, which is what a test can set and what a frozen clock cannot
   * break.
   */
  const resetHeight = useTapOrDouble(
    () => {},
    () => store.getState().setTrackHeight(track.id, undefined),
  );

  return (
    <div
      className={`th${selected ? ' selected' : ''}${track.type === 'folder' ? ' folder' : ''}${
        collapsed ? ' th-collapsed' : ''
      }`}
      style={{
        height,
        ['--th-color' as string]: track.color,
        ['--th-depth' as string]: String(depth),
      }}
      // Not role="option": an option may not contain interactive children, and
      // a track header holds mute, solo, arm, a fader and a menu. A focusable
      // group with aria-current says "this is the selected one" without
      // promising a listbox the markup cannot honour.
      role="group"
      tabIndex={0}
      aria-current={selected || undefined}
      aria-label={`${track.name}, ${track.type} track${track.locked ? ', locked' : ''}${
        isFrozen(track) ? ', frozen' : ''
      }`}
      onClick={() => ui.getState().selectTrack(track.id)}
      onKeyDown={(e) => {
        // Selecting a track is what arming and recording are gated on, so the
        // header answers the same two keys any option in a list would.
        if (e.target !== e.currentTarget) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        ui.getState().selectTrack(track.id);
      }}
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
          {/* The one place a frozen track is visible without opening a panel.
              The title says what it means, because a snowflake alone does not
              tell anyone their instrument has stopped running. */}
          {isFrozen(track) && (
            <span
              className="th-frozen"
              title={`${track.name} is frozen — it plays a render instead of its instrument`}
              data-testid={`frozen-${track.name}`}
            >
              <Icon name="freeze" size={9} />
            </span>
          )}
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
            className={`th-mini${track.mute ? ' m-on' : ''}${
              !track.mute && silencedBySolo ? ' m-implicit' : ''
            }`}
            title={
              track.mute
                ? 'Muted'
                : silencedBySolo
                  ? 'Silent because another track is soloed — this track is not muted'
                  : 'Mute'
            }
            aria-label={`Mute ${track.name}`}
            aria-pressed={track.mute}
            onClick={() => store.getState().setTrack(track.id, { mute: !track.mute })}
            data-testid={`mute-${track.name}`}
          >
            M
          </button>
          <button
            className={`th-mini th-solo${track.solo ? ' s-on' : ''}`}
            title="Solo"
            aria-label={`Solo ${track.name}`}
            aria-pressed={track.solo}
            onClick={() => store.getState().setTrack(track.id, { solo: !track.solo })}
            data-testid={`solo-${track.name}`}
          >
            S
          </button>
          {track.type === 'audio' && (
            <button
              className={`th-mini th-monitor${monitoring ? ' mon-on' : ''}`}
              title={
                monitoring
                  ? 'Input monitoring on — you are hearing the live input'
                  : 'Monitor the live input through this channel'
              }
              aria-label={`Input monitoring ${track.name}`}
              aria-pressed={monitoring}
              data-testid={`monitor-${track.name}`}
              onClick={() => void toggleMonitor()}
            >
              <Icon name={monitoring ? 'speaker' : 'speaker-off'} size={12} />
            </button>
          )}
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
              onClick={() => void setArmed(track.id, !track.armed)}
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
      {/*
        The height grip.

        Placed last so it paints over the strip's bottom edge, and given the
        whole width of the header because there is nothing else along that
        edge to take a press from.

        **Its grab zone is spent upward only.** `.alh-resize` reaches 2 px past
        its own row, and a hit area that overhangs its row takes its
        neighbour's presses — the pane divider did exactly that to the mixer's
        cue bar. The row below this one is the next track's header, whose own
        name row and control strip start at its first pixel, so every pixel of
        this grip is inside the track it resizes.
      */}
      <div
        className="th-resize"
        data-testid={`track-resize-${track.name}`}
        title="Drag to set this track's height · press twice to reset it"
        aria-label={`Resize ${track.name}`}
        onPointerDown={(e) => {
          // Both gestures, in order. `dragResize` stops propagation, so the
          // header's own press handlers never see this — which is right: a
          // press on the grip is not a press on the track.
          resetHeight(e);
          dragResize(e);
        }}
      />
    </div>
  );
});

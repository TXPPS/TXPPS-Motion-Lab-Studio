/**
 * What the track header's menu offers, and why it is a separate file.
 *
 * The menu is this product's answer to every control a small screen cannot
 * draw. The strip sheds the fader, the pan knob and solo on a coarse pointer;
 * a collapsed track draws no strip at all; and the height grip cannot exist on
 * a finger, because a 44 px band along a 64 px header's bottom edge would take
 * every press meant for mute, arm and monitor. WCAG 2.5.8 obliges the
 * alternative to carry *every* command the absent control offers, so this list
 * grows every time something is taken away — which is exactly why it does not
 * belong inside a component that also has to lay out a header.
 *
 * It takes what it needs rather than reading stores itself: `laneScale`
 * especially, because a height step has to be a step in *drawn* pixels and the
 * global multiplier is what decides what a track is drawn at.
 */
import type { MenuItem } from '../../state/uiStore';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { usePrefsStore } from '../../state/prefsStore';
import { freezeTrack, unfreezeTrack } from '../../audio/freeze';
import { toggleMonitoring } from '../../app/monitorActions';
import { stepTrackHeight } from './trackHeight';
import type { Track } from '../../model/types';

export interface TrackMenuContext {
  track: Track;
  /** True when the engine is monitoring this track's input right now. */
  monitoring: boolean;
  /** The arrangement's vertical zoom, for the height steps. */
  laneScale: number;
  /** Opens the rename dialog; it lives with the header because it is one. */
  rename: () => void;
  /** Opens the "add automation lane" submenu at a point. */
  openAddLaneMenu: (x: number, y: number) => void;
}

/** Every command the track menu carries, in the order it shows them. */
export function trackMenuItems(
  { track, monitoring, laneScale, rename, openAddLaneMenu }: TrackMenuContext,
  x: number,
  y: number,
): MenuItem[] {
  const store = useProjectStore;
  const ui = useUiStore;
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
      action: () => store.getState().setTrack(track.id, { automationOpen: !track.automationOpen }),
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
          {
            label: track.freeze
              ? 'Unfreeze — bring the instrument back'
              : 'Freeze — render this track to audio',
            testId: `freeze-menu-${track.name}`,
            action: () => {
              if (track.freeze) unfreezeTrack(track.id);
              else void freezeTrack(track.id);
            },
          },
        ]
      : []),
    // What the control strip gives up on a narrow or collapsed header has to
    // be reachable, not gone: the strip drops the fader and the pan knob on
    // touch, and drops everything when the track is collapsed.
    {
      label: track.automationOpen ? 'Hide automation lanes' : 'Show automation lanes',
      action: () => store.getState().setTrack(track.id, { automationOpen: !track.automationOpen }),
    },
    {
      label: track.mute ? 'Unmute' : 'Mute',
      testId: `menu-mute-${track.name}`,
      action: () => store.getState().setTrack(track.id, { mute: !track.mute }),
    },
    {
      label: track.solo ? 'Unsolo' : 'Solo',
      action: () => store.getState().setTrack(track.id, { solo: !track.solo }),
    },
    ...(track.type === 'audio'
      ? [
          {
            label: monitoring ? 'Stop monitoring input' : 'Monitor input',
            action: () => void toggleMonitoring(track.id),
          },
        ]
      : []),
    {
      label: 'Level and pan…',
      action: () => {
        useWorkspaceStore.getState().reveal('inspector');
        ui.getState().selectTrack(track.id);
      },
    },
    /*
     * Track height, as commands.
     *
     * The grip is a 5 px lip with a taller press band, and on a coarse
     * pointer that band cannot be 44 px: the touch header is 64 px — 2
     * padding, an 18 px name row and a 44 px control strip — so a 44 px grip
     * along the bottom edge would sit on top of mute, arm and monitor and
     * take every one of their presses. That is the defect this codebase has
     * now hit five times, and the rule is that where the row cannot hold the
     * minimum, the row grows or the control goes.
     *
     * Growing the row is what `LANE_H` already refuses on the devices that
     * show the fewest tracks, so the control goes and these three carry
     * every command it offers — taller, shorter, and the reset that its
     * double press performs. WCAG 2.5.8's equivalent alternative, and the
     * same route the strip's own dropped controls take.
     */
    {
      label: 'Taller track',
      testId: `menu-taller-${track.name}`,
      action: () => store.getState().setTrackHeight(track.id, stepTrackHeight(track, laneScale, 1)),
    },
    {
      label: 'Shorter track',
      testId: `menu-shorter-${track.name}`,
      action: () =>
        store.getState().setTrackHeight(track.id, stepTrackHeight(track, laneScale, -1)),
    },
    {
      label: 'Reset track height',
      testId: `menu-reset-height-${track.name}`,
      disabled: track.height === undefined,
      action: () => store.getState().setTrackHeight(track.id, undefined),
    },
    {
      label: 'Delete track',
      danger: true,
      // The preference decides. It is the one destructive edit worth asking
      // about — a clip comes back with one undo, a track takes everything on
      // it with it — and it was a setting that had never been read.
      action: () =>
        usePrefsStore.getState().confirmDestructive
          ? ui.getState().showDialog({
              kind: 'confirm',
              title: `Delete "${track.name}"?`,
              message: 'The track and all of its clips will be removed.',
              confirmLabel: 'Delete',
              danger: true,
              onSubmit: () => store.getState().deleteTrack(track.id),
            })
          : store.getState().deleteTrack(track.id),
    },
  ];
  return items;
}

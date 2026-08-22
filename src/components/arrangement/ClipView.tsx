import { memo, useMemo } from 'react';
import { copySelection, cutSelection, duplicateSelection } from '../../app/clipboardActions';
import {
  crossfadeSelection,
  healSelection,
  maxSlipOffset,
  normalizeClip,
  packSelectionIntoTakes,
  rippleDeleteSelection,
} from '../../app/audioEditActions';
import { shortcutLabel } from '../../app/shortcuts';
import { usePointerDrag, longPress } from '../../hooks/usePointerDrag';
import { Waveform } from './Waveform';
import { clamp, clipSecondsPerBeat, snapBeat } from '../../model/music';
import type { Clip, Track } from '../../model/types';
import { TRACK_COLORS } from '../../model/types';
import { compSpans } from '../../model/comping';
import { useProjectStore } from '../../state/projectStore';
import { engine } from '../../audio/engine';
import { useUiStore } from '../../state/uiStore';

function MidiPreview({ clip, height }: { clip: Extract<Clip, { type: 'midi' }>; height: number }) {
  const { notes: allNotes } = clip;
  const rects = useMemo(() => {
    // The preview is a thumbnail, not an editor: past a few hundred notes,
    // extra rects add DOM weight without adding legibility. Sample evenly so
    // a 6000-note stack still previews its whole span.
    const stride = Math.max(1, Math.ceil(allNotes.length / 400));
    const notes = stride === 1 ? allNotes : allNotes.filter((_, i) => i % stride === 0);
    if (notes.length === 0) return [];
    let lo = 127;
    let hi = 0;
    for (const n of notes) {
      if (n.pitch < lo) lo = n.pitch;
      if (n.pitch > hi) hi = n.pitch;
    }
    lo -= 1;
    hi += 1;
    const span = Math.max(hi - lo, 6);
    return notes.map((n) => ({
      key: n.id,
      x: (n.start / clip.length) * 100,
      w: Math.max(0.6, (n.length / clip.length) * 100),
      y: ((hi - n.pitch) / span) * (height - 14) + 11,
      o: 0.35 + (n.velocity / 127) * 0.65,
    }));
  }, [allNotes, clip.length, height]);
  return (
    <svg preserveAspectRatio="none">
      {rects.map((r) => (
        <rect
          key={r.key}
          x={`${r.x}%`}
          width={`${r.w}%`}
          y={r.y}
          height={2.4}
          rx={1}
          fill="#fff"
          opacity={r.o}
        />
      ))}
    </svg>
  );
}

interface ClipViewProps {
  clip: Clip;
  track: Track;
  laneHeight: number;
  pxPerBeat: number;
  laneAt: (clientY: number) => Track | null;
  onEdgeScroll?: (clientX: number, clientY: number) => void;
}

export const ClipView = memo(function ClipView({
  clip,
  track,
  laneHeight,
  pxPerBeat,
  laneAt,
  onEdgeScroll,
}: ClipViewProps) {
  const selected = useUiStore((s) => s.selectedClipIds.includes(clip.id));
  const snap = useUiStore((s) => s.snap);
  // Source seconds per musical beat for THIS clip's span — tempo-map aware.
  const spb = useProjectStore((s) => clipSecondsPerBeat(s.project, clip));
  const store = useProjectStore;
  const ui = useUiStore;

  const openMenu = (x: number, y: number) => {
    // Right-clicking inside an existing multi-selection keeps it, so the menu
    // can act on the whole group; outside it, selection moves to this clip.
    const uiState = ui.getState();
    if (!uiState.selectedClipIds.includes(clip.id)) {
      uiState.selectClip(clip.id, clip.trackId);
    } else {
      uiState.set({ selectedClipId: clip.id, selectedTrackId: clip.trackId });
    }
    const ids = ui.getState().selectedClipIds;
    const many = ids.length > 1;
    const label = (single: string, plural: string) =>
      many ? `${plural} (${ids.length})` : single;

    ui.getState().showMenu({
      x,
      y,
      items: [
        ...(clip.type === 'midi' && !many
          ? [
              {
                label: 'Open in Piano Roll',
                action: () => ui.getState().openEditorFor(clip.id, window.innerWidth < 700),
              },
            ]
          : []),
        ...(!many
          ? [
              {
                label: 'Rename…',
                action: () =>
                  ui.getState().showDialog({
                    kind: 'prompt',
                    title: 'Rename clip',
                    initialValue: clip.name,
                    confirmLabel: 'Rename',
                    onSubmit: (v) => v && store.getState().setClip(clip.id, { name: v }),
                  }),
              },
            ]
          : []),
        {
          label: label('Copy', 'Copy clips'),
          shortcut: shortcutLabel('copy'),
          action: () => copySelection(),
        },
        {
          label: label('Cut', 'Cut clips'),
          shortcut: shortcutLabel('cut'),
          action: () => cutSelection(),
        },
        {
          label: label('Duplicate', 'Duplicate clips'),
          shortcut: shortcutLabel('duplicate'),
          action: () => duplicateSelection(),
        },
        ...(!many
          ? [
              {
                label: 'Split at playhead',
                shortcut: shortcutLabel('split'),
                action: () => {
                  const at = engine.getPositionBeats();
                  if (!store.getState().splitClip(clip.id, at)) {
                    ui.getState().toast('info', 'Move the playhead inside the clip to split it.');
                  }
                },
              },
            ]
          : []),
        ...(clip.type === 'audio' && !many
          ? [
              {
                label: 'Clip gain…',
                action: () =>
                  ui.getState().showDialog({
                    kind: 'prompt',
                    title: 'Clip gain',
                    message: 'Linear gain (1 = unity, 0.5 = -6 dB, 2 = +6 dB).',
                    initialValue: String(clip.gain),
                    confirmLabel: 'Apply',
                    onSubmit: (v) => {
                      const n = Number(v);
                      if (Number.isFinite(n)) store.getState().setClipGain(clip.id, n);
                    },
                  }),
              },
              {
                label: 'Clear fades',
                action: () => store.getState().setClipFades(clip.id, 0, 0),
              },
            ]
          : []),
        {
          label: many ? `Mute/unmute (${ids.length})` : clip.muted ? 'Unmute' : 'Mute',
          action: () => {
            const clips = store.getState().project.clips.filter((c) => ids.includes(c.id));
            // Mixed states resolve toward muted, so one press always silences.
            const target = clips.some((c) => !c.muted);
            for (const c of clips) store.getState().setClip(c.id, { muted: target });
          },
        },
        // ---- Milestone 6 editing ----
        ...(() => {
          const p = store.getState().project;
          const sel = p.clips.filter((c) => ids.includes(c.id));
          const audioSel = sel.filter((c) => c.type === 'audio');
          const sameTrack = audioSel.length === 2 && audioSel[0].trackId === audioSel[1].trackId;
          const items = [];
          if (sameTrack) {
            items.push(
              {
                label: 'Crossfade (equal power)',
                action: () => crossfadeSelection('equalPower'),
              },
              { label: 'Crossfade (linear)', action: () => crossfadeSelection('linear') },
            );
          }
          if (audioSel.length >= 2 && audioSel.every((c) => c.trackId === audioSel[0].trackId)) {
            items.push({ label: `Pack ${audioSel.length} clips into takes`, action: () => packSelectionIntoTakes() });
          }
          if (many) {
            items.push({ label: 'Heal splits', action: () => healSelection() });
          }
          if (clip.type === 'audio' && !many) {
            items.push({ label: 'Normalize to −0.3 dB', action: () => normalizeClip(clip.id) });
            items.push({
              label: clip.phaseInvert ? 'Phase: inverted ✓' : 'Phase invert',
              action: () => store.getState().setClip(clip.id, { phaseInvert: !clip.phaseInvert }),
            });
            items.push({
              label: clip.monoSum ? 'Mono sum ✓' : 'Mono sum',
              action: () => store.getState().setClip(clip.id, { monoSum: !clip.monoSum }),
            });
            if (clip.takes?.length) {
              items.push({
                label: clip.takesOpen ? 'Hide take lanes' : 'Show take lanes',
                action: () => store.getState().setClipView(clip.id, { takesOpen: !clip.takesOpen }),
              });
            }
          }
          items.push({
            label: many
              ? `${sel.some((c) => !c.locked) ? 'Lock' : 'Unlock'} (${ids.length})`
              : clip.locked
                ? 'Unlock'
                : 'Lock',
            action: () => {
              const target = sel.some((c) => !c.locked);
              for (const c of sel) store.getState().setClip(c.id, { locked: target });
            },
          });
          items.push({
            label: label('Ripple delete', 'Ripple delete clips'),
            danger: true,
            action: () => rippleDeleteSelection(),
          });
          return items;
        })(),
        {
          label: label('Delete', 'Delete clips'),
          shortcut: shortcutLabel('delete'),
          danger: true,
          action: () => {
            store.getState().deleteClips(ids);
            ui.getState().selectClips([]);
          },
        },
      ],
    });
  };

  interface MoveState {
    id: string;
    start: number;
    /** other selected clips moving with this one, with their original starts */
    group: { id: string; start: number }[];
  }

  const dragMove = usePointerDrag<MoveState>({
    onStart: (e) => {
      let id = clip.id;
      const uiState = ui.getState();
      if (e.altKey) {
        const dup = store.getState().duplicateClip(clip.id, true);
        if (dup) id = dup;
        uiState.selectClip(id, clip.trackId);
      } else if (e.shiftKey || e.ctrlKey || e.metaKey) {
        uiState.toggleClipSelection(clip.id, clip.trackId);
      } else if (!uiState.selectedClipIds.includes(clip.id)) {
        // Clicking an unselected clip replaces the selection; clicking inside
        // an existing multi-selection keeps it, so the group can be dragged.
        uiState.selectClip(clip.id, clip.trackId);
        // Edit groups: link time-overlapping clips across grouped tracks so a
        // multitrack take moves as one block.
        if (track.editGroup) {
          const p = store.getState().project;
          const groupTracks = new Set(
            p.tracks.filter((t) => t.editGroup === track.editGroup).map((t) => t.id),
          );
          const linked = p.clips
            .filter(
              (c) =>
                groupTracks.has(c.trackId) &&
                c.start < clip.start + clip.length &&
                c.start + c.length > clip.start,
            )
            .map((c) => c.id);
          if (linked.length > 1) uiState.selectClips(linked);
          uiState.set({ selectedClipId: clip.id, selectedTrackId: clip.trackId });
        }
      } else {
        uiState.set({ selectedClipId: clip.id, selectedTrackId: clip.trackId });
      }
      const ids = ui.getState().selectedClipIds;
      const clips = store.getState().project.clips;
      const group = clips
        .filter((c) => ids.includes(c.id) && c.id !== id)
        .map((c) => ({ id: c.id, start: c.start }));
      store.getState().beginGesture();
      return { id, start: clip.start, group };
    },
    onMove: (dx, _dy, e, d) => {
      // Shift bypasses snapping for fine placement — checked per move so it
      // can be pressed and released mid-drag.
      const raw = d.start + dx / pxPerBeat;
      const beats = e.shiftKey ? raw : snapBeat(raw, snap);
      if (d.group.length === 0) {
        // Single clip: free horizontal + vertical lane moves.
        const targetTrack = laneAt(e.clientY);
        store.getState().moveClip(d.id, Math.max(0, beats), targetTrack?.id);
      } else {
        // Group: one shared beat delta in one store update. Re-anchoring from
        // the grabbed clip's *current* position keeps the group drift-free even
        // after the zero-wall clamp has engaged. Lane changes stay single-clip
        // only — moving many clips across heterogeneous track types has no
        // predictable meaning.
        const grabbed = store.getState().project.clips.find((c) => c.id === d.id);
        if (grabbed) {
          const increment = Math.max(0, beats) - grabbed.start;
          if (increment !== 0) {
            store.getState().moveClipsBy([d.id, ...d.group.map((g) => g.id)], increment);
          }
        }
      }
      onEdgeScroll?.(e.clientX, e.clientY);
    },
    onEnd: () => store.getState().endGesture(),
  });

  const dragRight = usePointerDrag<{ len: number }>({
    onStart: () => {
      store.getState().beginGesture();
      return { len: clip.length };
    },
    onMove: (dx, _dy, _e, d) => {
      const len = Math.max(snap || 0.25, snapBeat(d.len + dx / pxPerBeat, snap));
      if (clip.type === 'audio') store.getState().trimClipEnd(clip.id, len);
      else store.getState().resizeClip(clip.id, clip.start, len);
    },
    onEnd: () => store.getState().endGesture(),
  });

  const dragLeft = usePointerDrag<{ start: number; end: number }>({
    onStart: () => {
      store.getState().beginGesture();
      return { start: clip.start, end: clip.start + clip.length };
    },
    onMove: (dx, _dy, _e, d) => {
      let start = snapBeat(d.start + dx / pxPerBeat, snap);
      start = Math.min(Math.max(0, start), d.end - (snap || 0.25));
      if (clip.type === 'audio') store.getState().trimClipStart(clip.id, start);
      else store.getState().resizeClip(clip.id, start, d.end - start);
    },
    onEnd: () => store.getState().endGesture(),
  });

  const widthPx = Math.max(6, clip.length * pxPerBeat);
  const locked = !!clip.locked || !!track.locked;

  /** Slip tool: slide the source under the fixed clip window. */
  const dragSlip = usePointerDrag<{ offset0: number; max?: number }>({
    onStart: () => {
      store.getState().beginGesture();
      return {
        offset0: clip.type === 'audio' ? clip.offset : 0,
        max: clip.type === 'audio' ? maxSlipOffset(clip) : 0,
      };
    },
    onMove: (dx, _dy, _e, d) => {
      if (clip.type !== 'audio') return;
      const pxPerSec = pxPerBeat / spb;
      // Dragging right slides the material right — earlier source shows.
      let want = d.offset0 - dx / pxPerSec;
      if (d.max !== undefined) want = Math.min(want, d.max);
      want = Math.max(0, want);
      const cur = store.getState().project.clips.find((c) => c.id === clip.id);
      if (cur?.type === 'audio') store.getState().slipClip(clip.id, want - cur.offset, d.max);
    },
    onEnd: () => store.getState().endGesture(),
  });
  const srcSec = clip.type === 'audio' ? (clip.sourceDuration ?? clip.length * spb) : 0;
  const pxPerSec = srcSec > 0 ? widthPx / srcSec : 0;
  const fadeInPx = clip.type === 'audio' ? clip.fadeIn * pxPerSec : 0;
  const fadeOutPx = clip.type === 'audio' ? clip.fadeOut * pxPerSec : 0;

  const dragFadeIn = usePointerDrag<number>({
    onStart: () => {
      store.getState().beginGesture();
      return clip.type === 'audio' ? clip.fadeIn : 0;
    },
    onMove: (dx, _dy, _e, startFade) => {
      if (pxPerSec <= 0) return;
      store.getState().setClipFades(clip.id, clamp(startFade + dx / pxPerSec, 0, srcSec), undefined);
    },
    onEnd: () => store.getState().endGesture(),
  });

  const dragFadeOut = usePointerDrag<number>({
    onStart: () => {
      store.getState().beginGesture();
      return clip.type === 'audio' ? clip.fadeOut : 0;
    },
    onMove: (dx, _dy, _e, startFade) => {
      if (pxPerSec <= 0) return;
      store.getState().setClipFades(clip.id, undefined, clamp(startFade - dx / pxPerSec, 0, srcSec));
    },
    onEnd: () => store.getState().endGesture(),
  });

  const color = track.color;
  return (
    <div
      className={`clip${selected ? ' selected' : ''}${clip.muted ? ' muted' : ''}`}
      style={{
        left: clip.start * pxPerBeat,
        width: widthPx,
        ['--clip-bg' as string]: `color-mix(in srgb, ${color} 30%, #10151b)`,
      }}
      data-testid={`clip-${clip.name}`}
      onPointerDown={(e) => {
        // Non-pointer tools act on press and never start a drag. The action
        // uses the exact position under the cursor, snapped like any edit.
        const tool = ui.getState().tool;
        if (tool !== 'pointer' && e.button === 0) {
          e.stopPropagation();
          if (locked) {
            ui.getState().toast('info', 'This clip is locked — unlock it to edit.');
            return;
          }
          if (tool === 'erase') {
            store.getState().deleteClip(clip.id);
          } else if (tool === 'mute') {
            store.getState().setClip(clip.id, { muted: !clip.muted });
          } else if (tool === 'slip') {
            if (clip.type === 'audio') dragSlip(e);
            else ui.getState().toast('info', 'Slip works on audio clips.');
          } else if (tool === 'split') {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const at = snapBeat(clip.start + (e.clientX - rect.left) / pxPerBeat, snap);
            if (!store.getState().splitClip(clip.id, at)) {
              ui.getState().toast('info', 'Click inside the clip, away from its edges.');
            }
          }
          return;
        }
        longPress((x, y) => openMenu(x, y))(e);
        dragMove(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (clip.type === 'midi') ui.getState().openEditorFor(clip.id, window.innerWidth < 700);
        else if (clip.type === 'audio' && clip.takes?.length) {
          store.getState().setClipView(clip.id, { takesOpen: !clip.takesOpen });
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.clientX, e.clientY);
      }}
    >
      {clip.type === 'audio' ? (
        <Waveform
          mediaId={clip.mediaId}
          offsetSec={clip.offset}
          durationSec={clip.sourceDuration ?? clip.length * spb}
          color={color}
          gain={clip.gain}
          fadeIn={clip.fadeIn}
          fadeOut={clip.fadeOut}
          fadeInShape={clip.fadeInShape}
          fadeOutShape={clip.fadeOutShape}
          widthPx={widthPx}
          heightPx={laneHeight}
        />
      ) : (
        <MidiPreview clip={clip} height={laneHeight - 6} />
      )}
      {clip.type === 'audio' && clip.takes && clip.takes.length > 0 && (
        <div className="clip-comp-bar" data-testid={`comp-bar-${clip.name}`} aria-hidden="true">
          {compSpans(clip).map((s, i) => {
            const takeIdx = clip.takes!.findIndex((t) => t.id === s.take.id);
            return (
              <div
                key={i}
                className="clip-comp-seg"
                style={{
                  left: `${(s.fromBeat / clip.length) * 100}%`,
                  width: `${((s.toBeat - s.fromBeat) / clip.length) * 100}%`,
                  background: TRACK_COLORS[takeIdx % TRACK_COLORS.length],
                }}
              />
            );
          })}
        </div>
      )}
      <span className="clip-name">
        {clip.locked ? '🔒 ' : ''}
        {clip.muted ? '◇ ' : ''}
        {clip.name}
        {clip.type === 'audio' && clip.takes?.length ? (
          <span className="clip-take-badge">▤{clip.takes.length}</span>
        ) : null}
        {clip.type === 'audio' && clip.phaseInvert ? <span className="clip-flag">ø</span> : null}
        {clip.type === 'audio' && clip.monoSum ? <span className="clip-flag">M</span> : null}
      </span>
      {clip.type === 'audio' && !locked && (
        <>
          <div
            className="fade-handle in"
            title={`Drag to set the fade in${clip.fadeInShape && clip.fadeInShape !== 'linear' ? ` (${clip.fadeInShape})` : ''}`}
            style={{ left: Math.min(fadeInPx, widthPx - 8) }}
            onPointerDown={dragFadeIn}
          />
          <div
            className="fade-handle out"
            title={`Drag to set the fade out${clip.fadeOutShape && clip.fadeOutShape !== 'linear' ? ` (${clip.fadeOutShape})` : ''}`}
            style={{ right: Math.min(fadeOutPx, widthPx - 8) }}
            onPointerDown={dragFadeOut}
          />
        </>
      )}
      {!locked && <div className="clip-edge l" onPointerDown={dragLeft} />}
      {!locked && <div className="clip-edge r" onPointerDown={dragRight} />}
    </div>
  );
});

import { memo, useMemo } from 'react';
import { copySelection, cutSelection, duplicateSelection } from '../../app/clipboardActions';
import { shortcutLabel } from '../../app/shortcuts';
import { usePointerDrag, longPress } from '../../hooks/usePointerDrag';
import { Waveform } from './Waveform';
import { clamp, secondsPerBeat, snapBeat } from '../../model/music';
import type { Clip, Track } from '../../model/types';
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
  const bpm = useProjectStore((s) => s.project.bpm);
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

  const spb = secondsPerBeat(bpm);
  const widthPx = Math.max(6, clip.length * pxPerBeat);
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
          if (tool === 'erase') {
            store.getState().deleteClip(clip.id);
          } else if (tool === 'mute') {
            store.getState().setClip(clip.id, { muted: !clip.muted });
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
          durationSec={clip.sourceDuration ?? clip.length * secondsPerBeat(bpm)}
          color={color}
          gain={clip.gain}
          fadeIn={clip.fadeIn}
          fadeOut={clip.fadeOut}
        />
      ) : (
        <MidiPreview clip={clip} height={laneHeight - 6} />
      )}
      <span className="clip-name">
        {clip.muted ? '◇ ' : ''}
        {clip.name}
      </span>
      {clip.type === 'audio' && (
        <>
          <div
            className="fade-handle in"
            title="Drag to set the fade in"
            style={{ left: Math.min(fadeInPx, widthPx - 8) }}
            onPointerDown={dragFadeIn}
          />
          <div
            className="fade-handle out"
            title="Drag to set the fade out"
            style={{ right: Math.min(fadeOutPx, widthPx - 8) }}
            onPointerDown={dragFadeOut}
          />
        </>
      )}
      <div className="clip-edge l" onPointerDown={dragLeft} />
      <div className="clip-edge r" onPointerDown={dragRight} />
    </div>
  );
});

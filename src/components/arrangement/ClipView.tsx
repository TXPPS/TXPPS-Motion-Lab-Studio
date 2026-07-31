import { memo, useEffect, useMemo, useRef } from 'react';
import { getMediaPeaks } from '../../audio/demoAudio';
import { usePointerDrag, longPress } from '../../hooks/usePointerDrag';
import { snapBeat } from '../../model/music';
import type { Clip, Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';

function AudioWaveform({ mediaId, color }: { mediaId: string; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const peaks = getMediaPeaks(mediaId);
    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (w === 0 || h === 0) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      if (!peaks) return;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      const mid = h / 2;
      const n = peaks.max.length;
      for (let x = 0; x < w; x++) {
        const b = Math.floor((x / w) * n);
        const hi = peaks.max[b] * mid * 0.92;
        const lo = peaks.min[b] * mid * 0.92;
        ctx.fillRect(x, mid - hi, 1, Math.max(1, hi - lo));
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [mediaId, color]);
  return <canvas ref={ref} />;
}

function MidiPreview({ clip, height }: { clip: Extract<Clip, { type: 'midi' }>; height: number }) {
  const { notes } = clip;
  const rects = useMemo(() => {
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
  }, [notes, clip.length, height]);
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
  const selected = useUiStore((s) => s.selectedClipId === clip.id);
  const snap = useUiStore((s) => s.snap);
  const store = useProjectStore;
  const ui = useUiStore;

  const openMenu = (x: number, y: number) => {
    ui.getState().selectClip(clip.id, clip.trackId);
    ui.getState().showMenu({
      x,
      y,
      items: [
        ...(clip.type === 'midi'
          ? [
              {
                label: 'Open in Piano Roll',
                action: () => ui.getState().openEditorFor(clip.id, window.innerWidth < 700),
              },
            ]
          : []),
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
        { label: 'Duplicate', action: () => store.getState().duplicateClip(clip.id) },
        {
          label: clip.muted ? 'Unmute' : 'Mute',
          action: () => store.getState().setClip(clip.id, { muted: !clip.muted }),
        },
        {
          label: 'Delete',
          danger: true,
          action: () => store.getState().deleteClip(clip.id),
        },
      ],
    });
  };

  const dragMove = usePointerDrag<{ id: string; start: number }>({
    onStart: (e) => {
      let id = clip.id;
      if (e.altKey) {
        const dup = store.getState().duplicateClip(clip.id, true);
        if (dup) id = dup;
      }
      ui.getState().selectClip(id, clip.trackId);
      store.getState().beginGesture();
      return { id, start: clip.start };
    },
    onMove: (dx, _dy, e, d) => {
      const beats = snapBeat(d.start + dx / pxPerBeat, snap);
      const targetTrack = laneAt(e.clientY);
      store.getState().moveClip(d.id, Math.max(0, beats), targetTrack?.id);
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
      store.getState().resizeClip(clip.id, clip.start, len);
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
      store.getState().resizeClip(clip.id, start, d.end - start);
    },
    onEnd: () => store.getState().endGesture(),
  });

  const color = track.color;
  return (
    <div
      className={`clip${selected ? ' selected' : ''}${clip.muted ? ' muted' : ''}`}
      style={{
        left: clip.start * pxPerBeat,
        width: Math.max(6, clip.length * pxPerBeat),
        ['--clip-bg' as string]: `color-mix(in srgb, ${color} 30%, #10151b)`,
      }}
      data-testid={`clip-${clip.name}`}
      onPointerDown={(e) => {
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
        <AudioWaveform mediaId={clip.mediaId} color={color} />
      ) : (
        <MidiPreview clip={clip} height={laneHeight - 6} />
      )}
      <span className="clip-name">
        {clip.muted ? '◇ ' : ''}
        {clip.name}
      </span>
      <div className="clip-edge l" onPointerDown={dragLeft} />
      <div className="clip-edge r" onPointerDown={dragRight} />
    </div>
  );
});

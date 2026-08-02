/**
 * Take lanes: one row per take beneath the track, shown while a take clip has
 * its lanes open. Click a lane to audition that take alone; swipe across it
 * to comp that range in. All comping is segment data — nothing destructive.
 */
import { memo } from 'react';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { clamp, secondsPerBeat, snapBeat } from '../../model/music';
import { compSpans } from '../../model/comping';
import type { AudioClip, Take, Track } from '../../model/types';
import { TRACK_COLORS } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Waveform } from './Waveform';

export const TAKE_LANE_H = 36;

export function takeColor(index: number): string {
  return TRACK_COLORS[index % TRACK_COLORS.length];
}

interface RowProps {
  clip: AudioClip;
  take: Take;
  index: number;
  pxPerBeat: number;
  snap: number;
  bpm: number;
}

export const TakeLaneRow = memo(function TakeLaneRow({
  clip,
  take,
  index,
  pxPerBeat,
  snap,
  bpm,
}: RowProps) {
  const store = useProjectStore;
  const spb = secondsPerBeat(bpm);
  const widthPx = Math.max(6, clip.length * pxPerBeat);
  const spans = compSpans({ ...clip, soloTakeId: undefined }).filter(
    (s) => s.take.id === take.id,
  );
  const soloed = clip.soloTakeId === take.id;

  const dragSwipe = usePointerDrag<{ anchorBeat: number }>({
    onStart: (e) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const beat = clamp((e.clientX - rect.left) / pxPerBeat, 0, clip.length);
      store.getState().beginGesture();
      return { anchorBeat: snap > 0 ? snapBeat(beat, snap) : beat };
    },
    onMove: (_dx, _dy, e, d) => {
      const row = document.querySelector(
        `[data-testid="take-row-${clip.id}-${take.id}"]`,
      ) as HTMLElement | null;
      const rect = row?.getBoundingClientRect();
      if (!rect) return;
      let beat = clamp((e.clientX - rect.left) / pxPerBeat, 0, clip.length);
      if (snap > 0 && !e.altKey) beat = snapBeat(beat, snap);
      store.getState().setCompRange(clip.id, d.anchorBeat, beat, take.id);
    },
    onEnd: (moved) => {
      store.getState().endGesture();
      if (!moved) {
        // A plain click auditions the take by itself; clicking again returns
        // to the comp.
        const cur = store.getState().project.clips.find((c) => c.id === clip.id);
        const solo = cur?.type === 'audio' ? cur.soloTakeId : undefined;
        store.getState().setSoloTake(clip.id, solo === take.id ? null : take.id);
      }
    },
  });

  return (
    <div className="take-lane" style={{ height: TAKE_LANE_H }}>
      <div
        className={`take-body${take.muted ? ' muted' : ''}${soloed ? ' soloed' : ''}`}
        data-testid={`take-row-${clip.id}-${take.id}`}
        style={{
          left: clip.start * pxPerBeat,
          width: widthPx,
          ['--take-color' as string]: takeColor(index),
        }}
        title={`${take.name} — click to audition, swipe to comp`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          dragSwipe(e);
        }}
      >
        <Waveform
          mediaId={take.mediaId}
          offsetSec={Math.max(0, take.offset)}
          durationSec={clip.length * spb - Math.max(0, -take.offset)}
          color={takeColor(index)}
          gain={1}
          fadeIn={0}
          fadeOut={0}
          widthPx={widthPx}
          heightPx={TAKE_LANE_H}
        />
        {spans.map((s, i) => (
          <div
            key={i}
            className="take-used"
            data-testid="take-used"
            style={{
              left: `${(s.fromBeat / clip.length) * 100}%`,
              width: `${((s.toBeat - s.fromBeat) / clip.length) * 100}%`,
            }}
          />
        ))}
      </div>
    </div>
  );
});

export const TakeLaneHeader = memo(function TakeLaneHeader({
  clip,
  take,
  index,
  track,
}: {
  clip: AudioClip;
  take: Take;
  index: number;
  track: Track;
}) {
  const store = useProjectStore;
  const ui = useUiStore;
  const soloed = clip.soloTakeId === take.id;
  return (
    <div
      className={`tkh${take.muted ? ' muted' : ''}`}
      style={{ height: TAKE_LANE_H, ['--take-color' as string]: takeColor(index) }}
      data-testid={`take-head-${track.name}-${index}`}
    >
      <span className="alh-dot" />
      <span className="alh-name" title={take.name}>
        {take.name}
      </span>
      <button
        className={`th-mini${take.muted ? ' m-on' : ''}`}
        title="Mute this take (skipped by audition)"
        aria-pressed={!!take.muted}
        onClick={() => store.getState().setTakeMuted(clip.id, take.id, !take.muted)}
      >
        M
      </button>
      <button
        className={`th-mini${soloed ? ' s-on' : ''}`}
        title="Audition this take alone"
        aria-pressed={soloed}
        onClick={() => store.getState().setSoloTake(clip.id, soloed ? null : take.id)}
      >
        S
      </button>
      <button
        className="th-mini"
        title="Promote: the whole clip plays this take"
        data-testid={`take-promote-${track.name}-${index}`}
        onClick={() => {
          store.getState().promoteTake(clip.id, take.id);
          ui.getState().toast('info', `Promoted "${take.name}"`);
        }}
      >
        ▲
      </button>
      <button
        className="th-mini"
        title="Move take up"
        onClick={() => store.getState().moveTake(clip.id, take.id, -1)}
      >
        ↑
      </button>
      <button
        className="th-mini"
        title="Delete take (safe: comp falls back)"
        onClick={() =>
          ui.getState().showDialog({
            kind: 'confirm',
            title: `Delete take "${take.name}"?`,
            message:
              clip.takes && clip.takes.length === 1
                ? 'This is the last take — the clip becomes a plain clip of this material.'
                : 'Comp segments using it fall back to the remaining takes.',
            confirmLabel: 'Delete',
            danger: true,
            onSubmit: () => store.getState().deleteTake(clip.id, take.id),
          })
        }
      >
        ×
      </button>
    </div>
  );
});

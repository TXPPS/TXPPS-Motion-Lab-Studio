import { useCallback, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import { clamp, midiToName } from '../../model/music';
import type { Track } from '../../model/types';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';

const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_AFTER: Record<number, number> = { 0: 1, 1: 3, 3: 6, 4: 8, 5: 10 };

export function Keyboard({ track, octaves = 2 }: { track: Track; octaves?: number }) {
  const octave = useUiStore((s) => s.keyboardOctave);
  const [pressed, setPressed] = useState<Set<number>>(new Set());
  const pointerPitch = useRef(new Map<number, number>());
  const base = (octave + 1) * 12; // C of the current octave

  const press = useCallback(
    (pitch: number, pointerId: number) => {
      const prev = pointerPitch.current.get(pointerId);
      if (prev === pitch) return;
      if (prev !== undefined) engine.liveNoteOff(track.id, prev);
      pointerPitch.current.set(pointerId, pitch);
      engine.liveNoteOn(track.id, pitch, 100);
      setPressed((s) => new Set(s).add(pitch));
    },
    [track.id],
  );
  const release = useCallback(
    (pointerId: number) => {
      const pitch = pointerPitch.current.get(pointerId);
      if (pitch === undefined) return;
      pointerPitch.current.delete(pointerId);
      engine.liveNoteOff(track.id, pitch);
      setPressed((s) => {
        const n = new Set(s);
        n.delete(pitch);
        return n;
      });
    },
    [track.id],
  );

  const whites: { pitch: number; label: string }[] = [];
  for (let o = 0; o < octaves; o++) {
    for (const off of WHITE_OFFSETS) {
      const pitch = base + o * 12 + off;
      whites.push({ pitch, label: off === 0 ? midiToName(pitch) : '' });
    }
  }

  const keyHandlers = (pitch: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      // Release any implicit capture so gliding fires pointerenter on other keys.
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* no capture to release */
      }
      press(pitch, e.pointerId);
    },
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.buttons > 0 || e.pointerType === 'touch') press(pitch, e.pointerId);
    },
    onPointerUp: (e: React.PointerEvent) => release(e.pointerId),
    onPointerCancel: (e: React.PointerEvent) => release(e.pointerId),
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') release(e.pointerId);
    },
  });

  const whiteW = 100 / whites.length;
  return (
    <div className="kbd" data-testid="keyboard">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 6 }}>
        <button
          className="icon-btn"
          onClick={() => useUiStore.getState().set({ keyboardOctave: clamp(octave + 1, 1, 7) })}
          title="Octave up (X)"
          aria-label="Octave up"
        >
          <Icon name="chevron-up" size={14} />
        </button>
        <div className="hint" style={{ textAlign: 'center' }}>
          C{octave}
        </div>
        <button
          className="icon-btn"
          onClick={() => useUiStore.getState().set({ keyboardOctave: clamp(octave - 1, 1, 7) })}
          title="Octave down (Z)"
          aria-label="Octave down"
        >
          <Icon name="chevron-down" size={14} />
        </button>
      </div>
      {/* tabIndex -1 deliberately: sixty keys in the tab order would bury the
          rest of the panel, and A-L on the computer keyboard already plays
          them. Browse mode still finds each key by its note name. */}
      <div className="kbd-inner" role="group" aria-label={`Keyboard, octave ${octave}`}>
        {whites.map((w) => (
          <div
            key={w.pitch}
            className={`kbd-white${pressed.has(w.pitch) ? ' pressed' : ''}`}
            role="button"
            tabIndex={-1}
            aria-label={midiToName(w.pitch)}
            {...keyHandlers(w.pitch)}
            data-testid={`key-${w.pitch}`}
          >
            <span className="kn">{w.label}</span>
          </div>
        ))}
        {whites.map((w, i) => {
          const off = (((w.pitch - base) % 12) + 12) % 12;
          const withinOct = WHITE_OFFSETS.indexOf(off);
          const blackOff = BLACK_AFTER[withinOct];
          if (blackOff === undefined) return null;
          const pitch = w.pitch - off + blackOff;
          if (pitch > base + octaves * 12) return null;
          return (
            <div
              key={`b${pitch}-${i}`}
              className={`kbd-black${pressed.has(pitch) ? ' pressed' : ''}`}
              style={{ left: `${(i + 1) * whiteW - whiteW * 0.32}%`, width: `${whiteW * 0.64}%` }}
              role="button"
              tabIndex={-1}
              aria-label={midiToName(pitch)}
              {...keyHandlers(pitch)}
              data-testid={`key-${pitch}`}
            />
          );
        })}
      </div>
    </div>
  );
}

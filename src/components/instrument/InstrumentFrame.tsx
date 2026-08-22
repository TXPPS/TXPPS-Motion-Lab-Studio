/**
 * The frame every instrument wears.
 *
 * The reference's point about its stock devices is that the *header* never
 * moves: whatever the body looks like, the same verbs sit in the same places —
 * what this is, what it is on, its preset, an A/B compare, whether it is
 * passing signal, and what is coming out of it. The body is where a synth and
 * a drum rack are allowed to be different instruments.
 *
 * It deliberately wears the plugin window's own classes rather than a parallel
 * set of its own. `PluginWindow` owns that frame for effects and this file must
 * not duplicate it; borrowing the classes means the two headers cannot drift,
 * because there is still exactly one description of them. The frame itself
 * — the floating, dragging, closing part — stays the window's, because an
 * instrument is docked in a panel and has nothing to float over.
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { PeakReadout } from '../common/widgets';

/**
 * The A/B slots.
 *
 * Held outside the project on purpose, exactly as the plugin window holds its
 * own: an A/B is a working comparison rather than a decision, and it should
 * not dirty the song. `restore` runs inside one gesture so taking the other
 * slot is a single step of undo instead of one per parameter.
 */
export interface InstrumentCompare<T> {
  take: () => T;
  put: (value: T) => void;
}

export function InstrumentFrame<T>({
  name,
  track,
  controls,
  compare,
  summary,
  testId,
  className,
  performance,
  children,
}: {
  /** The device's own name — MOTIONSYNTH, TX SAMPLER, DRUM RACK. */
  name: string;
  track: Track;
  /** Header controls this instrument owns: its kind switch, its presets. */
  controls?: ReactNode;
  compare?: InstrumentCompare<T>;
  /** One line describing the current patch, in the footer. */
  summary: string;
  testId: string;
  className?: string;
  /**
   * The playing surface — keyboard, pads. Pinned below the scrolling body
   * because an instrument you have to scroll to play is not an instrument.
   */
  performance?: ReactNode;
  children: ReactNode;
}) {
  const [ab, setAb] = useState<{ slot: 'a' | 'b'; a: T | null; b: T | null }>({
    slot: 'a',
    a: null,
    b: null,
  });
  const store = useProjectStore;

  return (
    <div
      className={`syn ins-frame${className ? ` ${className}` : ''}`}
      // The header rail is the track's colour rather than a processor family's:
      // an instrument is the channel's source, so its identity IS the channel.
      style={{ ['--strip-color' as string]: track.color, ['--dev-family' as string]: track.color }}
      data-testid={testId}
    >
      <header className="pw-head ins-head">
        {/* Lit means signal is passing, which for the source of a channel is
            the channel not being muted — the one thing that silences it.
            Named for what it is rather than for what pressing it does: a
            button labelled "Mute" that reports itself pressed while the track
            is *not* muted is a state a screen reader cannot recover. */}
        <button
          className="pw-power"
          aria-pressed={!track.mute}
          aria-label={`${track.name} output`}
          title={track.mute ? 'Muted — click to pass' : 'Passing — click to mute'}
          onClick={() => store.getState().setTrack(track.id, { mute: !track.mute })}
        />
        <div className="pw-title">
          <span className="pw-name">{name}</span>
          <span className="pw-on" title={track.name}>
            {track.name}
          </span>
        </div>
        <span className="grow" />
        {controls}
        {compare && (
          <div className="pw-ab" role="group" aria-label="A/B compare">
            {(['a', 'b'] as const).map((slot) => (
              <button
                key={slot}
                className={ab.slot === slot ? 'on' : ''}
                aria-pressed={ab.slot === slot}
                aria-label={`Compare slot ${slot.toUpperCase()}`}
                title={`Slot ${slot.toUpperCase()} — the other slot keeps what you had`}
                data-testid={`ins-ab-${slot}`}
                onClick={() => {
                  if (ab.slot === slot) return;
                  // Park what is on screen in the slot being left, then take
                  // whatever the slot being entered was holding.
                  const parked = compare.take();
                  const incoming = ab[slot];
                  setAb((prev) => ({ ...prev, slot, [prev.slot]: parked }));
                  if (incoming !== null) {
                    store.getState().beginGesture();
                    compare.put(incoming);
                    store.getState().endGesture();
                  }
                }}
              >
                {slot.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="syn-scroll ins-body">{children}</div>
      {performance}

      <footer className="pw-foot ins-foot">
        <span className="pw-summary" title={summary}>
          {summary}
        </span>
        <span className="grow" />
        <span className="t-label">Out</span>
        <PeakReadout meterId={track.id} />
      </footer>
    </div>
  );
}

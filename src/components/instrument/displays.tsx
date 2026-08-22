/**
 * The pictures an instrument face is made of.
 *
 * Every one of them is drawn from `model/synthFace.ts`, which answers for what
 * the voice engine actually builds — so a curve here cannot show a filter the
 * audio does not have, an envelope shape the gain node will not play, or a
 * modulator connected to nothing. Nothing in this file computes any audio
 * behaviour of its own; it turns those answers into paths.
 *
 * The plots are stretched horizontally (`preserveAspectRatio="none"`) so a
 * display fills whatever width the panel has on a phone, a tablet or a
 * maximised desktop editor, with `vector-effect` keeping every stroke one
 * pixel wide through the stretch. Text is never inside the SVG for the same
 * reason — labels are HTML, which also gives them to a screen reader.
 */
import { useMemo } from 'react';
import { logFrequencies } from '../../audio/dsp/curves';
import { formatHz } from '../../model/effects';
import { clamp } from '../../model/music';
import {
  ampEnvelopePoints,
  ampEnvelopeSpan,
  filterResponseDb,
  formatSeconds,
  oscillatorSample,
  synthOscillatorPoints,
  synthOscillatorSample,
  suggestedHoldSec,
  SYNTH_SUB_WAVE,
  type AmpEnvelope,
  type SynthOscillator,
  type SynthSub,
  type VoiceFilter,
} from '../../model/synthFace';
import { usePointerDrag } from '../../hooks/usePointerDrag';

/** Plot geometry. The width is nominal — the display stretches to its box. */
const W = 320;
const H = 96;

/** The response window, and the decibels it spans. */
const MIN_HZ = 20;
const MAX_HZ = 20000;
const TOP_DB = 24;
const BOTTOM_DB = -48;

const xOfHz = (hz: number): number =>
  (Math.log(clamp(hz, MIN_HZ, MAX_HZ) / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ)) * W;
const hzOfX = (x: number): number => MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, clamp(x / W, 0, 1));
const yOfDb = (db: number): number =>
  ((TOP_DB - clamp(db, BOTTOM_DB - 12, TOP_DB)) / (TOP_DB - BOTTOM_DB)) * H;

const path = (points: readonly { x: number; y: number }[]): string =>
  points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');

// ------------------------------------------------------------ oscillator

/** How many cycles of the oscillator the scope shows. */
const SCOPE_CYCLES = 2;
const SCOPE_POINTS = 320;

/** A polyline through samples of a wave, mapped into the scope's box. */
function scopePath(samples: readonly number[], scale: number): string {
  return path(
    samples.map((v, i) => ({
      x: (i / (samples.length - 1)) * W,
      y: H / 2 - v * scale * (H / 2 - 6),
    })),
  );
}

/**
 * The wave the voice sums, over two cycles.
 *
 * Everything drawn here is a trace of the same evaluation `Voice` builds its
 * oscillator section from: the main wave with its delayed copy subtracted, the
 * sub an octave under it at its own level, and — where the LFO reaches the
 * width — the two duties it sweeps between, drawn faintly the way the filter
 * curve draws key tracking. A pulse the modulator is opening and closing is the
 * hardest thing on this panel to describe in a number, and the two extremes are
 * exactly what a musician needs to see.
 */
export function OscScope({
  osc,
  label,
  sub,
  widthSweep,
  testId,
}: {
  osc: SynthOscillator;
  label: string;
  sub?: SynthSub | null;
  /** The duty range the LFO sweeps the pulse through, or null where it does not. */
  widthSweep?: { lowDuty: number; highDuty: number } | null;
  testId?: string;
}) {
  const { main, ghosts, subPath } = useMemo(() => {
    const samples = synthOscillatorPoints(osc, SCOPE_POINTS, SCOPE_CYCLES);
    const atDuty = (duty: number) =>
      Array.from({ length: SCOPE_POINTS }, (_, i) =>
        synthOscillatorSample(
          { type: osc.type, morph: { shape: osc.morph!.shape, width: duty, delayCycles: 1 - duty } },
          (i / (SCOPE_POINTS - 1)) * SCOPE_CYCLES,
        ),
      );
    const swept =
      osc.morph && widthSweep
        ? [widthSweep.lowDuty, widthSweep.highDuty].map((duty) => ({
            duty,
            samples: atDuty(duty),
          }))
        : [];
    const subSamples = sub
      ? Array.from({ length: SCOPE_POINTS }, (_, i) =>
          // Half the phase rate: one cycle of the sub spans two of the wave
          // above it, which is what an octave down looks like.
          oscillatorSample(SYNTH_SUB_WAVE, ((i / (SCOPE_POINTS - 1)) * SCOPE_CYCLES) / 2),
        ).map((v) => v * sub.gain)
      : null;

    // Subtracting a delayed copy leaves a zero-mean pulse whose peak grows as
    // the duty leaves the middle — a real property of the wave, not a drawing
    // artefact. One scale across every trace therefore keeps the ends of a
    // width sweep in proportion to the pulse they are sweeping, and shrinking
    // only (never magnifying) leaves a plain saw or square drawn at exactly
    // the size it always was.
    const peak = [samples, ...swept.map((g) => g.samples), subSamples ?? []]
      .flat()
      .reduce((m, v) => Math.max(m, Math.abs(v)), 1);
    const scale = 1 / peak;
    return {
      main: scopePath(samples, scale),
      ghosts: swept.map((g) => ({ duty: g.duty, d: scopePath(g.samples, scale) })),
      subPath: subSamples ? scopePath(subSamples, scale) : null,
    };
  }, [osc, sub, widthSweep]);

  return (
    <div className="ins-plot ins-plot-sm" data-testid={testId}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <line
          x1={0}
          y1={H / 2}
          x2={W}
          y2={H / 2}
          stroke="var(--grid-beat)"
          vectorEffect="non-scaling-stroke"
        />
        {ghosts.map((g) => (
          <path
            key={g.duty}
            d={g.d}
            fill="none"
            stroke="var(--fx-eq)"
            strokeWidth={1}
            opacity={0.3}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {subPath && (
          <path
            d={subPath}
            fill="none"
            stroke="var(--fx-eq)"
            strokeWidth={1.3}
            strokeDasharray="3 3"
            opacity={0.55}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path
          d={main}
          fill="none"
          stroke="var(--fx-eq)"
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------- filter

export interface FilterAxis {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

/**
 * A filter's magnitude response, with the corner as a handle on the curve.
 *
 * The handle sits at the response's own value at the cutoff, not at a computed
 * guess: drag it sideways for frequency, up and down for resonance. The arrow
 * keys do the same thing — a semitone of cutoff, half a decibel of resonance,
 * ten times finer with Shift — because a handle that only answers to a pointer
 * is not a control, it is a picture with a mouse trap in it.
 */
export function FilterCurve({
  filter,
  label,
  ghosts,
  sweep,
  cutoff,
  resonance,
  onGestureStart,
  onGestureEnd,
  testId,
}: {
  filter: VoiceFilter;
  label: string;
  /** The same filter at other keys, drawn faintly: what key tracking does. */
  ghosts?: { filter: VoiceFilter; label: string }[];
  /** The band a modulator sweeps the corner through. */
  sweep?: { lowHz: number; highHz: number } | null;
  cutoff?: FilterAxis;
  resonance?: FilterAxis;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  testId?: string;
}) {
  const freqs = useMemo(() => logFrequencies(160, MIN_HZ, MAX_HZ), []);
  // Keyed on the filter's three numbers rather than on the object, which the
  // panel rebuilds every render — a memo on the object would never hit.
  const { type, freqHz, qDb } = filter;
  const curve = useMemo(
    () =>
      path(
        filterResponseDb({ type, freqHz, qDb }, freqs).map((db, i) => ({
          x: xOfHz(freqs[i]),
          y: yOfDb(db),
        })),
      ),
    [type, freqHz, qDb, freqs],
  );
  const ghostPaths = (ghosts ?? []).map((g) => ({
    label: g.label,
    d: path(
      filterResponseDb(g.filter, freqs).map((db, i) => ({ x: xOfHz(freqs[i]), y: yOfDb(db) })),
    ),
  }));

  const cornerDb = filterResponseDb(filter, [filter.freqHz])[0];
  const handleX = (xOfHz(filter.freqHz) / W) * 100;
  const handleY = (yOfDb(cornerDb) / H) * 100;

  const drag = usePointerDrag<{ hz: number; q: number; width: number; height: number }>({
    onStart: (e) => {
      onGestureStart?.();
      const host = (e.currentTarget as HTMLElement).parentElement;
      return {
        hz: filter.freqHz,
        q: filter.qDb,
        width: host?.clientWidth || W,
        height: host?.clientHeight || H,
      };
    },
    onMove: (dx, dy, _e, start) => {
      if (cutoff) {
        const at = (xOfHz(start.hz) / W) * start.width + dx;
        cutoff.onChange(clamp(hzOfX((at / start.width) * W), cutoff.min, cutoff.max));
      }
      if (resonance) {
        const perPx = (resonance.max - resonance.min) / Math.max(40, start.height);
        resonance.onChange(clamp(start.q - dy * perPx, resonance.min, resonance.max));
      }
    },
    onEnd: () => onGestureEnd?.(),
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    let handled = true;
    if (cutoff && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      // Semitones, because a cutoff is a pitch and that is how it is heard.
      const steps = (e.key === 'ArrowRight' ? 1 : -1) / (e.shiftKey ? 48 : 12);
      cutoff.onChange(clamp(cutoff.value * Math.pow(2, steps), cutoff.min, cutoff.max));
    } else if (resonance && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const step = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 0.1 : 0.5);
      resonance.onChange(clamp(resonance.value + step, resonance.min, resonance.max));
    } else handled = false;
    if (!handled) return;
    e.preventDefault();
    onGestureStart?.();
    onGestureEnd?.();
  };

  const readout = `${filter.type === 'highpass' ? 'High-pass' : 'Low-pass'} at ${formatHz(
    filter.freqHz,
  )}, resonance ${filter.qDb.toFixed(1)} dB`;

  return (
    <div className="ins-plot ins-plot-filter" data-testid={testId}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: ${readout}`}
      >
        {sweep && (
          <rect
            x={xOfHz(sweep.lowHz)}
            y={0}
            width={Math.max(1, xOfHz(sweep.highHz) - xOfHz(sweep.lowHz))}
            height={H}
            fill="var(--fx-eq)"
            opacity={0.12}
          />
        )}
        {[100, 1000, 10000].map((hz) => (
          <line
            key={hz}
            x1={xOfHz(hz)}
            y1={0}
            x2={xOfHz(hz)}
            y2={H}
            stroke="var(--grid-beat)"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {[12, 0, -12, -24, -36].map((db) => (
          <line
            key={db}
            x1={0}
            y1={yOfDb(db)}
            x2={W}
            y2={yOfDb(db)}
            stroke={db === 0 ? 'var(--grid-bar)' : 'var(--grid-sub)'}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {ghostPaths.map((g) => (
          <path
            key={g.label}
            d={g.d}
            fill="none"
            stroke="var(--fx-eq)"
            strokeWidth={1}
            opacity={0.3}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={`${curve} L ${W} ${H} L 0 ${H} Z`} fill="var(--fx-eq)" opacity={0.1} />
        <path
          d={curve}
          fill="none"
          stroke="var(--fx-eq)"
          strokeWidth={1.7}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {(cutoff || resonance) && (
        <button
          type="button"
          className="ins-handle"
          style={{ left: `${handleX}%`, top: `${handleY}%` }}
          data-testid={testId ? `${testId}-handle` : undefined}
          aria-label={`${label} corner. ${readout}. Arrow keys move it.`}
          title="Drag for cutoff and resonance · arrow keys, Shift for fine"
          onPointerDown={drag}
          onKeyDown={onKeyDown}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------- envelope

/**
 * The amplitude envelope, in real seconds.
 *
 * The decay and the release are exponential approaches with a third of the
 * musician's time as their constant, which is why this is plotted point by
 * point from the same evaluation the gain node will play rather than drawn as
 * the four straight lines an ADSR is usually pictured as. The note-off mark
 * and the tail past it are where the difference is audible.
 */
export function EnvelopeGraph({
  env,
  label,
  testId,
}: {
  env: AmpEnvelope;
  label: string;
  testId?: string;
}) {
  const hold = suggestedHoldSec(env);
  const span = ampEnvelopeSpan(env, hold);
  const d = useMemo(() => {
    const points = ampEnvelopePoints(env, hold, 200);
    return path(
      points.map((p) => ({
        x: (p.t / span) * W,
        y: H - 3 - (p.gain / Math.max(env.peak, 1e-9)) * (H - 6),
      })),
    );
  }, [env, hold, span]);

  const xOfT = (t: number) => (t / span) * W;
  const sustainY = H - 3 - env.sustain * (H - 6);

  return (
    <div className="ins-plot ins-plot-env" data-testid={testId}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: attack ${formatSeconds(env.attackSec)}, decay ${formatSeconds(
          env.decayTau * 3,
        )}, sustain ${Math.round(env.sustain * 100)}%, release ${formatSeconds(env.releaseTau * 3)}`}
      >
        <line
          x1={0}
          y1={sustainY}
          x2={W}
          y2={sustainY}
          stroke="var(--grid-beat)"
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
        {/* Where the decay has arrived, and where the key comes up. */}
        {[env.attackSec, env.attackSec + env.decayTau * 3].map((t, i) => (
          <line
            key={i}
            x1={xOfT(t)}
            y1={0}
            x2={xOfT(t)}
            y2={H}
            stroke="var(--grid-sub)"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={`${d} L ${W} ${H} L 0 ${H} Z`} fill="var(--fx-eq)" opacity={0.1} />
        <path
          d={d}
          fill="none"
          stroke="var(--fx-eq)"
          strokeWidth={1.7}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={xOfT(hold)}
          y1={0}
          x2={xOfT(hold)}
          y2={H}
          stroke="var(--text-dim)"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="ins-plot-axis">
        <span className="t-label">Note off {formatSeconds(hold)}</span>
        <span className="grow" />
        <span className="t-label">Voice ends {formatSeconds(span)}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- LFO

/**
 * One second of the modulator, at its rate and at its share of full depth.
 *
 * Takes any modulator that reports a rate and a depth, because both
 * instruments now build one and there is one picture of it.
 */
export function LfoScope({
  lfo,
  label,
  testId,
}: {
  lfo: { rateHz: number; depth: number };
  label: string;
  testId?: string;
}) {
  const d = useMemo(() => {
    const n = 400;
    const amplitude = clamp(lfo.depth, 0, 1) * (H / 2 - 5);
    const points = Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      return { x: t * W, y: H / 2 - Math.sin(2 * Math.PI * lfo.rateHz * t) * amplitude };
    });
    return path(points);
  }, [lfo]);

  return (
    <div className="ins-plot ins-plot-sm" data-testid={testId}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <line
          x1={0}
          y1={H / 2}
          x2={W}
          y2={H / 2}
          stroke="var(--grid-beat)"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={d}
          fill="none"
          stroke="var(--fx-eq)"
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

/** A labelled block inside an instrument body: the sections a face has. */
export function InstrumentSection({
  title,
  aside,
  wide,
  full,
  testId,
  children,
}: {
  title: string;
  aside?: string;
  /** Sections built around a display take two columns where there is room. */
  wide?: boolean;
  /** A performance surface takes the whole row: it is the face, not a column. */
  full?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`ins-section${wide ? ' wide' : ''}${full ? ' full' : ''}`}
      data-testid={testId}
    >
      <div className="ins-section-head">
        <span className="t-label">{title}</span>
        {aside && <span className="ins-aside t-num">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------ pad waveform

/** How many columns a pad's envelope is drawn with — enough to read a shape. */
const PAD_WAVE_COLUMNS = 56;

/**
 * The hit a pad plays, drawn on the pad.
 *
 * A drum pad without its sound on it is a labelled button, and the reference's
 * point about a pad grid is that it is the *sample* map: you should be able to
 * tell the closed hat from the open one without reading either name. The
 * envelope is the media library's own, so it is the same picture the
 * arrangement draws for the same audio.
 *
 * Returns nothing at all when the envelope has not resolved: a flat line would
 * claim the sample is silent, which is a worse answer than no answer.
 */
export function PadWave({ peaks }: { peaks: { min: Float32Array; max: Float32Array } | null }) {
  const d = useMemo(() => {
    if (!peaks || peaks.max.length === 0) return null;
    const n = peaks.max.length;
    const per = Math.max(1, Math.floor(n / PAD_WAVE_COLUMNS));
    const cols = Math.min(PAD_WAVE_COLUMNS, Math.ceil(n / per));
    const top: { x: number; y: number }[] = [];
    const bottom: { x: number; y: number }[] = [];
    let loudest = 0;
    for (let c = 0; c < cols; c++) {
      let lo = 0;
      let hi = 0;
      for (let i = c * per; i < Math.min(n, (c + 1) * per); i++) {
        if (peaks.min[i] < lo) lo = peaks.min[i];
        if (peaks.max[i] > hi) hi = peaks.max[i];
      }
      loudest = Math.max(loudest, hi, -lo);
      const x = (c / Math.max(1, cols - 1)) * W;
      top.push({ x, y: hi });
      bottom.push({ x, y: lo });
    }
    if (loudest <= 0) return null;
    // Normalised, because a pad is read against the other pads: a hat drawn at
    // its true level next to a kick is a flat line.
    const scale = (H / 2 / loudest) * 0.92;
    const toY = (v: number) => H / 2 - v * scale;
    return `${path(top.map((p) => ({ x: p.x, y: toY(p.y) })))} ${bottom
      .reverse()
      .map((p) => `L ${p.x.toFixed(2)} ${toY(p.y).toFixed(2)}`)
      .join(' ')} Z`;
  }, [peaks]);

  if (!d) return null;
  return (
    <svg className="pad-wave" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <path d={d} />
    </svg>
  );
}

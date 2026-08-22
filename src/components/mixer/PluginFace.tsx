/**
 * Plugin faces.
 *
 * An effect rendered as a list of horizontal sliders is a settings form, not an
 * instrument. A face shows the thing the effect *does* — the EQ's curve, the
 * compressor's transfer function and its live gain reduction, the modulator's
 * shape — beside controls shaped like the ones on the hardware these model.
 *
 * The layout is driven by the same declarative spec that already defines each
 * effect's parameters (`src/model/effects.ts`), so a new effect gets a real
 * face for free and only needs a bespoke visualisation if it earns one.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  complexMagnitudeDb,
  crossoverResponse,
  dbToGain,
  eqMagnitudeResponse,
  logFrequencies,
  type Complex,
  type CrossoverResponse,
  type EqBandSpec,
} from '../../audio/dsp/curves';
import { engine } from '../../audio/engine';
import { useProjectStore } from '../../state/projectStore';
import {
  EQ8_BANDS,
  choiceOf,
  deesserBand,
  dynamicsGain,
  dynamicsLawOf,
  eq8Bands,
  formatHz,
  formatParam,
  multibandSplits,
  paramOf,
  type DynamicsLaw,
  type ParamSpec,
  shaperCurveOf,
  delayLayoutOf,
  reverbTailOf,
  widthFieldOf,
  type DelayLayout,
  type ReverbTail,
  type WidthField,
  tuneSettingsOf,
  matchTrimFor,
  modulationOf,
  type ModulationField,
  inputDbForReduction,
} from '../../model/effects';
import { clamp } from '../../model/music';
import {
  DEFAULT_MIN_CONFIDENCE,
  noteFromHz,
  PitchDetector,
  type PitchReading,
} from '../../model/pitch';
import { KEY_NAMES, scaleById, snapToScale } from '../../model/scales';
import type { Effect } from '../../model/types';
import { usePointerDrag } from '../../hooks/usePointerDrag';

const CURVE_W = 240;
const CURVE_H = 96;

// ------------------------------------------------------------------- knob

const norm = (spec: ParamSpec, v: number): number => {
  if (spec.curve === 'log' && spec.min > 0) {
    return Math.log(clamp(v, spec.min, spec.max) / spec.min) / Math.log(spec.max / spec.min);
  }
  return (clamp(v, spec.min, spec.max) - spec.min) / (spec.max - spec.min || 1);
};

const denorm = (spec: ParamSpec, n: number): number => {
  const t = clamp(n, 0, 1);
  const raw =
    spec.curve === 'log' && spec.min > 0
      ? spec.min * Math.pow(spec.max / spec.min, t)
      : spec.min + t * (spec.max - spec.min);
  const stepped = spec.step > 0 ? Math.round(raw / spec.step) * spec.step : raw;
  return clamp(stepped, spec.min, spec.max);
};

/**
 * Parameter knob.
 *
 * Vertical drag over 140px covers the full range; Shift is a ten-times finer
 * ride, and a double-click returns the parameter to its default — the three
 * gestures every hardware-shaped control in this product shares.
 */
export const FxKnob = memo(function FxKnob({
  spec,
  value,
  onChange,
  onGestureStart,
  onGestureEnd,
  size = 44,
}: {
  spec: ParamSpec;
  value: number;
  onChange: (v: number) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  size?: number;
}) {
  const n = norm(spec, value);
  const onPointerDown = usePointerDrag<number>({
    onStart: () => {
      onGestureStart?.();
      return n;
    },
    onMove: (_dx, dy, e, start) => onChange(denorm(spec, start - dy / (e.shiftKey ? 1400 : 140))),
    onEnd: () => onGestureEnd?.(),
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.005 : 0.04;
    let next: number | null = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = n + step;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = n - step;
    else if (e.key === 'Home') next = norm(spec, spec.default);
    if (next === null) return;
    e.preventDefault();
    onChange(denorm(spec, next));
  };

  const r = size / 2;
  const sweep = 270;
  const angle = -135 + n * sweep;
  const point = (a: number, radius: number) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return `${(r + Math.cos(rad) * radius).toFixed(2)} ${(r + Math.sin(rad) * radius).toFixed(2)}`;
  };
  const track = r - 3;
  // A bipolar parameter fills from the centre, which is how a pan or a gain
  // control reads on a desk; a unipolar one fills from its minimum.
  const bipolar = spec.min < 0 && Math.abs(spec.min + spec.max) < Math.abs(spec.max) * 0.35;
  const from = bipolar ? -135 + 0.5 * sweep : -135;
  const large = Math.abs(angle - from) > 180 ? 1 : 0;
  const sweepFlag = angle >= from ? 1 : 0;

  return (
    <div className="fx-knob">
      <div
        className="knob"
        style={{ width: size, height: size }}
        onPointerDown={onPointerDown}
        onDoubleClick={() => onChange(spec.default)}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="slider"
        aria-label={spec.label}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={Math.round(value * 1000) / 1000}
        aria-valuetext={formatParam(spec, value)}
        title={`${spec.label} — drag to change, Shift for fine, double-click for ${formatParam(
          spec,
          spec.default,
        )}`}
      >
        <svg width={size} height={size} aria-hidden>
          <path
            d={`M ${point(-135, track)} A ${track} ${track} 0 1 1 ${point(135, track)}`}
            fill="none"
            stroke="var(--bg-deep)"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <path
            d={`M ${point(from, track)} A ${track} ${track} 0 ${large} ${sweepFlag} ${point(
              angle,
              track,
            )}`}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <circle cx={r} cy={r} r={r - 8} fill="var(--bg-raised)" stroke="var(--border-strong)" />
          <line
            x1={point(angle, r - 15).split(' ')[0]}
            y1={point(angle, r - 15).split(' ')[1]}
            x2={point(angle, r - 9).split(' ')[0]}
            y2={point(angle, r - 9).split(' ')[1]}
            stroke="var(--text)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="fx-knob-val">{formatParam(spec, value)}</div>
      <div className="fx-knob-label">{spec.label}</div>
    </div>
  );
});

// -------------------------------------------------------------- EQ curve

const MIN_HZ = 20;
const MAX_HZ = 20000;
/**
 * Rate the response plots are computed at. Fixed rather than the device's, so
 * a curve does not change shape when a project is opened on other hardware;
 * every corner these plots show is far enough below Nyquist for it not to
 * matter which rate the audio is actually running at.
 */
const PLOT_RATE = 48000;
const xOfHz = (hz: number, width = CURVE_W) =>
  (Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ)) * width;
const hzOfX = (x: number) => MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, clamp(x / CURVE_W, 0, 1));
const yOfDb = (db: number, range: number) => CURVE_H / 2 - (db / range) * (CURVE_H / 2);

/**
 * EQ curve, drawn from the same coefficients the audio graph uses.
 *
 * Band handles are draggable: horizontally for frequency, vertically for gain,
 * with the wheel on a handle changing Q. Nothing here re-implements the filter
 * maths — it calls the shared response function, so the picture cannot drift
 * from the sound.
 */
interface CurveBand {
  spec: EqBandSpec;
  label: string;
  freqKey: string;
  gainKey?: string;
}

/**
 * The draggable bands of any EQ-shaped effect, in the one form the curve
 * display understands. Each kind names its own parameters, so the mapping
 * lives here rather than forcing every effect into one naming scheme.
 */
function curveBands(effect: Effect): CurveBand[] {
  if (effect.kind === 'eq8') {
    const specs = eq8Bands(effect);
    return EQ8_BANDS.map((def, i) => ({
      spec: specs[i],
      label: def.label,
      freqKey: `${def.prefix}Freq`,
      ...(def.hasGain ? { gainKey: `${def.prefix}Gain` } : {}),
    }));
  }
  if (effect.kind === 'eq3') {
    return [
      {
        label: 'Low',
        freqKey: 'lowFreq',
        gainKey: 'lowDb',
        spec: {
          type: 'lowshelf',
          freqHz: paramOf(effect, 'lowFreq'),
          q: 0.71,
          gainDb: paramOf(effect, 'lowDb'),
          enabled: true,
        },
      },
      {
        label: 'Mid',
        freqKey: 'midFreq',
        gainKey: 'midDb',
        spec: {
          type: 'peaking',
          freqHz: paramOf(effect, 'midFreq'),
          q: paramOf(effect, 'midQ'),
          gainDb: paramOf(effect, 'midDb'),
          enabled: true,
        },
      },
      {
        label: 'High',
        freqKey: 'highFreq',
        gainKey: 'highDb',
        spec: {
          type: 'highshelf',
          freqHz: paramOf(effect, 'highFreq'),
          q: 0.71,
          gainDb: paramOf(effect, 'highDb'),
          enabled: true,
        },
      },
    ];
  }
  // filter
  const mode = choiceOf(effect, 'mode');
  return [
    {
      label: 'Cutoff',
      freqKey: 'cutoff',
      spec: {
        type: mode === 2 ? 'highpass' : mode === 1 ? 'bandpass' : 'lowpass',
        freqHz: paramOf(effect, 'cutoff'),
        q: paramOf(effect, 'resonance'),
        gainDb: 0,
        enabled: true,
      },
    },
  ];
}

function EqFace({
  effect,
  onParam,
  onGestureStart,
  onGestureEnd,
}: {
  effect: Effect;
  onParam: (key: string, value: number) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}) {
  const bands = useMemo(() => curveBands(effect), [effect]);
  const range = 18;
  const freqs = useMemo(() => logFrequencies(160, MIN_HZ, MAX_HZ), []);
  const curve = useMemo(
    () =>
      eqMagnitudeResponse(
        bands.map((b) => b.spec),
        freqs,
        PLOT_RATE,
      ),
    [bands, freqs],
  );

  const path = freqs
    .map(
      (hz, i) =>
        `${i === 0 ? 'M' : 'L'} ${xOfHz(hz).toFixed(1)} ${yOfDb(curve[i], range).toFixed(1)}`,
    )
    .join(' ');

  const dragBand = usePointerDrag<{ i: number; hz: number; db: number }>({
    onStart: (e) => {
      const i = Number((e.currentTarget as HTMLElement).dataset.band);
      onGestureStart();
      return { i, hz: bands[i].spec.freqHz, db: bands[i].spec.gainDb };
    },
    onMove: (dx, dy, _e, s) => {
      const band = bands[s.i];
      onParam(band.freqKey, hzOfX(xOfHz(s.hz) + dx));
      if (band.gainKey) {
        onParam(band.gainKey, clamp(s.db - (dy / (CURVE_H / 2)) * range, -range, range));
      }
    },
    onEnd: () => onGestureEnd(),
  });

  return (
    <div className="fx-curve" style={{ width: CURVE_W, height: CURVE_H }}>
      <svg width={CURVE_W} height={CURVE_H} aria-label="EQ response curve">
        {[100, 1000, 10000].map((hz) => (
          <line
            key={hz}
            x1={xOfHz(hz)}
            y1={0}
            x2={xOfHz(hz)}
            y2={CURVE_H}
            stroke="var(--grid-beat)"
          />
        ))}
        {[-12, -6, 0, 6, 12].map((db) => (
          <line
            key={db}
            x1={0}
            y1={yOfDb(db, range)}
            x2={CURVE_W}
            y2={yOfDb(db, range)}
            stroke={db === 0 ? 'var(--grid-bar)' : 'var(--grid-sub)'}
          />
        ))}
        <path d={`${path} L ${CURVE_W} ${CURVE_H} L 0 ${CURVE_H} Z`} fill="var(--accent-bg)" />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.8" />
      </svg>
      {bands.map((b, i) => (
        <button
          key={b.freqKey}
          className={`eq-handle${b.spec.enabled ? '' : ' off'}`}
          data-band={i}
          style={{
            left: xOfHz(b.spec.freqHz),
            top: b.gainKey ? yOfDb(b.spec.gainDb, range) : CURVE_H / 2,
          }}
          onPointerDown={dragBand}
          title={`${b.label} — ${Math.round(b.spec.freqHz)} Hz${
            b.gainKey ? `, ${b.spec.gainDb.toFixed(1)} dB` : ''
          }`}
          aria-label={`${b.label} band handle`}
        >
          {b.label.slice(0, 2)}
        </button>
      ))}
    </div>
  );
}

// -------------------------------------------------------- dynamics curve

/** Extra height a band-limited face gives to the strip under its curve. */
const BAND_STRIP_H = 24;

/** The multiband's spectrum plot, sized so the whole face matches the EQ's. */
const SPLIT_W = 184;

/** Depth of the crossover plot, in dB below unity. */
const SPLIT_RANGE_DB = 24;

/** Live gain-reduction meter. Reads the running node; silent in a bounce. */
function GrMeter({
  trackId,
  effectId,
  title,
}: {
  trackId: string;
  effectId: string;
  title: string;
}) {
  const fillRef = useRef<HTMLDivElement>(null);
  const holdRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  /**
   * The worst reduction since the meter was reset.
   *
   * A moving bar tells you what is happening now; what a mix engineer sets a
   * threshold from is the loudest thing that went through, which is over
   * before the eye reaches the meter. Held until it is clicked, because a
   * peak that decays away is a peak you can miss twice.
   */
  const worst = useRef(0);

  useEffect(() => {
    worst.current = 0;
    return engine.onFrame(() => {
      const gr = engine.gainReductionOf(trackId, effectId);
      if (gr < worst.current) worst.current = gr;
      const n = clamp(-gr / 24, 0, 1);
      if (fillRef.current) fillRef.current.style.transform = `scaleY(${n})`;
      if (holdRef.current) {
        // Reduction grows downward from the top, so the hold line is measured
        // from the top too — the same direction the fill moves.
        holdRef.current.style.top = `${clamp(-worst.current / 24, 0, 1) * 100}%`;
        holdRef.current.style.opacity = worst.current <= -0.05 ? '1' : '0';
      }
      if (textRef.current) {
        textRef.current.textContent = `${gr <= -0.05 ? gr.toFixed(1) : '0.0'} dB`;
      }
    });
  }, [trackId, effectId]);

  return (
    <div className="fx-gr" title={title}>
      <button
        className="fx-gr-track"
        title="Worst reduction so far — click to reset"
        aria-label="Reset the gain-reduction peak hold"
        data-testid="fx-gr-reset"
        onClick={() => {
          worst.current = 0;
        }}
      >
        <div className="fx-gr-fill" ref={fillRef} />
        <div className="fx-gr-hold" ref={holdRef} />
      </button>
      <span className="fx-gr-val" ref={textRef}>
        0.0 dB
      </span>
      <span className="fx-gr-label">GR</span>
    </div>
  );
}

/**
 * Where the signal is sitting on the curve, right now.
 *
 * The gain-reduction meter says how much is being taken off; it does not say
 * *where*, and where is the question a transfer plot is drawn to answer — a
 * threshold set from a curve you cannot see the signal on is a threshold set
 * by ear with a picture next to it. The law is monotonic, so the level is
 * recoverable from the reduction by bisection: `inputDbForReduction` owns that,
 * and it is the same law the audio is filled from.
 *
 * Written straight into the DOM on the engine's frame, like every other live
 * readout here: a dot moving through React state would re-render the console
 * sixty times a second.
 */
function OperatingPoint({
  trackId,
  effectId,
  law,
  floorDb,
  spanDb,
  size,
}: {
  trackId: string;
  effectId: string;
  law: DynamicsLaw;
  floorDb: number;
  spanDb: number;
  size: number;
}) {
  const dotRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    return engine.onFrame(() => {
      const dot = dotRef.current;
      if (!dot) return;
      const gr = engine.gainReductionOf(trackId, effectId);
      const inDb = inputDbForReduction(law, gr, floorDb, floorDb + spanDb);
      if (inDb === null) {
        dot.style.opacity = '0';
        return;
      }
      const outDb = inDb + gr;
      dot.style.opacity = '1';
      dot.setAttribute('cx', (((inDb - floorDb) / spanDb) * size).toFixed(1));
      dot.setAttribute('cy', (size - ((outDb - floorDb) / spanDb) * size).toFixed(1));
    });
  }, [trackId, effectId, law, floorDb, spanDb, size]);

  return (
    <circle
      ref={dotRef}
      r={3.2}
      cx={-10}
      cy={-10}
      fill="var(--accent-lamp)"
      stroke="var(--bg-deep)"
      strokeWidth="1"
      style={{ opacity: 0 }}
    />
  );
}

/** What a processor calls the level its law turns at. */
function turnLabelOf(kind: string): string {
  return kind === 'limiter' ? 'Ceiling' : 'Threshold';
}

/** Decibels of input a transfer plot spans, bottom to top. */
const AXIS_SPAN_DB = 60;

/**
 * Where a transfer plot's input axis stops, in dB relative to full scale.
 *
 * A limiter does all of its work in the last decibel below zero and every
 * decibel above it, so on the 0…-60 dB axis the other processors use its whole
 * law is one pixel in the corner — a straight line again, for a different
 * reason. Its own drive control reaches +24 dB and the detector can now
 * measure that far, so that is the range worth drawing.
 */
function axisTopOf(kind: string): number {
  return kind === 'limiter' ? 24 : 0;
}

/**
 * Transfer curve for a dynamics processor, plus a live gain-reduction meter.
 *
 * The law is not read off the parameters here — it is asked for by name
 * (`dynamicsLawOf`), and the audio fills its shaper from that same answer, so
 * the knee drawn is the knee heard whichever processor this is. It used to be
 * read off `threshold`, `ratio` and `knee`, which is why the limiter — which
 * declares none of them — drew a straight line for a 20:1 brickwall.
 *
 * A band-limited processor gets a strip under the curve showing where in the
 * spectrum it works, drawn from the same filter the audio puts there: without
 * it the face claims a de-esser is compressing the whole mix.
 */
function DynamicsFace({
  effect,
  trackId,
  law,
}: {
  effect: Effect;
  trackId: string;
  law: DynamicsLaw;
}) {
  // Only a processor that works on part of the spectrum has one.
  const band = useMemo(() => (effect.kind === 'deesser' ? deesserBand(effect) : null), [effect]);
  const bandFreqs = useMemo(() => logFrequencies(80, MIN_HZ, MAX_HZ), []);
  const bandDb = useMemo(
    () => (band ? eqMagnitudeResponse([band], bandFreqs, PLOT_RATE) : []),
    [band, bandFreqs],
  );

  // Input and output share one axis, so unity stays the corner-to-corner
  // diagonal whichever window the processor needs.
  const floorDb = axisTopOf(effect.kind) - AXIS_SPAN_DB;
  const xOfDb = (db: number) => ((db - floorDb) / AXIS_SPAN_DB) * CURVE_H;
  const yOfOutDb = (db: number) => CURVE_H - ((db - floorDb) / AXIS_SPAN_DB) * CURVE_H;

  const pts: string[] = [];
  for (let i = 0; i <= AXIS_SPAN_DB; i++) {
    const inDb = floorDb + i;
    // The law takes a LINEAR envelope and returns a LINEAR gain, so the dB
    // axis converts on the way in and on the way out.
    const gain = dynamicsGain(law, dbToGain(inDb));
    const outDb = inDb + 20 * Math.log10(Math.max(gain, 1e-6));
    const y = clamp(yOfOutDb(outDb), -20, CURVE_H + 20);
    pts.push(`${i === 0 ? 'M' : 'L'} ${xOfDb(inDb).toFixed(1)} ${y.toFixed(1)}`);
  }

  const turnX = xOfDb(law.thresholdDb);
  const marker = `${turnLabelOf(effect.kind).toLowerCase()} ${law.thresholdDb.toFixed(1)} dB`;
  // The marker label sits on whichever side of its line has room; a limiter's
  // ceiling is within a decibel of full scale, hard against the right edge.
  const turnRight = turnX > CURVE_H * 0.6;
  const bandPath = bandFreqs
    .map((hz, i) => {
      const y = BAND_STRIP_H - clamp((bandDb[i] + 30) / 30, 0, 1) * (BAND_STRIP_H - 2);
      return `${i === 0 ? 'M' : 'L'} ${xOfHz(hz, CURVE_H).toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="fx-dyn">
      <svg
        width={CURVE_H}
        height={band ? CURVE_H + BAND_STRIP_H : CURVE_H}
        className="fx-curve"
        aria-label={
          band
            ? `Transfer curve for the ${formatHz(band.freqHz)} band only, ${marker}`
            : `Dynamics transfer curve, ${marker}`
        }
      >
        <line
          x1={0}
          y1={CURVE_H}
          x2={CURVE_H}
          y2={0}
          stroke="var(--grid-sub)"
          strokeDasharray="3 3"
        />
        {[floorDb + 20, floorDb + 40].map((db) => (
          <line
            key={db}
            x1={xOfDb(db)}
            y1={0}
            x2={xOfDb(db)}
            y2={CURVE_H}
            stroke="var(--grid-sub)"
          />
        ))}
        {floorDb + AXIS_SPAN_DB > 0 && (
          // Where full scale is, on the one face whose axis goes past it.
          <line x1={xOfDb(0)} y1={0} x2={xOfDb(0)} y2={CURVE_H} stroke="var(--grid-bar)" />
        )}
        <line
          x1={turnX}
          y1={0}
          x2={turnX}
          y2={CURVE_H}
          stroke="var(--warm)"
          strokeDasharray="2 3"
        />
        <text
          x={turnRight ? turnX - 3 : turnX + 3}
          y={9}
          fontSize={8}
          fill="var(--warm)"
          textAnchor={turnRight ? 'end' : 'start'}
        >
          {turnLabelOf(effect.kind)}
        </text>
        {band && (
          <text x={3} y={9} fontSize={8} fill="var(--text-faint)">
            {formatHz(band.freqHz)} band
          </text>
        )}
        <path d={pts.join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.8" />
        <OperatingPoint
          trackId={trackId}
          effectId={effect.id}
          law={law}
          floorDb={floorDb}
          spanDb={AXIS_SPAN_DB}
          size={CURVE_H}
        />
        {band && (
          <g transform={`translate(0 ${CURVE_H})`}>
            <line
              x1={0}
              y1={BAND_STRIP_H}
              x2={CURVE_H}
              y2={BAND_STRIP_H}
              stroke="var(--grid-bar)"
            />
            <path d={bandPath} fill="none" stroke="var(--info)" strokeWidth="1.4" />
          </g>
        )}
      </svg>
      <GrMeter trackId={trackId} effectId={effect.id} title="Gain reduction" />
    </div>
  );
}

/**
 * Multiband face: the crossover, not a transfer curve.
 *
 * This one gets a different picture on purpose. Its three bands are native
 * `DynamicsCompressorNode`s, so there is no curve here that the audio is
 * filled from — a transfer plot would be our guess at the browser's knee law,
 * which is the same class of lie as the straight line it replaces. Per-band
 * gain reduction is not on offer either: the node publishes one figure, the
 * worst of the three. What *is* shared is the crossover — the same
 * Linkwitz-Riley maths the filters are built from, at the same two splits,
 * clamped the same way — so the face shows the thing this processor actually
 * is: three bands, split here, each compressed at its own ratio.
 */
function MultibandFace({ effect, trackId }: { effect: Effect; trackId: string }) {
  const { lowHz, highHz } = multibandSplits(effect);
  const response = useMemo(() => {
    const freqs = logFrequencies(150, MIN_HZ, MAX_HZ);
    return freqs.map((hz) => ({ hz, bands: crossoverResponse(hz, lowHz, highHz, PLOT_RATE) }));
  }, [lowHz, highHz]);

  const yOf = (db: number) =>
    CURVE_H - clamp((db + SPLIT_RANGE_DB) / SPLIT_RANGE_DB, 0, 1) * (CURVE_H - 14);
  const pathOf = (pick: (r: CrossoverResponse) => Complex) =>
    response
      .map(
        ({ hz, bands }, i) =>
          `${i === 0 ? 'M' : 'L'} ${xOfHz(hz, SPLIT_W).toFixed(1)} ${yOf(
            complexMagnitudeDb(pick(bands)),
          ).toFixed(1)}`,
      )
      .join(' ');

  // One band per split region, drawn and labelled where that band is the one
  // carrying the signal — the geometric centre of its own span.
  const regions = [
    {
      name: 'low',
      colour: 'var(--info)',
      at: Math.sqrt(MIN_HZ * lowHz),
      path: pathOf((r) => r.low),
    },
    {
      name: 'mid',
      colour: 'var(--accent)',
      at: Math.sqrt(lowHz * highHz),
      path: pathOf((r) => r.mid),
    },
    {
      name: 'high',
      colour: 'var(--warm)',
      at: Math.sqrt(highHz * MAX_HZ),
      path: pathOf((r) => r.high),
    },
  ];

  return (
    <div className="fx-dyn">
      <svg
        width={SPLIT_W}
        height={CURVE_H}
        className="fx-curve"
        aria-label={`Three bands split at ${formatHz(lowHz)} and ${formatHz(highHz)}, each compressed on its own`}
      >
        {[100, 1000, 10000].map((hz) => (
          <line
            key={hz}
            x1={xOfHz(hz, SPLIT_W)}
            y1={0}
            x2={xOfHz(hz, SPLIT_W)}
            y2={CURVE_H}
            stroke="var(--grid-beat)"
          />
        ))}
        {[lowHz, highHz].map((hz) => (
          <g key={hz}>
            <line
              x1={xOfHz(hz, SPLIT_W)}
              y1={0}
              x2={xOfHz(hz, SPLIT_W)}
              y2={CURVE_H}
              stroke="var(--grid-bar)"
              strokeDasharray="2 3"
            />
            <text
              x={xOfHz(hz, SPLIT_W)}
              y={9}
              fontSize={8}
              fill="var(--text-faint)"
              textAnchor="middle"
            >
              {formatHz(hz)}
            </text>
          </g>
        ))}
        {regions.map((r) => (
          <path key={r.name} d={r.path} fill="none" stroke={r.colour} strokeWidth="1.6" />
        ))}
        {regions.map((r) => (
          <text
            key={r.name}
            x={clamp(xOfHz(r.at, SPLIT_W), 12, SPLIT_W - 12)}
            y={CURVE_H - 3}
            fontSize={8}
            fill={r.colour}
            textAnchor="middle"
          >
            {paramOf(effect, `${r.name}Ratio`).toFixed(1)}:1
          </text>
        ))}
      </svg>
      <GrMeter
        trackId={trackId}
        effectId={effect.id}
        title="Gain reduction — the band working hardest"
      />
    </div>
  );
}

// ------------------------------------------------------- saturation curve

/**
 * A delay, drawn as the echoes it makes.
 *
 * A knob row tells you 6/16 and 32% and leaves you to imagine the result.
 * The taps are the result: where each repeat lands in time, how loud it is,
 * and — for a ping-pong — which side it lands on.
 */
function DelayFace({ layout }: { layout: DelayLayout }) {
  const W = 200;
  const H = CURVE_H;
  const mid = H / 2;
  // Show four bars of echoes or the whole tail, whichever is shorter, so a
  // long delay does not squash a short one into the left edge.
  const span = Math.max(layout.timeSec * Math.min(layout.taps.length, 8), 0.001);
  return (
    <svg
      width={W}
      height={H}
      className="fx-curve"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-label={`Delay: ${layout.taps.length} audible repeats, ${Math.round(
        layout.timeSec * 1000,
      )} milliseconds apart${layout.pingPong && layout.width > 0 ? ', alternating channels' : ''}`}
    >
      <line x1={0} y1={mid} x2={W} y2={mid} stroke="var(--grid-sub)" />
      {layout.taps.map((level, i) => {
        const x = ((i * layout.timeSec) / span) * (W - 8) + 4;
        // A ping-pong alternates sides — but only as far as its Width throws
        // them. At width 0 both panners sit at centre and there is nothing
        // alternating, so both sides are drawn and the picture agrees.
        const alternating = layout.pingPong && layout.width > 0;
        const up = !alternating || i % 2 === 0;
        const down = !alternating || i % 2 === 1;
        // The quiet side is what the width leaves in the other channel.
        const quiet = alternating ? 1 : layout.pingPong ? 1 - layout.width : 0.55;
        const h = level * (mid - 6);
        return (
          <g key={i}>
            {up && (
              <line
                x1={x}
                y1={mid}
                x2={x}
                y2={mid - h}
                stroke="var(--accent)"
                strokeWidth="2"
                strokeLinecap="round"
              />
            )}
            {down && (
              <line
                x1={x}
                y1={mid}
                x2={x}
                y2={mid + h}
                stroke="var(--accent)"
                strokeWidth="2"
                strokeLinecap="round"
                opacity={alternating ? 1 : quiet}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * A reverb, drawn as its tail.
 *
 * The pre-delay is the gap before anything happens, which is the parameter
 * people most often set by ear and never see; the curve after it is the same
 * envelope the impulse generator shapes its noise with.
 */
function ReverbFace({ tail }: { tail: ReverbTail }) {
  const W = 200;
  const H = CURVE_H;
  const total = tail.preDelaySec + tail.decaySec;
  const preW = total > 0 ? (tail.preDelaySec / total) * W : 0;
  const points = tail.envelope
    .map((v, i) => {
      const x = preW + (i / (tail.envelope.length - 1)) * (W - preW);
      return `${x.toFixed(1)} ${(H - 4 - v * (H - 10)).toFixed(1)}`;
    })
    .join(' L ');
  return (
    <svg
      width={W}
      height={H}
      className="fx-curve"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-label={`Reverb: ${Math.round(tail.preDelaySec * 1000)} millisecond pre-delay, ${tail.decaySec.toFixed(1)} second tail, damped at ${Math.round(tail.dampingHz)} hertz`}
    >
      <line x1={0} y1={H - 4} x2={W} y2={H - 4} stroke="var(--grid-sub)" />
      {preW > 1 && (
        <>
          <rect x={0} y={0} width={preW} height={H} fill="var(--bg-deep)" opacity="0.6" />
          <line x1={preW} y1={0} x2={preW} y2={H} stroke="var(--grid-bar)" strokeDasharray="2 2" />
        </>
      )}
      <path
        d={`M ${preW} ${H - 4} L ${points}`}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.8"
      />
      <path
        d={`M ${preW} ${H - 4} L ${points} L ${W} ${H - 4} Z`}
        fill="var(--accent)"
        opacity="0.14"
      />
    </svg>
  );
}

/**
 * A stereo width control, drawn as the field it produces.
 *
 * The wedge is the image: narrow at mono, wide at two. The band across the
 * bottom is the frequency below which the sides are removed entirely, which
 * is the part of this processor a number cannot convey.
 */
function WidthFace({ field }: { field: WidthField }) {
  const W = 200;
  const H = CURVE_H;
  const cx = W / 2;
  // 0..2 maps to nothing..the full half-width.
  const half = Math.min(1, field.width / 2) * (W / 2 - 6);
  const bassY = H - 12;
  return (
    <svg
      width={W}
      height={H}
      className="fx-curve"
      viewBox={`0 0 ${W} ${H}`}
      aria-label={`Stereo width ${field.width.toFixed(2)}, mono below ${Math.round(field.bassMonoHz)} hertz`}
    >
      <line x1={cx} y1={4} x2={cx} y2={H - 4} stroke="var(--grid-sub)" />
      <path
        d={`M ${cx} ${H - 8} L ${cx - half} 6 L ${cx + half} 6 Z`}
        fill="var(--accent)"
        opacity="0.18"
        stroke="var(--accent)"
        strokeWidth="1.4"
      />
      {field.width > 1.02 && (
        <text x={cx} y={16} textAnchor="middle" fontSize="8" fill="var(--text-faint)">
          wider than source
        </text>
      )}
      {field.bassMonoHz > 21 && (
        <>
          <line
            x1={4}
            y1={bassY}
            x2={W - 4}
            y2={bassY}
            stroke="var(--warm, var(--accent))"
            strokeDasharray="3 2"
          />
          <text x={6} y={bassY - 3} fontSize="8" fill="var(--text-faint)">
            mono below {Math.round(field.bassMonoHz)} Hz
          </text>
        </>
      )}
    </svg>
  );
}

/** What the picture is of, for the reader who cannot see it. */
function shaperLabel(effect: Effect): string {
  switch (effect.kind) {
    case 'bitcrusher':
      return `Quantisation staircase at ${Math.round(paramOf(effect, 'bits'))} bits`;
    case 'distortion':
      return 'Clipping curve';
    case 'ampsim':
      return 'Preamp saturation curve';
    default:
      return 'Saturation curve';
  }
}

/**
 * A waveshaper's transfer curve, drawn from the array the audio is filled
 * with. The full curve can be tens of thousands of points (the bitcrusher's
 * staircase needs them), so it is decimated for the path — by picking real
 * samples rather than averaging, because averaging a staircase draws a ramp.
 */
function ShaperFace({ curve, label }: { curve: Float32Array; label: string }) {
  const path = useMemo(() => {
    const points = Math.min(curve.length, 257);
    const step = (curve.length - 1) / (points - 1);
    let d = '';
    for (let i = 0; i < points; i++) {
      const v = curve[Math.round(i * step)];
      const x = (i / (points - 1)) * CURVE_H;
      const y = CURVE_H / 2 - clamp(v, -1.4, 1.4) * (CURVE_H / 2.2);
      d += `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
    }
    return d.trim();
  }, [curve]);
  return (
    <svg width={CURVE_H} height={CURVE_H} className="fx-curve" aria-label={label}>
      <line x1={0} y1={CURVE_H / 2} x2={CURVE_H} y2={CURVE_H / 2} stroke="var(--grid-sub)" />
      <line x1={CURVE_H / 2} y1={0} x2={CURVE_H / 2} y2={CURVE_H} stroke="var(--grid-sub)" />
      <line
        x1={0}
        y1={CURVE_H}
        x2={CURVE_H}
        y2={0}
        stroke="var(--grid-sub)"
        strokeDasharray="3 3"
      />
      <path d={path} fill="none" stroke="var(--warm)" strokeWidth="1.8" />
    </svg>
  );
}

// -------------------------------------------------------------- LFO shape

const LFO_SHAPES = ['sine', 'triangle', 'square', 'saw', 'random'] as const;

function lfoValue(shape: string, phase: number): number {
  const t = phase - Math.floor(phase);
  switch (shape) {
    case 'triangle':
      return 1 - 4 * Math.abs(t - 0.5);
    case 'square':
      return t < 0.5 ? 1 : -1;
    case 'saw':
      return 1 - 2 * t;
    case 'random':
      // A stable pseudo-random step per cycle segment, so the picture holds
      // still instead of flickering while the panel is open.
      return Math.sin(Math.floor(t * 8) * 12.9898) * 2 - 1;
    default:
      return Math.sin(t * Math.PI * 2);
  }
}

/** How many cycles of the modulator a face draws, by how fast it is running. */
function cyclesFor(rateHz: number): number {
  // One window is about two seconds of modulation: slow enough that a 0.2 Hz
  // rotary shows less than a full turn, fast enough that an 8 Hz tremolo does
  // not draw as a solid block.
  return clamp(rateHz * 2, 0.5, 8);
}

const MOD_TARGET_LABEL: Record<ModulationField['target'], string> = {
  delay: 'delay time',
  filter: 'notch frequency',
  level: 'level',
  pan: 'position',
  rotor: 'horn level',
};

/**
 * The modulator, as the audio runs it.
 *
 * Everything drawn here comes from `modulationOf`, which reports the shape the
 * modulator builds, the share of its available sweep the setting uses, and the
 * rate it runs at with a tempo lock resolved. Nothing is read off a parameter
 * directly: that is what let six devices share one picture that answered to
 * almost none of their controls.
 */
function LfoFace({ field }: { field: ModulationField }) {
  const cycles = cyclesFor(field.rateHz);
  const shape = (LFO_SHAPES[field.shape] ?? 'sine').toLowerCase();
  const path = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 160; i++) {
      const phase = (i / 160) * cycles;
      const v = lfoValue(shape, phase) * clamp(field.depth, 0, 1);
      pts.push(
        `${i === 0 ? 'M' : 'L'} ${((i / 160) * CURVE_W).toFixed(1)} ${(
          CURVE_H / 2 -
          v * (CURVE_H / 2.4)
        ).toFixed(1)}`,
      );
    }
    return pts.join(' ');
  }, [shape, field.depth, cycles]);
  const label = `${shape} modulation of ${MOD_TARGET_LABEL[field.target]}, ${Math.round(
    field.depth * 100,
  )} percent at ${field.rateHz.toFixed(2)} hertz`;
  return (
    <svg width={CURVE_W} height={CURVE_H} className="fx-curve" aria-label={label}>
      <line x1={0} y1={CURVE_H / 2} x2={CURVE_W} y2={CURVE_H / 2} stroke="var(--grid-sub)" />
      {/* At zero depth the line stays flat, which is what the processor does —
          the old fallback drew a 60 % sweep for a device doing nothing. */}
      <path d={path} fill="none" stroke="var(--info)" strokeWidth="1.8" />
      <text x={4} y={CURVE_H - 4} fontSize="8" fill="var(--text-faint)">
        {MOD_TARGET_LABEL[field.target]}
      </text>
      <text x={CURVE_W - 4} y={CURVE_H - 4} fontSize="8" textAnchor="end" fill="var(--text-faint)">
        {field.rateHz < 1 ? `${field.rateHz.toFixed(2)} Hz` : `${field.rateHz.toFixed(1)} Hz`}
      </text>
    </svg>
  );
}

// ------------------------------------------------------------- spectrum

/** Live spectrum or scope drawn from an effect's measurement tap. */
function TapFace({
  trackId,
  effect,
  mode,
}: {
  trackId: string;
  effect: Effect;
  mode: 'spectrum' | 'scope';
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = CURVE_W * dpr;
    canvas.height = CURVE_H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let freq: Float32Array | null = null;
    let time: Float32Array | null = null;
    return engine.onFrame(() => {
      const tap = engine.effectTap(trackId, effect.id);
      ctx.clearRect(0, 0, CURVE_W, CURVE_H);
      const style = getComputedStyle(canvas);
      ctx.strokeStyle = style.getPropertyValue('--accent').trim() || '#37b89a';
      ctx.lineWidth = 1.5;
      if (!tap) return;
      if (mode === 'spectrum') {
        if (!freq || freq.length !== tap.frequencyBinCount)
          freq = new Float32Array(tap.frequencyBinCount);
        tap.getFloatFrequencyData(freq);
        ctx.beginPath();
        // The context's own rate: a hard-coded 24 kHz drew every point about
        // 8.8 % high at 44.1 kHz, so the analyser disagreed with the EQ curve
        // beside it on the same channel.
        const nyquist = tap.context.sampleRate / 2;
        for (let i = 1; i < freq.length; i++) {
          const hz = (i / freq.length) * nyquist;
          const x = xOfHz(clamp(hz, MIN_HZ, MAX_HZ));
          const y = CURVE_H - clamp((freq[i] + 100) / 100, 0, 1) * CURVE_H;
          if (i === 1) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        if (!time || time.length !== tap.fftSize) time = new Float32Array(tap.fftSize);
        tap.getFloatTimeDomainData(time);
        ctx.beginPath();
        for (let i = 0; i < time.length; i++) {
          const x = (i / time.length) * CURVE_W;
          const y = CURVE_H / 2 - clamp(time[i], -1, 1) * (CURVE_H / 2.2);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    });
  }, [trackId, effect.id, mode]);

  return (
    <canvas ref={canvasRef} className="fx-curve" style={{ width: CURVE_W, height: CURVE_H }} />
  );
}

/**
 * Vocal Tune's law: what a sung pitch becomes.
 *
 * The x axis is one octave of what was sung; the y axis is what comes out. A
 * chromatic scale is the diagonal with twelve steps in it; a major scale has
 * five wider steps, and the width of a step is exactly how far a note can be
 * out before it is pulled somewhere else. Strength tilts the whole staircase
 * back toward the diagonal, because that is precisely what strength does —
 * at 0 the picture is the input, unchanged, which is also what the processor
 * would do.
 *
 * Drawn from `tuneSettingsOf`, which is what the audio editor retunes with, so
 * this cannot show a scale the correction would not snap to.
 */
function TuneFace({ settings }: { settings: NonNullable<ReturnType<typeof tuneSettingsOf>> }) {
  const W = CURVE_W;
  const H = CURVE_H;
  const strength = clamp(settings.strength ?? 1, 0, 1);
  const tonic = (((settings.tonic ?? 0) % 12) + 12) % 12;
  const scaleId = settings.scaleId ?? 'chromatic';

  const { d, steps } = useMemo(() => {
    // One octave from the tonic, sampled finely enough that a step edge is a
    // vertical line rather than a slope.
    const N = 240;
    const points: string[] = [];
    const edges: number[] = [];
    let previous = Number.NaN;
    for (let i = 0; i <= N; i++) {
      const semis = (i / N) * 12;
      const sung = 60 + tonic + semis;
      const target = snapToScale(Math.round(sung), tonic, scaleId);
      const out = sung + (target - sung) * strength;
      const x = (semis / 12) * W;
      const y = H - ((out - (60 + tonic)) / 12) * H;
      points.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${clamp(y, 0, H).toFixed(2)}`);
      if (target !== previous) {
        if (i > 0) edges.push(x);
        previous = target;
      }
    }
    return { d: points.join(' '), steps: edges };
  }, [W, H, strength, tonic, scaleId]);

  return (
    <svg
      width={W}
      height={H}
      className="fx-curve"
      viewBox={`0 0 ${W} ${H}`}
      aria-label={`Retune to ${KEY_NAMES[tonic]} ${scaleById(scaleId)?.label ?? scaleId}, strength ${Math.round(strength * 100)} percent`}
    >
      {/* Sung equals corrected: the line the processor leaves alone. */}
      <line x1={0} y1={H} x2={W} y2={0} stroke="var(--grid-sub)" strokeDasharray="3 3" />
      {steps.map((x, i) => (
        <line key={i} x1={x} y1={0} x2={x} y2={H} stroke="var(--grid-sub)" opacity="0.5" />
      ))}
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.6" />
      <text x={4} y={H - 4} fontSize="8" fill="var(--text-faint)">
        {KEY_NAMES[tonic]} {scaleById(scaleId)?.label ?? scaleId}
      </text>
      <text x={W - 4} y={10} fontSize="8" textAnchor="end" fill="var(--text-faint)">
        {Math.round(settings.retuneMs ?? 0)} ms
      </text>
    </svg>
  );
}

/**
 * Gain Match: what the device measures, and the trim that would land it.
 *
 * The device is called a *measured* trim, and until now it measured nothing —
 * it was a gain knob with a longer name, and matching two versions of a chain
 * by ear is exactly the job it claims to remove. The analyser already hangs off
 * its output, so the level is there to be read: this integrates it while audio
 * plays and offers the one trim that puts it on the target.
 *
 * RMS, not LUFS: a loudness meter needs K-weighting and a gate, which the
 * Release page has and this insert does not. Saying which number it is, is the
 * difference between a simple tool and a wrong one.
 */
function MatchFace({
  trackId,
  effect,
  onParam,
  onGestureStart,
  onGestureEnd,
}: {
  trackId: string;
  effect: Effect;
  onParam: (key: string, value: number) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}) {
  const target = paramOf(effect, 'target');
  const [measuredDb, setMeasuredDb] = useState<number | null>(null);
  // The integrated value the button uses, kept out of state so a frame that
  // does not change the rounded readout does not re-render the console.
  const level = useRef<number | null>(null);

  useEffect(() => {
    level.current = null;
    setMeasuredDb(null);
    const buffer = new Float32Array(2048);
    return engine.onFrame(() => {
      const tap = engine.effectTap(trackId, effect.id);
      if (!tap) return;
      if (buffer.length !== tap.fftSize) return;
      tap.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
      const rms = Math.sqrt(sum / buffer.length);
      // Silence never moves the average: a measurement taken over the gaps in
      // a performance is a measurement of the gaps.
      if (rms < 1e-5) return;
      const db = 20 * Math.log10(rms);
      level.current = level.current === null ? db : level.current + 0.08 * (db - level.current);
      setMeasuredDb(Math.round(level.current * 10) / 10);
    });
  }, [trackId, effect.id]);

  const W = CURVE_W;
  const H = CURVE_H;
  // −60..0 dBFS across the width, which is the range a mix lives in.
  const xOfDb = (db: number) => clamp((db + 60) / 60, 0, 1) * W;
  const suggestion = measuredDb === null ? null : matchTrimFor(effect, measuredDb);

  return (
    <div className="fx-match">
      <svg
        width={W}
        height={H}
        className="fx-curve"
        viewBox={`0 0 ${W} ${H}`}
        aria-label={
          measuredDb === null
            ? `Target ${target.toFixed(1)} dB RMS, nothing measured yet`
            : `Measured ${measuredDb.toFixed(1)} dB RMS against a target of ${target.toFixed(1)} dB`
        }
      >
        <rect x={0} y={H / 2 - 7} width={W} height={14} fill="var(--bg-deep)" />
        {measuredDb !== null && (
          <rect
            x={0}
            y={H / 2 - 7}
            width={xOfDb(measuredDb)}
            height={14}
            fill="var(--accent)"
            opacity="0.55"
          />
        )}
        <line
          x1={xOfDb(target)}
          y1={H / 2 - 12}
          x2={xOfDb(target)}
          y2={H / 2 + 12}
          stroke="var(--warn, var(--accent))"
          strokeWidth="1.6"
        />
        <text
          x={xOfDb(target)}
          y={H / 2 - 15}
          fontSize="8"
          textAnchor="middle"
          fill="var(--text-faint)"
        >
          target
        </text>
        <text x={4} y={H - 4} fontSize="8" fill="var(--text-faint)">
          {measuredDb === null ? 'play to measure' : `${measuredDb.toFixed(1)} dB RMS`}
        </text>
      </svg>
      <button
        className="btn"
        data-testid="fx-match-now"
        disabled={suggestion === null}
        title={
          suggestion === null
            ? 'Play the track: the trim is measured, not guessed'
            : `Set the trim to ${suggestion.toFixed(1)} dB, which puts the output on ${target.toFixed(1)} dB`
        }
        onClick={() => {
          if (suggestion === null) return;
          onGestureStart();
          onParam('trim', suggestion);
          onGestureEnd();
        }}
      >
        Match
      </button>
    </div>
  );
}

/** How often the tuner runs YIN. A tuner that updates eight times a second
 *  reads as immediate; running the detector on every animation frame would
 *  spend three million operations sixty times a second to say the same thing. */
const TUNER_INTERVAL_MS = 120;
/** The window either side of a note that counts as in tune, in cents. */
const TUNER_IN_TUNE_CENTS = 5;
/** The needle's span. Past this the reading is another note's problem. */
const TUNER_SPAN_CENTS = 50;

/**
 * The tuner.
 *
 * It used to draw an oscilloscope: a picture of the waveform, from a device
 * whose entire job is to say *which note* and *how far off*. Everything needed
 * to answer that was already written — `model/pitch.ts` has YIN and
 * `noteFromHz` names a frequency against a reference A — and nothing had ever
 * asked it. This asks it, eight times a second, and draws the answer.
 *
 * The reference parameter is A4's tuning, so an orchestra at 442 or a period
 * instrument at 415 gets a needle that agrees with the room rather than a
 * constant twenty-eight cents of error.
 */
function TunerFace({ trackId, effect }: { trackId: string; effect: Effect }) {
  const referenceHz = paramOf(effect, 'reference');
  const [reading, setReading] = useState<PitchReading>({ hz: 0, confidence: 0 });

  useEffect(() => {
    let detector: PitchDetector | null = null;
    let window: Float32Array | null = null;
    let nextRun = 0;
    setReading({ hz: 0, confidence: 0 });
    return engine.onFrame(() => {
      const tap = engine.effectTap(trackId, effect.id);
      const ctx = engine.context;
      if (!tap || !ctx) return;
      const now = ctx.currentTime * 1000;
      if (now < nextRun) return;
      nextRun = now + TUNER_INTERVAL_MS;
      if (!window || window.length !== tap.fftSize) window = new Float32Array(tap.fftSize);
      if (!detector || detector.sampleRate !== ctx.sampleRate) {
        detector = new PitchDetector(ctx.sampleRate);
      }
      tap.getFloatTimeDomainData(window);
      // Low B on a five-string bass is 31 Hz; the top of a violin's range is
      // about 3.5 kHz. Outside that a tuner is guessing at a harmonic.
      const next = detector.detect(window, { minHz: 28, maxHz: 3600 });
      setReading((prev) =>
        prev.hz === next.hz && prev.confidence === next.confidence ? prev : next,
      );
    });
  }, [trackId, effect.id]);

  const voiced = reading.hz > 0 && reading.confidence >= DEFAULT_MIN_CONFIDENCE;
  const note = voiced ? noteFromHz(reading.hz, referenceHz) : null;
  const cents = note ? clamp(note.cents, -TUNER_SPAN_CENTS, TUNER_SPAN_CENTS) : 0;
  const inTune = note !== null && Math.abs(note.cents) <= TUNER_IN_TUNE_CENTS;

  const W = CURVE_W;
  const H = CURVE_H;
  const cx = W / 2;
  const needleX = cx + (cents / TUNER_SPAN_CENTS) * (W / 2 - 10);

  return (
    <div className={`fx-tuner${inTune ? ' in-tune' : ''}`} data-testid="fx-tuner">
      <div className="fx-tuner-note" aria-live="off">
        <span className="fx-tuner-name">{note ? `${note.name}${note.octave}` : '—'}</span>
        <span className="fx-tuner-cents t-num">
          {note ? `${note.cents > 0 ? '+' : ''}${note.cents.toFixed(0)}¢` : 'play a note'}
        </span>
      </div>
      <svg
        width={W}
        height={H}
        className="fx-curve"
        viewBox={`0 0 ${W} ${H}`}
        aria-label={
          note
            ? `${note.name}${note.octave}, ${Math.abs(note.cents).toFixed(0)} cents ${
                note.cents > 0 ? 'sharp' : 'flat'
              }, ${reading.hz.toFixed(1)} hertz`
            : 'No note detected'
        }
      >
        {/* The scale: a tick every ten cents, and the in-tune window drawn as
            a band rather than a line, because ±5 cents is what "in tune"
            actually means on a fretted instrument. */}
        <rect
          x={cx - (TUNER_IN_TUNE_CENTS / TUNER_SPAN_CENTS) * (W / 2 - 10)}
          y={H * 0.32}
          width={((2 * TUNER_IN_TUNE_CENTS) / TUNER_SPAN_CENTS) * (W / 2 - 10)}
          height={H * 0.4}
          fill="var(--accent)"
          opacity={inTune ? 0.28 : 0.1}
        />
        {[-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50].map((c) => {
          const x = cx + (c / TUNER_SPAN_CENTS) * (W / 2 - 10);
          const tall = c === 0 || c === -50 || c === 50;
          return (
            <line
              key={c}
              x1={x}
              y1={tall ? H * 0.24 : H * 0.34}
              x2={x}
              y2={tall ? H * 0.78 : H * 0.66}
              stroke="var(--grid-sub)"
            />
          );
        })}
        {note && (
          <>
            <line
              x1={needleX}
              y1={H * 0.16}
              x2={needleX}
              y2={H * 0.86}
              stroke={inTune ? 'var(--accent)' : 'var(--warm, var(--accent))'}
              strokeWidth="2.4"
            />
            {/* Which way to turn the peg, which is the thing a player wants
                before they want a number. */}
            <text
              x={8}
              y={H * 0.94}
              fontSize="9"
              fill={note.cents < -TUNER_IN_TUNE_CENTS ? 'var(--text)' : 'var(--text-faint)'}
            >
              ♭ flat
            </text>
            <text
              x={W - 8}
              y={H * 0.94}
              fontSize="9"
              textAnchor="end"
              fill={note.cents > TUNER_IN_TUNE_CENTS ? 'var(--text)' : 'var(--text-faint)'}
            >
              sharp ♯
            </text>
          </>
        )}
      </svg>
      <div className="fx-tuner-foot t-num">
        <span>{voiced ? `${reading.hz.toFixed(1)} Hz` : '—'}</span>
        <span>A = {referenceHz.toFixed(1)} Hz</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ face

/**
 * Which visualisation, if any, an effect kind earns.
 *
 * This names the *slot* a face fills, not the picture drawn in it: the mixer's
 * channel overview asks for a channel's EQ-shaped and dynamics-shaped inserts
 * by these names. Every dynamics processor answers `comp` or `gate` and then
 * draws its own law inside that slot — which is the distinction that was
 * missing when three of them shared one compressor drawing.
 */
export function faceKindOf(
  kind: string,
):
  | 'eq'
  | 'comp'
  | 'gate'
  | 'shaper'
  | 'lfo'
  | 'delay'
  | 'reverb'
  | 'width'
  | 'tune'
  | 'match'
  | 'tuner'
  | 'spectrum'
  | 'scope'
  | null {
  switch (kind) {
    case 'eq3':
    case 'eq8':
    case 'filter':
      return 'eq';
    case 'compressor':
    case 'limiter':
    case 'multiband':
    case 'deesser':
      return 'comp';
    case 'gate':
      return 'gate';
    case 'saturator':
    case 'distortion':
    case 'ampsim':
    case 'bitcrusher':
      return 'shaper';
    case 'chorus':
    case 'flanger':
    case 'phaser':
    case 'tremolo':
    case 'autopan':
    case 'rotary':
      return 'lfo';
    case 'delay':
    case 'pingpong':
      return 'delay';
    case 'reverb':
      return 'reverb';
    case 'width':
      return 'width';
    case 'analyser':
      return 'spectrum';
    case 'tuner':
      return 'tuner';
    case 'vocaltune':
      return 'tune';
    case 'gainMatch':
      return 'match';
    default:
      return null;
  }
}

export function EffectVisual({
  effect,
  trackId,
  onParam,
  onGestureStart,
  onGestureEnd,
}: {
  effect: Effect;
  trackId: string;
  onParam: (key: string, value: number) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}) {
  const face = faceKindOf(effect.kind);
  if (face === 'eq') {
    return (
      <EqFace
        effect={effect}
        onParam={onParam}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
      />
    );
  }
  if (face === 'comp' || face === 'gate') {
    if (effect.kind === 'multiband') return <MultibandFace effect={effect} trackId={trackId} />;
    const law = dynamicsLawOf(effect);
    // A dynamics processor with no law is a processor whose picture nobody has
    // worked out yet; showing nothing is honest, showing 1:1 is not.
    return law ? <DynamicsFace effect={effect} trackId={trackId} law={law} /> : null;
  }
  if (face === 'shaper') {
    // The curve the effect's own shaper is filled with, not a guess assembled
    // from `model` and `drive`: the bitcrusher has neither and was drawing a
    // tube curve for a quantiser, and the amp sim calls its drive `gain`.
    const curve = shaperCurveOf(effect);
    return curve ? <ShaperFace curve={curve} label={shaperLabel(effect)} /> : null;
  }
  if (face === 'lfo') {
    // The tempo is the project's, because a tempo-locked modulator's rate — and
    // therefore its picture — moves when the song does.
    const field = modulationOf(effect, useProjectStore.getState().project.bpm);
    return field ? <LfoFace field={field} /> : null;
  }
  if (face === 'delay') {
    // The tempo is the project's: a synced delay's picture has to move when
    // the song does.
    const layout = delayLayoutOf(effect, useProjectStore.getState().project.bpm);
    return layout ? <DelayFace layout={layout} /> : null;
  }
  if (face === 'reverb') {
    const tail = reverbTailOf(effect);
    return tail ? <ReverbFace tail={tail} /> : null;
  }
  if (face === 'width') {
    const field = widthFieldOf(effect);
    return field ? <WidthFace field={field} /> : null;
  }
  if (face === 'tune') {
    const settings = tuneSettingsOf(effect);
    return settings ? <TuneFace settings={settings} /> : null;
  }
  if (face === 'match') {
    return (
      <MatchFace
        trackId={trackId}
        effect={effect}
        onParam={onParam}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
      />
    );
  }
  if (face === 'tuner') {
    return <TunerFace trackId={trackId} effect={effect} />;
  }
  if (face === 'spectrum' || face === 'scope') {
    // The device offers both readings of the same tap; which one is drawn is
    // the user's choice, not a property of the kind.
    const mode = choiceOf(effect, 'view') === 1 ? 'scope' : 'spectrum';
    return <TapFace trackId={trackId} effect={effect} mode={mode} />;
  }
  return null;
}

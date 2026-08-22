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
import { memo, useEffect, useMemo, useRef } from 'react';
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
import {
  EQ8_BANDS,
  choiceName,
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
} from '../../model/effects';
import { clamp } from '../../model/music';
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
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    return engine.onFrame(() => {
      const gr = engine.gainReductionOf(trackId, effectId);
      const n = clamp(-gr / 24, 0, 1);
      if (fillRef.current) fillRef.current.style.transform = `scaleY(${n})`;
      if (textRef.current) {
        textRef.current.textContent = `${gr <= -0.05 ? gr.toFixed(1) : '0.0'} dB`;
      }
    });
  }, [trackId, effectId]);

  return (
    <div className="fx-gr" title={title}>
      <div className="fx-gr-track">
        <div className="fx-gr-fill" ref={fillRef} />
      </div>
      <span className="fx-gr-val" ref={textRef}>
        0.0 dB
      </span>
      <span className="fx-gr-label">GR</span>
    </div>
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

function LfoFace({ shape, depth, cycles }: { shape: string; depth: number; cycles: number }) {
  const path = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 120; i++) {
      const phase = (i / 120) * Math.max(1, cycles);
      const v = lfoValue(shape, phase) * clamp(depth, 0, 1);
      pts.push(
        `${i === 0 ? 'M' : 'L'} ${((i / 120) * CURVE_W).toFixed(1)} ${(
          CURVE_H / 2 -
          v * (CURVE_H / 2.4)
        ).toFixed(1)}`,
      );
    }
    return pts.join(' ');
  }, [shape, depth, cycles]);
  return (
    <svg width={CURVE_W} height={CURVE_H} className="fx-curve" aria-label="Modulation shape">
      <line x1={0} y1={CURVE_H / 2} x2={CURVE_W} y2={CURVE_H / 2} stroke="var(--grid-sub)" />
      <path d={path} fill="none" stroke="var(--info)" strokeWidth="1.8" />
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
        const nyquist = 24000;
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
): 'eq' | 'comp' | 'gate' | 'shaper' | 'lfo' | 'spectrum' | 'scope' | null {
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
    case 'analyser':
      return 'spectrum';
    case 'tuner':
      return 'scope';
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
    const shapeIndex = Math.round(paramOf(effect, 'shape'));
    const shape = LFO_SHAPES[shapeIndex] ?? choiceName(effect, 'shape') ?? 'sine';
    return (
      <LfoFace
        shape={String(shape).toLowerCase()}
        depth={paramOf(effect, 'depth') || 0.6}
        cycles={2}
      />
    );
  }
  if (face === 'spectrum' || face === 'scope') {
    return <TapFace trackId={trackId} effect={effect} mode={face} />;
  }
  return null;
}

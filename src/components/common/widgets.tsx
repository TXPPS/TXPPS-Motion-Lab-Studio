import { useCallback, useEffect, useId, useRef, type CSSProperties } from 'react';
import { engine } from '../../audio/engine';
import {
  clamp,
  dbToLin,
  faderPosToGain,
  formatDb,
  gainToFaderPos,
  linToDb,
} from '../../model/music';
import { usePointerDrag } from '../../hooks/usePointerDrag';

/**
 * Inline styles that also carry CSS custom properties.
 *
 * Positions that only a scale function knows (meter zone boundaries, fader
 * tick heights) are computed here and handed to CSS as properties, so the
 * stylesheet still owns every colour and the component still owns every
 * number. Without this type the properties would need a cast.
 */
type VarStyle = CSSProperties & Record<`--${string}`, string>;

/* ------------------------------------------------------------------ fader */

/**
 * The printed dB ladder beside the slot.
 *
 * These are the marks an engineer looks for, not an even division of the
 * travel: the top 10 dB gets three of the seven because that is where the
 * decisions are. Positions come from the fader's *own* curve
 * (`gainToFaderPos`), so a tick can never sit somewhere the cap cannot reach.
 */
const FADER_TICKS = [0, -5, -10, -20, -30, -40, -60] as const;

/** Where a dB mark sits on the fader's travel, 0 at the bottom, 1 at the top. */
function faderDbPosition(db: number): number {
  return gainToFaderPos(dbToLin(db));
}

/**
 * Unity gain. The fader curve is gain = pos^2.2 x 1.5, so 0 dB sits at
 * (1/1.5)^(1/2.2) = 83.2% of the travel. It is computed rather than written
 * down so the detent, the 0 tick and the cap cannot disagree if the curve
 * is ever retuned.
 */
const FADER_UNITY_POS = faderDbPosition(0);

/**
 * How far up its range the cap has moved. The usable travel is the lane minus
 * one cap, because the cap's centre can only reach from half a cap above the
 * bottom to half a cap below the top.
 */
function faderSpan(pos: number): string {
  return `calc((100% - var(--fader-cap-h)) * ${pos.toFixed(5)})`;
}

/**
 * Travel-relative placement, measured to the cap's *centre*. Everything printed
 * against the travel — ticks, the detent, the cap itself, the top of the level
 * fill — shares this one expression, so `--fader-cap-h` is the single number
 * that keeps them aligned.
 */
function faderTravel(pos: number): string {
  return `calc(var(--fader-cap-h) / 2 + ${faderSpan(pos)})`;
}

/**
 * Vertical fader, drawn as a cap in a slot.
 *
 * Fills its container's height (no pixel height prop) and positions its fill
 * and cap in percentages, so it can never paint outside the strip when the
 * mixer panel is resized. Drag distance is measured from the live element rect
 * at gesture start.
 */
export function Fader({
  value,
  onChange,
  onGestureStart,
  onGestureEnd,
  label,
}: {
  value: number;
  onChange: (gain: number) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = gainToFaderPos(value);

  const onPointerDown = usePointerDrag<{ pos: number; usable: number }>({
    onStart: () => {
      onGestureStart?.();
      const h = ref.current?.getBoundingClientRect().height ?? 120;
      return { pos, usable: Math.max(24, h - 14) };
    },
    onMove: (_dx, dy, _e, s) => {
      onChange(faderPosToGain(clamp(s.pos - dy / s.usable, 0, 1)));
    },
    onEnd: () => onGestureEnd?.(),
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.01 : 0.05;
    let next: number | null = null;
    if (e.key === 'ArrowUp') next = pos + step;
    else if (e.key === 'ArrowDown') next = pos - step;
    else if (e.key === 'Home') next = 1;
    else if (e.key === 'End') next = 0;
    if (next === null) return;
    e.preventDefault();
    onChange(faderPosToGain(clamp(next, 0, 1)));
  };

  return (
    <div
      ref={ref}
      className="fader"
      onPointerDown={onPointerDown}
      onDoubleClick={() => onChange(1)}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="slider"
      aria-label={label ?? 'Volume'}
      aria-valuemin={-60}
      aria-valuemax={3.5}
      aria-valuenow={Math.round(linToDb(value) * 10) / 10}
      aria-valuetext={`${formatDb(value)} decibels`}
    >
      {/* The scale is engraved on the desk, not drawn on the control: it is
          the one part of a fader that does not move. Marks only — the strip's
          fader lane is 30px wide and a "-60" at the label size needs 20 of
          them, which is why the stereo meter beside it reserves exactly that. */}
      <div className="fader-scale" aria-hidden="true">
        {FADER_TICKS.map((db) => (
          <span
            key={db}
            className={db === 0 ? 'unity' : undefined}
            style={{ bottom: faderTravel(faderDbPosition(db)) }}
          />
        ))}
      </div>
      <div className="fader-slot" aria-hidden="true" />
      <div className="fader-level" aria-hidden="true" style={{ height: faderSpan(pos) }} />
      {/* The detent: a line across the lane at unity with a nub either side of
          the slot, so the cap can be found by feel at speed. */}
      <div
        className="fader-detent"
        aria-hidden="true"
        style={{ bottom: faderTravel(FADER_UNITY_POS) }}
      />
      <div className="fader-cap" aria-hidden="true" style={{ bottom: faderTravel(pos) }} />
    </div>
  );
}

export function panText(v: number): string {
  if (Math.abs(v) < 0.005) return 'C';
  return `${Math.abs(Math.round(v * 100))}${v < 0 ? 'L' : 'R'}`;
}

/* ------------------------------------------------------------------- knob */

/** A point on a circle, with 0 degrees at 12 o'clock and clockwise positive. */
function polar(c: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [c + Math.cos(rad) * r, c + Math.sin(rad) * r];
}

/** SVG arc between two angles on a circle centred in a `size` box. */
function arcPath(c: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(c, r, from);
  const [x2, y2] = polar(c, r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to >= from ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/**
 * The face of every knob in the product.
 *
 * A knob is the fader's logic rotated, and the four things that make it read
 * as hardware are the same four: the value arc lives *outside* the cap, the
 * cap is a machined body rather than a flat disc, the pointer is a groove
 * *cut into* the cap, and there is a detent mark at the default.
 *
 * The pointer is the whole argument. A bright accent-coloured line painted on
 * a dark circle is the single clearest "web widget" tell in a DAW; two
 * overlapping strokes — a dark one and a light one offset toward the light
 * source — read as a slot milled into metal, cost one extra line, and stay
 * legible in all three themes because neither stroke is a hue.
 */
function KnobFace({
  size,
  from,
  to,
  angle,
  detent,
  arc,
  fillFrom,
}: {
  size: number;
  /** Sweep start, degrees clockwise from 12 o'clock. */
  from: number;
  /** Sweep end. */
  to: number;
  /** Where the value sits in that sweep. */
  angle: number;
  /** The parameter's default, marked on the ring. */
  detent: number;
  /** Value-arc colour: the parameter's domain colour, never a state colour. */
  arc: string;
  /** Where the value arc starts drawing — centre for a pan knob, `from` otherwise. */
  fillFrom: number;
}) {
  // React's useId contains colons, which are legal in HTML ids but awkward in
  // SVG url() references; stripped so several knobs can share a screen.
  const gid = `k${useId().replace(/:/g, '')}`;
  const c = size / 2;
  const sw = clamp(size * 0.1, 2, 3);
  const rRing = c - sw / 2 - 0.5;
  const rCap = Math.max(4, rRing - sw / 2 - Math.max(1.5, size * 0.07));
  // The groove runs across the outer half of the cap: any nearer the centre and
  // it reads as a spoke rather than as an index.
  const [gx1, gy1] = polar(c, rCap * 0.4, angle);
  const [gx2, gy2] = polar(c, rCap * 0.88, angle);
  const [dx1, dy1] = polar(c, rRing - sw / 2 - 0.5, detent);
  const [dx2, dy2] = polar(c, rRing + sw / 2 + 0.5, detent);

  return (
    <svg width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--cap-hi)' }} />
          <stop offset="0.46" style={{ stopColor: 'var(--cap-mid)' }} />
          <stop offset="1" style={{ stopColor: 'var(--cap-base)' }} />
        </linearGradient>
      </defs>
      {/* Ring track, then the value. Butt caps: a round cap on a value arc is a
          web tell — a real indicator ring has square ends. */}
      <path
        d={arcPath(c, rRing, from, to)}
        fill="none"
        stroke="var(--bg-well)"
        strokeWidth={sw}
        strokeLinecap="butt"
      />
      {Math.abs(angle - fillFrom) > 0.5 && (
        <path
          d={arcPath(c, rRing, fillFrom, angle)}
          fill="none"
          stroke={arc}
          strokeWidth={sw}
          strokeLinecap="butt"
        />
      )}
      <line
        x1={dx1}
        y1={dy1}
        x2={dx2}
        y2={dy2}
        stroke="var(--text-faint)"
        strokeWidth={1}
        strokeLinecap="butt"
      />
      <circle
        cx={c}
        cy={c}
        r={rCap}
        fill={`url(#${gid})`}
        stroke="var(--edge-lo)"
        strokeWidth={1}
      />
      {/* The light source is above, so the cap catches it across its top third. */}
      <path
        d={arcPath(c, rCap * 0.78, -62, 62)}
        fill="none"
        stroke="rgb(255 255 255 / 0.1)"
        strokeWidth={1}
      />
      <line
        x1={gx1}
        y1={gy1}
        x2={gx2}
        y2={gy2}
        stroke="rgb(0 0 0 / 0.6)"
        strokeWidth={Math.max(1.8, rCap * 0.24)}
        strokeLinecap="butt"
      />
      <line
        x1={gx1}
        y1={gy1 - 1}
        x2={gx2}
        y2={gy2 - 1}
        stroke="var(--edge-hi)"
        strokeWidth={1}
        strokeLinecap="butt"
      />
    </svg>
  );
}

/** Rotary pan knob (-1..1). Drag vertically; double-tap centers; arrows nudge. */
export function PanKnob({
  value,
  onChange,
  onGestureStart,
  onGestureEnd,
  size = 30,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  size?: number;
  label?: string;
}) {
  const onPointerDown = usePointerDrag<number>({
    onStart: () => {
      onGestureStart?.();
      return value;
    },
    onMove: (_dx, dy, _e, start) => onChange(clamp(start - dy / 70, -1, 1)),
    onEnd: () => onGestureEnd?.(),
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.02 : 0.1;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step;
    else if (e.key === 'Home') next = 0;
    if (next === null) return;
    e.preventDefault();
    onChange(clamp(next, -1, 1));
  };

  return (
    <div
      className="knob"
      style={{ width: size, height: size }}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onChange(0)}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="slider"
      aria-label={label ?? 'Pan'}
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={Math.round(value * 100) / 100}
      aria-valuetext={panText(value)}
    >
      {/* Pan fills from the centre out, because that is what the parameter
          means: the arc shows how far off centre, not how much of a range. */}
      <KnobFace
        size={size}
        from={-132}
        to={132}
        angle={value * 132}
        detent={0}
        fillFrom={0}
        arc="var(--fx-util)"
      />
    </div>
  );
}

/** Generic parameter knob (0..1 normalized) used by the synth panel. */
export function ParamKnob({
  norm,
  onNorm,
  size = 40,
  label,
  display,
}: {
  norm: number;
  onNorm: (v: number) => void;
  size?: number;
  label: string;
  display: string;
}) {
  const onPointerDown = usePointerDrag<number>({
    onStart: () => norm,
    onMove: (_dx, dy, _e, start) => onNorm(clamp(start - dy / 110, 0, 1)),
  });
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.01 : 0.05;
    let next: number | null = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = norm + step;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = norm - step;
    if (next === null) return;
    e.preventDefault();
    onNorm(clamp(next, 0, 1));
  };

  const angle = -132 + norm * 264;
  return (
    <div className="syn-knob">
      <div
        className="knob"
        style={{ width: size, height: size }}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Math.round(norm * 100) / 100}
        aria-valuetext={display}
      >
        <KnobFace
          size={size}
          from={-132}
          to={132}
          angle={angle}
          detent={-132}
          fillFrom={-132}
          arc="var(--fx-eq)"
        />
      </div>
      {/* Value above label, both left of nothing: a number and the word for it
          are different objects, and only the number is loud. */}
      <div className="kv t-num">{display}</div>
      <div className="knob-label t-label">{label}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ meters */

const DB_FLOOR = 60;

/**
 * Where a dB value sits on the meter, 0 at the floor and 1 at 0 dBFS.
 *
 * The scale is deliberately not linear-in-dB: the top 12 dB is where mixing
 * decisions are made, so it gets a third of the height, exactly as a hardware
 * meter's screen-printed scale does.
 *
 * Both meters in the product now position with this. `Meter` used to use a
 * linear-in-dB function of its own, which put the same -13 dB signal at 78% of
 * one bar and 62% of the other while a comment in mixer.css asserted the two
 * matched.
 */
export function meterScalePosition(db: number): number {
  if (db <= -DB_FLOOR) return 0;
  if (db >= 0) return 1;
  const x = (db + DB_FLOOR) / DB_FLOOR;
  return clamp(Math.pow(x, 1.9), 0, 1);
}

/** Tick marks a mixing engineer expects to find on a channel meter. */
export const METER_TICKS = [0, -3, -6, -12, -18, -24, -36, -48];

/**
 * Where the meter changes colour, in dBFS: safe below -18, comfortable
 * headroom to -6, hot to -1, and clipping above that.
 */
const METER_ZONE_DB = { lo: -18, mid: -6, hot: -1 } as const;

/**
 * The zone boundaries as positions on the meter's own scale, handed to CSS.
 *
 * They used to be fixed gradient percentages — 62%, 84%, 97% — written into
 * both meters' fills. A percentage cannot express a dB boundary: -18 dB is at
 * 50.8% of this scale, not 62%, so every meter in the product turned yellow
 * about 7 dB later than it claimed to and the two meters disagreed with each
 * other as well. Converting the boundaries through the same function that
 * positions the fill is what makes the printed scale, the bar height and the
 * colour change describe one signal.
 */
function meterZoneStops(scale: (db: number) => number): VarStyle {
  const pct = (db: number): string => `${(scale(db) * 100).toFixed(2)}%`;
  return {
    '--mz-lo': pct(METER_ZONE_DB.lo),
    '--mz-mid': pct(METER_ZONE_DB.mid),
    '--mz-hot': pct(METER_ZONE_DB.hot),
  };
}

const METER_ZONES = meterZoneStops(meterScalePosition);

/**
 * Stereo channel meter with peak hold, an over indicator and a printed dB
 * scale. It registers interest with the engine so unwatched channels are never
 * scanned, and it writes straight to the DOM on the engine's single frame loop
 * rather than through React state.
 */
export function StereoMeter({
  meterId,
  scale,
  label,
}: {
  meterId: string;
  /** draw the dB ruler beside the bars */
  scale?: boolean;
  label?: string;
}) {
  const lRef = useRef<HTMLDivElement>(null);
  const rRef = useRef<HTMLDivElement>(null);
  const lHold = useRef<HTMLDivElement>(null);
  const rHold = useRef<HTMLDivElement>(null);
  const overRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const unwatch = engine.watchMeter(meterId);
    const stop = engine.onFrame(() => {
      const m = engine.getMeter(meterId);
      const set = (el: HTMLDivElement | null, v: number) => {
        if (el) el.style.transform = `scaleY(${v})`;
      };
      const setHold = (el: HTMLDivElement | null, v: number) => {
        if (el) el.style.bottom = `${v * 100}%`;
      };
      set(lRef.current, m ? meterScalePosition(linToDb(m.rmsL)) : 0);
      set(rRef.current, m ? meterScalePosition(linToDb(m.rmsR)) : 0);
      setHold(lHold.current, m ? meterScalePosition(linToDb(m.holdL)) : 0);
      setHold(rHold.current, m ? meterScalePosition(linToDb(m.holdR)) : 0);
      if (overRef.current) overRef.current.dataset.over = m?.clipped ? 'yes' : 'no';
    });
    return () => {
      stop();
      unwatch();
    };
  }, [meterId]);

  return (
    // The bars are written straight to the DOM on the engine's frame loop, so
    // an ARIA meter here would be a role with no value — and thirty of them on
    // a mixer is thirty things to swipe past. The number a screen reader wants
    // is the peak readout beside it, which is real text.
    // `hw` marks a control whose *material* is drawn by base.css beside the
    // component; the strip's layout for it stays in mixer.css.
    <div className="smeter hw" style={METER_ZONES}>
      {/* Hiding the whole meter would hide this button with it, and
          aria-hidden over a focusable element is an outright error — so the
          bars are hidden and the one real control stays exposed. */}
      <button
        ref={overRef}
        className="smeter-over"
        data-over="no"
        title="Over — click to reset"
        aria-label={label ? `Reset over indicator for ${label}` : 'Reset over indicator'}
        onClick={() => engine.resetClipIndicators()}
      />
      <div className="smeter-bars" aria-hidden="true">
        <div className="smeter-ch">
          <div className="smeter-fill" ref={lRef} />
          <div className="smeter-hold" ref={lHold} />
        </div>
        <div className="smeter-ch">
          <div className="smeter-fill" ref={rRef} />
          <div className="smeter-hold" ref={rHold} />
        </div>
        {scale && (
          <div className="smeter-scale" aria-hidden>
            {METER_TICKS.map((db) => (
              <span
                key={db}
                /* Clamped so the 0 dB and floor labels sit fully inside the
                   scale rather than half-clipped at its ends. */
                style={{ bottom: `${clamp(meterScalePosition(db), 0.02, 0.965) * 100}%` }}
              >
                {db}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Real signal meter. Fills its container and drives fill/hold with percentage
 * transforms, so it needs no pixel height and cannot overflow. Reads the engine
 * analyser on the engine's single rAF loop and writes straight to the DOM.
 */
export function Meter({ meterId, wide }: { meterId: string; wide?: boolean }) {
  const fillRef = useRef<HTMLDivElement>(null);
  const holdRef = useRef<HTMLDivElement>(null);
  const ledRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const unwatch = engine.watchMeter(meterId);
    const stop = engine.onFrame(() => {
      const m = engine.getMeter(meterId);
      const fill = fillRef.current;
      const hold = holdRef.current;
      const led = ledRef.current;
      if (!fill || !hold || !led) return;
      // The x1.4 is this meter's own long-standing lift on RMS — a transport
      // meter reads short peaks, not an average. It stays; only the scale the
      // result is placed on has changed.
      const rmsN = m ? meterScalePosition(linToDb(m.rms * 1.4)) : 0;
      const holdN = m ? meterScalePosition(linToDb(m.hold)) : 0;
      fill.style.transform = `scaleY(${rmsN})`;
      // hold line rides the full track height in percent — no pixel measurement
      hold.style.transform = `translateY(${(1 - holdN) * 100}%)`;
      hold.style.opacity = holdN > 0.001 ? '0.75' : '0';
      const on = !!m?.clipped;
      if (led.dataset.on !== String(on)) {
        led.dataset.on = String(on);
        led.className = `meter-clip-led${on ? ' on' : ''}`;
      }
    });
    return () => {
      stop();
      unwatch();
    };
  }, [meterId]);

  const reset = useCallback(() => engine.resetClipIndicators(), []);
  return (
    <div className={`meter hw${wide ? ' wide' : ''}`} style={METER_ZONES} title="Signal meter">
      <div ref={fillRef} className="meter-fill" aria-hidden="true" />
      <div
        ref={holdRef}
        className="meter-hold"
        style={{ top: '100%', marginTop: -1.5 }}
        aria-hidden="true"
      />
      {/* Clearing an over indicator is a real action, so it is a real button —
          the stereo meter beside it already does this. */}
      <button
        ref={ledRef}
        className="meter-clip-led"
        onClick={reset}
        title="Clip indicator — click to reset peaks"
        aria-label="Reset over indicator"
      />
    </div>
  );
}

/** Live numeric peak readout (dB), updated on the engine frame loop. */
export function PeakReadout({ meterId }: { meterId: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let last = '';
    const unwatch = engine.watchMeter(meterId);
    const stop = engine.onFrame(() => {
      const m = engine.getMeter(meterId);
      const txt = m && m.hold > 0.00001 ? formatDb(m.hold) : '-inf';
      if (txt !== last && ref.current) {
        ref.current.textContent = txt;
        last = txt;
      }
    });
    return () => {
      stop();
      unwatch();
    };
  }, [meterId]);
  return <span ref={ref}>-inf</span>;
}

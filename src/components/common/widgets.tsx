import { useCallback, useEffect, useRef } from 'react';
import { engine } from '../../audio/engine';
import { clamp, faderPosToGain, formatDb, gainToFaderPos, linToDb } from '../../model/music';
import { usePointerDrag } from '../../hooks/usePointerDrag';

/**
 * Vertical fader. Fills its container's height (no pixel height prop) and
 * positions its fill/thumb in percentages, so it can never paint outside the
 * strip when the mixer panel is resized. Drag distance is measured from the
 * live element rect at gesture start.
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
      <div className="fader-track" />
      <div className="fader-fill" style={{ height: `calc((100% - 14px) * ${pos})` }} />
      <div className="fader-thumb" style={{ bottom: `calc(7px + (100% - 14px) * ${pos})` }} />
    </div>
  );
}

export function panText(v: number): string {
  if (Math.abs(v) < 0.005) return 'C';
  return `${Math.abs(Math.round(v * 100))}${v < 0 ? 'L' : 'R'}`;
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

  const r = size / 2;
  const rad = ((value * 132 - 90) * Math.PI) / 180;
  const ind = { x: r + Math.cos(rad) * (r - 5), y: r + Math.sin(rad) * (r - 5) };
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
      <svg width={size} height={size} aria-hidden>
        <circle cx={r} cy={r} r={r - 1.5} fill="#10151c" stroke="var(--border-strong)" />
        <circle cx={r} cy={r} r={r - 4.5} fill="#1d242e" />
        <line
          x1={r}
          y1={r}
          x2={ind.x}
          y2={ind.y}
          stroke={Math.abs(value) < 0.01 ? 'var(--text-dim)' : 'var(--accent)'}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
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

  const sweep = 264;
  const angle = -132 + norm * sweep;
  const r = size / 2;
  const rad = ((angle - 90) * Math.PI) / 180;
  const ind = { x: r + Math.cos(rad) * (r - 6), y: r + Math.sin(rad) * (r - 6) };
  const arc = (a: number) => {
    const rr = ((a - 90) * Math.PI) / 180;
    return `${r + Math.cos(rr) * (r - 2.5)} ${r + Math.sin(rr) * (r - 2.5)}`;
  };
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
        <svg width={size} height={size} aria-hidden>
          <path
            d={`M ${arc(-132)} A ${r - 2.5} ${r - 2.5} 0 1 1 ${arc(132)}`}
            fill="none"
            stroke="var(--bg-deep)"
            strokeWidth="3"
          />
          <path
            d={`M ${arc(-132)} A ${r - 2.5} ${r - 2.5} 0 ${angle > 48 ? 1 : 0} 1 ${arc(angle)}`}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx={r} cy={r} r={r - 7} fill="#1d242e" stroke="var(--border-strong)" />
          <line
            x1={r}
            y1={r}
            x2={ind.x}
            y2={ind.y}
            stroke="var(--text)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="kv">{display}</div>
      <div className="knob-label">{label}</div>
    </div>
  );
}

const DB_FLOOR = 60;

function normDb(v: number): number {
  if (v <= 0.000001) return 0;
  return clamp((20 * Math.log10(v) + DB_FLOOR) / DB_FLOOR, 0, 1);
}

/**
 * Where a dB value sits on the meter, 0 at the floor and 1 at 0 dBFS.
 *
 * The scale is deliberately not linear-in-dB: the top 12 dB is where mixing
 * decisions are made, so it gets a third of the height, exactly as a hardware
 * meter's screen-printed scale does.
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
    <div className="smeter">
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
      const rmsN = m ? normDb(m.rms * 1.4) : 0;
      const holdN = m ? normDb(m.hold) : 0;
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
    <div className={`meter${wide ? ' wide' : ''}`} title="Signal meter">
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

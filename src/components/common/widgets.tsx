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
 * Real signal meter. Fills its container and drives fill/hold with percentage
 * transforms, so it needs no pixel height and cannot overflow. Reads the engine
 * analyser on the engine's single rAF loop and writes straight to the DOM.
 */
export function Meter({ meterId, wide }: { meterId: string; wide?: boolean }) {
  const fillRef = useRef<HTMLDivElement>(null);
  const holdRef = useRef<HTMLDivElement>(null);
  const ledRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return engine.onFrame(() => {
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
  }, [meterId]);

  const reset = useCallback(() => engine.resetClipIndicators(), []);
  return (
    <div className={`meter${wide ? ' wide' : ''}`} title="Signal meter">
      <div ref={fillRef} className="meter-fill" />
      <div ref={holdRef} className="meter-hold" style={{ top: '100%', marginTop: -1.5 }} />
      <div
        ref={ledRef}
        className="meter-clip-led"
        onClick={reset}
        title="Clip indicator — click to reset peaks"
      />
    </div>
  );
}

/** Live numeric peak readout (dB), updated on the engine frame loop. */
export function PeakReadout({ meterId }: { meterId: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let last = '';
    return engine.onFrame(() => {
      const m = engine.getMeter(meterId);
      const txt = m && m.hold > 0.00001 ? formatDb(m.hold) : '-inf';
      if (txt !== last && ref.current) {
        ref.current.textContent = txt;
        last = txt;
      }
    });
  }, [meterId]);
  return <span ref={ref}>-inf</span>;
}

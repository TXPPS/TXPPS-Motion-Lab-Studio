import { useEffect, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import { faderPosToGain, formatDb, gainToFaderPos, linToDb } from '../../model/music';
import { usePointerDrag } from '../../hooks/usePointerDrag';

/** Vertical fader mapped through the musical gain curve. Double-tap resets to 0 dB. */
export function Fader({
  value,
  onChange,
  onGestureStart,
  onGestureEnd,
  height = 120,
  label,
}: {
  value: number;
  onChange: (gain: number) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  height?: number;
  label?: string;
}) {
  const pos = gainToFaderPos(value);
  const usable = height - 12;
  const onPointerDown = usePointerDrag<number>({
    onStart: () => {
      onGestureStart?.();
      return pos;
    },
    onMove: (_dx, dy, _e, startPos) => {
      const next = Math.min(1, Math.max(0, startPos - dy / usable));
      onChange(faderPosToGain(next));
    },
    onEnd: () => onGestureEnd?.(),
  });
  return (
    <div
      className="fader"
      style={{ height }}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onChange(1)}
      role="slider"
      aria-label={label ?? 'volume'}
      aria-valuemin={-60}
      aria-valuemax={3.5}
      aria-valuenow={Math.round(linToDb(value) * 10) / 10}
      aria-valuetext={`${formatDb(value)} dB`}
    >
      <div className="fader-track" />
      <div className="fader-fill" style={{ height: pos * usable }} />
      <div className="fader-thumb" style={{ bottom: 6 + pos * usable }} />
    </div>
  );
}

/** Rotary knob for pan (-1..1). Drag vertically; double-tap centers. */
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
    onMove: (_dx, dy, _e, start) => {
      onChange(Math.min(1, Math.max(-1, start - dy / 70)));
    },
    onEnd: () => onGestureEnd?.(),
  });
  const angle = value * 132; // degrees from top
  const r = size / 2;
  const rad = ((angle - 90) * Math.PI) / 180;
  const ind = { x: r + Math.cos(rad) * (r - 5), y: r + Math.sin(rad) * (r - 5) };
  return (
    <div
      className="knob"
      style={{ width: size, height: size }}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onChange(0)}
      role="slider"
      aria-label={label ?? 'pan'}
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={Math.round(value * 100) / 100}
    >
      <svg width={size} height={size}>
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
    onMove: (_dx, dy, _e, start) => {
      onNorm(Math.min(1, Math.max(0, start - dy / 110)));
    },
  });
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
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Math.round(norm * 100) / 100}
        aria-valuetext={display}
      >
        <svg width={size} height={size}>
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
  const db = 20 * Math.log10(v);
  return Math.min(1, Math.max(0, (db + DB_FLOOR) / DB_FLOOR));
}

/**
 * Real signal meter. Reads engine analyser data on the engine's frame loop and
 * writes straight to the DOM — no React re-renders, no fake animation.
 */
export function Meter({
  meterId,
  height = 120,
  wide,
}: {
  meterId: string;
  height?: number;
  wide?: boolean;
}) {
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
      fill.style.height = '100%';
      fill.style.transform = `scaleY(${rmsN})`;
      hold.style.transform = `translateY(${(1 - holdN) * (height - 2)}px)`;
      hold.style.opacity = holdN > 0.001 ? '0.75' : '0';
      led.className = `meter-clip-led${m?.clipped ? ' on' : ''}`;
    });
  }, [meterId, height]);
  return (
    <div
      className={`meter${wide ? ' wide' : ''}`}
      style={{ height, ['--meter-h' as string]: `${height}px` }}
      title="Signal meter — click top LED to reset peaks"
    >
      <div ref={fillRef} className="meter-fill" />
      <div ref={holdRef} className="meter-hold" />
      <div
        ref={ledRef}
        className="meter-clip-led"
        onClick={() => engine.resetClipIndicators()}
        title="Clip indicator — click to reset"
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
  return (
    <span ref={ref} className="mono">
      -inf
    </span>
  );
}

/** Simple internal error boundary so one broken panel can't take the app down. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

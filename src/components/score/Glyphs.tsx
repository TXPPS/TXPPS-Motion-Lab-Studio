/**
 * Notation glyphs as inline SVG. No music font is downloaded — a DAW has to
 * paint its editor on the first frame and work offline, the same reason the
 * product ships no webfont at all.
 *
 * Every glyph is authored in *staff-space units*: one unit is the distance
 * between two staff lines, the measure engravers have used for four hundred
 * years. A glyph draws itself in that unit space and is placed with
 * `translate(x, y) scale(space)`, so a single `staffSpace` number sets the size
 * of the whole score and every proportion holds at any zoom. Stroke widths are
 * in the same unit space and scale with it.
 *
 * Colour is always `currentColor`, so the tokens in styles/score.css decide it
 * and selection can recolour a whole element by setting `color`.
 */

import type { ReactNode } from 'react';
import type { NoteValue } from '../../model/notation';

/** Head width in staff spaces — the unit that sets stem side and note spacing. */
export const HEAD_W = 1.18;
/** Standard stem length: a fifth, measured in staff spaces. */
export const STEM_LEN = 3.5;
/** Beam thickness and the gap between beams, in staff spaces. */
export const BEAM_H = 0.5;
export const BEAM_GAP = 0.32;
/** Thickness of a stem and of a staff line. */
export const STEM_W = 0.13;
export const LINE_W = 0.11;

interface Placed {
  x: number;
  y: number;
  space: number;
}

const at = (x: number, y: number, space: number) => `translate(${x} ${y}) scale(${space})`;

/** One ellipse as a path, optionally tilted, in unit space. */
function ellipse(rx: number, ry: number, tilt = 0): string {
  const r = (tilt * Math.PI) / 180;
  const dx = rx * Math.cos(r);
  const dy = rx * Math.sin(r);
  const n = (v: number) => Number(v.toFixed(4));
  const arc = `A ${rx} ${ry} ${tilt} 1 0`;
  return `M ${n(-dx)} ${n(-dy)} ${arc} ${n(dx)} ${n(dy)} ${arc} ${n(-dx)} ${n(-dy)}`;
}

// -------------------------------------------------------------- note heads

export type HeadKind = 'whole' | 'half' | 'filled';

export function headKindFor(value: NoteValue): HeadKind {
  if (value === 1) return 'whole';
  if (value === 2) return 'half';
  return 'filled';
}

/**
 * A note head. Black and half heads are ellipses tilted about 20°, which is
 * what gives a chord its diagonal look; the whole head is wider, barely
 * tilted, and carries a steeply tilted counter.
 */
export function NoteHead({ x, y, space, kind }: Placed & { kind: HeadKind }) {
  if (kind === 'filled') {
    return (
      <path
        className="sc-head"
        transform={`${at(x, y, space)} rotate(-20)`}
        d={ellipse(0.62, 0.4)}
      />
    );
  }
  if (kind === 'half') {
    return (
      <path
        className="sc-head"
        fillRule="evenodd"
        transform={`${at(x, y, space)} rotate(-20)`}
        d={`${ellipse(0.64, 0.42)} ${ellipse(0.42, 0.19)}`}
      />
    );
  }
  // The whole head is wider and barely tilted, and its counter leans the other
  // way — the tilt of the hole is what says "whole note" at a glance.
  return (
    <path
      className="sc-head"
      fillRule="evenodd"
      transform={at(x, y, space)}
      d={`${ellipse(0.86, 0.42)} ${ellipse(0.36, 0.17, -62)}`}
    />
  );
}

/** Augmentation dots, always in a space — never on a line. */
export function Dots({ x, y, space, count }: Placed & { count: number }) {
  const out: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    out.push(
      <circle
        key={i}
        className="sc-head"
        cx={x + (0.35 + i * 0.45) * space}
        cy={y}
        r={0.16 * space}
      />,
    );
  }
  return <>{out}</>;
}

export function Stem({ x, y1, y2, space }: { x: number; y1: number; y2: number; space: number }) {
  return <line className="sc-stem" x1={x} y1={y1} x2={x} y2={y2} strokeWidth={STEM_W * space} />;
}

/** Ledger lines for a head that sits off the staff. */
export function Ledgers({
  x,
  space,
  staffPos,
  lineY,
}: {
  x: number;
  space: number;
  staffPos: number;
  /** Maps a staff position to its y. */
  lineY: (pos: number) => number;
}) {
  const out: ReactNode[] = [];
  const w = HEAD_W * 0.82 * space;
  for (let p = 10; p <= staffPos; p += 2) {
    out.push(
      <line
        key={`a${p}`}
        className="sc-ledger"
        x1={x - w}
        y1={lineY(p)}
        x2={x + w}
        y2={lineY(p)}
        strokeWidth={LINE_W * space}
      />,
    );
  }
  for (let p = -2; p >= staffPos; p -= 2) {
    out.push(
      <line
        key={`b${p}`}
        className="sc-ledger"
        x1={x - w}
        y1={lineY(p)}
        x2={x + w}
        y2={lineY(p)}
        strokeWidth={LINE_W * space}
      />,
    );
  }
  return <>{out}</>;
}

// ------------------------------------------------------------------- flags

const FLAG_HOOK = 'M 0 0 C 0.92 0.5 1.14 1.28 0.72 2.3 C 1.0 1.32 0.58 0.86 0 0.62 Z';

/**
 * Flags for an unbeamed eighth and shorter. They hang off the stem tip on the
 * stem's own side, and each further flag repeats three quarters of a space
 * back along the stem — the spacing a 32nd needs to stay readable.
 */
export function Flags({
  x,
  y,
  space,
  dir,
  value,
}: Placed & { dir: 'up' | 'down'; value: NoteValue }) {
  const count = value >= 8 ? Math.round(Math.log2(value)) - 2 : 0;
  if (count <= 0) return null;
  const out: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    // A down stem mirrors the hook vertically; the tip stays the anchor.
    const flip = dir === 'up' ? 1 : -1;
    out.push(
      <path
        key={i}
        className="sc-flag"
        transform={`translate(${x} ${y + flip * i * 0.78 * space}) scale(${space} ${space * flip})`}
        d={FLAG_HOOK}
      />,
    );
  }
  return <>{out}</>;
}

/** One beam, drawn as the quadrilateral it is — sloped, not a rotated box. */
export function Beam({
  x1,
  y1,
  x2,
  y2,
  space,
  dir,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  space: number;
  dir: 'up' | 'down';
}) {
  const h = BEAM_H * space * (dir === 'up' ? 1 : -1);
  return (
    <path
      className="sc-beam"
      d={`M ${x1} ${y1} L ${x2} ${y2} L ${x2} ${y2 + h} L ${x1} ${y1 + h} Z`}
    />
  );
}

// ------------------------------------------------------------------- rests

/**
 * Rests. The whole rest hangs under the fourth line and the half rest sits on
 * the third, which is the only way a reader tells them apart at a glance; the
 * shorter rests are anchored on the middle line.
 */
export function Rest({ x, y, space, value }: Placed & { value: NoteValue }) {
  if (value === 1 || value === 2) {
    const w = 0.62;
    const h = 0.46;
    return (
      <rect
        className="sc-rest"
        x={x - w * space}
        y={value === 1 ? y : y - h * space}
        width={2 * w * space}
        height={h * space}
      />
    );
  }
  if (value === 4) {
    return (
      <path
        className="sc-rest-stroke"
        transform={at(x, y, space)}
        strokeWidth={0.29}
        d="M -0.36 -1.42 L 0.3 -0.7 L -0.3 -0.02 L 0.33 0.6 C -0.12 0.46 -0.44 0.86 -0.2 1.38"
      />
    );
  }
  // Eighth and shorter: an oblique stem carrying one blob and hook per beam,
  // each three quarters of a space further down.
  const hooks = Math.round(Math.log2(value)) - 2;
  const parts: ReactNode[] = [];
  for (let i = 0; i < hooks; i++) {
    const cy = -0.72 + i * 0.74;
    const cx = 0.34 - i * 0.2;
    parts.push(<circle key={`d${i}`} className="sc-rest" cx={cx} cy={cy} r={0.2} />);
    parts.push(
      <path
        key={`h${i}`}
        className="sc-rest-stroke"
        strokeWidth={0.14}
        d={`M ${cx + 0.16} ${cy} C ${cx + 0.08} ${cy + 0.36} ${cx - 0.28} ${cy + 0.28} ${cx - 0.48} ${cy + 0.2}`}
      />,
    );
  }
  return (
    <g transform={at(x, y, space)}>
      <path
        className="sc-rest-stroke"
        strokeWidth={0.16}
        d={`M 0.52 -0.86 L ${-0.22 - (hooks - 1) * 0.2} ${0.92 + (hooks - 1) * 0.74}`}
      />
      {parts}
    </g>
  );
}

// ------------------------------------------------------------- accidentals

const SHARP_BARS = 'M -0.5 -0.2 L 0.5 -0.42 M -0.5 0.46 L 0.5 0.24';
const NATURAL_BARS = 'M -0.24 -0.2 L 0.24 -0.34 M -0.24 0.42 L 0.24 0.28';

/** Sharp, flat, natural and their doubles, centred on the head's position. */
export function Accidental({ x, y, space, alter }: Placed & { alter: number }) {
  const g = (children: ReactNode) => <g transform={at(x, y, space)}>{children}</g>;
  if (alter === 2) {
    // Double sharp: the compact saltire, not two sharps.
    return g(
      <path
        className="sc-acc-stroke"
        strokeWidth={0.3}
        strokeLinecap="butt"
        d="M -0.36 -0.36 L 0.36 0.36 M -0.36 0.36 L 0.36 -0.36"
      />,
    );
  }
  if (alter === 1) {
    return g(
      <>
        <path
          className="sc-acc-stroke"
          strokeWidth={0.11}
          d="M -0.2 -0.95 L -0.2 0.78 M 0.2 -0.78 L 0.2 0.95"
        />
        <path className="sc-acc-stroke" strokeWidth={0.26} d={SHARP_BARS} />
      </>,
    );
  }
  if (alter === 0) {
    return g(
      <>
        <path
          className="sc-acc-stroke"
          strokeWidth={0.11}
          d="M -0.24 -0.95 L -0.24 0.5 M 0.24 -0.5 L 0.24 0.95"
        />
        <path className="sc-acc-stroke" strokeWidth={0.24} d={NATURAL_BARS} />
      </>,
    );
  }
  const flat = (dx: number) => (
    <g key={dx} transform={`translate(${dx} 0)`}>
      <path className="sc-acc-stroke" strokeWidth={0.12} d="M -0.22 -1.32 L -0.22 0.52" />
      <path
        className="sc-acc"
        d="M -0.22 0.52 C 0.42 0.08 0.58 -0.3 0.24 -0.46 C 0.0 -0.57 -0.16 -0.34 -0.22 -0.08 L -0.22 0.16 C -0.06 -0.1 0.1 -0.2 0.2 -0.14 C 0.34 -0.05 0.22 0.16 -0.22 0.52 Z"
      />
    </g>
  );
  return g(alter === -1 ? flat(0) : [flat(-0.42), flat(0.42)]);
}

// ------------------------------------------------------------------- clefs

/**
 * G and F clefs, drawn as single strokes with round joins. Both are anchored
 * on the line they name — the G clef's spiral centres on G4, the F clef's head
 * and dots straddle F3 — because that anchoring is the entire point of a clef.
 */
export function ClefGlyph({ x, y, space, clef }: Placed & { clef: 'treble' | 'bass' }) {
  if (clef === 'treble') {
    return (
      <path
        className="sc-clef"
        transform={at(x, y, space)}
        strokeWidth={0.26}
        d={
          'M 0.44 0.12 C 0.46 -0.34 0.06 -0.52 -0.28 -0.28 ' +
          'C -0.74 0.04 -0.82 0.66 -0.5 1.02 C -0.12 1.46 0.58 1.32 0.9 0.86 ' +
          'C 1.3 0.3 1.16 -0.5 0.82 -1.06 C 0.5 -1.6 0.06 -2.02 0.06 -2.6 ' +
          'C 0.06 -3.16 0.5 -3.5 0.86 -3.16 C 1.22 -2.8 1.04 -2.08 0.7 -1.5 ' +
          'C 0.34 -0.88 0.12 -0.2 0.12 0.6 C 0.12 1.62 0.36 2.6 0.36 3.3 ' +
          'C 0.36 3.96 -0.1 4.36 -0.6 4.16 C -1.0 4.0 -1.06 3.46 -0.7 3.26'
        }
      />
    );
  }
  return (
    <g transform={at(x, y, space)}>
      <path
        className="sc-clef"
        strokeWidth={0.42}
        d="M -0.5 -0.62 C 0.4 -0.9 1.15 -0.5 1.15 0.3 C 1.15 1.4 0.3 2.35 -1.1 3.05"
      />
      <circle className="sc-clef-dot" cx={1.72} cy={-0.5} r={0.17} />
      <circle className="sc-clef-dot" cx={1.72} cy={0.5} r={0.17} />
    </g>
  );
}

// ---------------------------------------------------------- time signature

/**
 * Time-signature digits, on a two-space-tall body. They are stroked heavily
 * rather than outlined: a time signature has to read as bold as the clef from
 * across a room, and a hairline digit in a system UI face does not.
 */
const DIGITS: Record<string, string> = {
  '0': 'M 0.55 -0.98 C 0.95 -0.98 1.1 -0.55 1.1 0 C 1.1 0.55 0.95 0.98 0.55 0.98 C 0.15 0.98 0 0.55 0 0 C 0 -0.55 0.15 -0.98 0.55 -0.98 Z',
  '1': 'M 0.12 -0.6 L 0.6 -0.98 L 0.6 0.98 M 0.18 0.98 L 1.02 0.98',
  '2': 'M 0.06 -0.64 C 0.2 -1.04 0.96 -1.08 1.02 -0.5 C 1.06 -0.04 0.5 0.3 0.06 0.98 L 1.08 0.98',
  '3': 'M 0.1 -0.74 C 0.44 -1.08 1.0 -0.94 1.0 -0.54 C 1.0 -0.2 0.7 -0.04 0.44 -0.04 C 0.76 -0.04 1.08 0.12 1.08 0.5 C 1.08 0.94 0.44 1.12 0.08 0.78',
  '4': 'M 0.78 0.98 L 0.78 -0.98 L 0.02 0.4 L 1.12 0.4',
  '5': 'M 0.96 -0.98 L 0.26 -0.98 L 0.18 -0.18 C 0.56 -0.4 1.08 -0.14 1.08 0.34 C 1.08 0.94 0.44 1.12 0.1 0.84',
  '6': 'M 0.94 -0.94 C 0.4 -1.04 0.08 -0.6 0.06 0.14 C 0.04 0.84 0.44 1.08 0.68 1.08 C 0.98 1.08 1.12 0.74 1.12 0.44 C 1.12 0.06 0.86 -0.14 0.6 -0.14 C 0.3 -0.14 0.1 0.04 0.06 0.3',
  '7': 'M 0.05 -0.98 L 1.1 -0.98 L 0.46 0.98',
  '8': 'M 0.55 -0.04 C 0.2 -0.04 0.05 -0.3 0.05 -0.54 C 0.05 -0.84 0.28 -1.04 0.55 -1.04 C 0.82 -1.04 1.05 -0.84 1.05 -0.54 C 1.05 -0.3 0.9 -0.04 0.55 -0.04 C 0.15 -0.04 0 0.3 0 0.54 C 0 0.9 0.25 1.08 0.55 1.08 C 0.85 1.08 1.1 0.9 1.1 0.54 C 1.1 0.3 0.95 -0.04 0.55 -0.04 Z',
  '9': 'M 0.16 0.94 C 0.7 1.04 1.02 0.6 1.04 -0.14 C 1.06 -0.84 0.66 -1.08 0.42 -1.08 C 0.12 -1.08 -0.02 -0.74 -0.02 -0.44 C -0.02 -0.06 0.24 0.14 0.5 0.14 C 0.8 0.14 1.0 -0.04 1.04 -0.3',
};

const DIGIT_W = 1.24;

function digits(text: string, x: number, y: number, space: number) {
  const w = text.length * DIGIT_W;
  return text
    .split('')
    .map((ch, i) => (
      <path
        key={i}
        className="sc-timesig"
        transform={at(x - (w / 2 - i * DIGIT_W - DIGIT_W / 2) * space, y, space)}
        strokeWidth={0.3}
        d={DIGITS[ch] ?? DIGITS['0']}
      />
    ));
}

/** Numerator and denominator, centred on the two halves of the staff. */
export function TimeSigGlyph({
  x,
  space,
  num,
  den,
  topY,
  bottomY,
}: {
  x: number;
  space: number;
  num: number;
  den: number;
  /** y of the numerator's centre (between the top line and the middle). */
  topY: number;
  bottomY: number;
}) {
  return (
    <>
      {digits(String(num), x, topY, space)}
      {digits(String(den), x, bottomY, space)}
    </>
  );
}

/** Width a time signature needs, in px. */
export function timeSigWidth(num: number, den: number, space: number): number {
  return Math.max(String(num).length, String(den).length) * DIGIT_W * space;
}

// -------------------------------------------------------------------- ties

/**
 * A tie or slur: a crescent, thin at the tips and thick in the middle, bowing
 * away from the stems. Drawn as two quadratics so the thickness is real rather
 * than a uniform stroke.
 */
export function Tie({
  x1,
  y1,
  x2,
  y2,
  space,
  dir,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  space: number;
  dir: 'up' | 'down';
}) {
  const mx = (x1 + x2) / 2;
  const sign = dir === 'up' ? -1 : 1;
  const span = Math.max(Math.abs(x2 - x1), space);
  const rise = sign * Math.min(1.5 * space, 0.28 * span + 0.5 * space);
  const my = (y1 + y2) / 2 + rise;
  const thin = my - sign * 0.26 * space;
  return (
    <path
      className="sc-tie"
      d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2} Q ${mx} ${thin} ${x1} ${y1} Z`}
    />
  );
}

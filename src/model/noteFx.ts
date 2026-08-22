/**
 * Note effects: MIDI-domain processors between a clip (or the live keyboard)
 * and the instrument.
 *
 * Everything here is a pure function from notes to notes. The runtime expands
 * a track's chain at schedule time and never rewrites the stored notes, so
 * switching an effect off restores the written performance exactly and an
 * offline bounce runs the identical code path as playback.
 *
 * Randomness is keyed by a seed *and by the position of the material*, never by
 * a running counter. The scheduler expands one lookahead window at a time while
 * a bounce expands the whole song, so a sequential PRNG would hand the same
 * note different values in the two cases; a positional hash cannot.
 *
 * Conventions match model/midiTools.ts: `start`/`length` in beats relative to
 * the region, pitch 0..127, velocity 1..127.
 */
import type { ParamSpec } from './effects';
import { SCALES } from './scales';
import type { Note, NoteFx, NoteFxKind } from './types';

/** Context the chain needs beyond the notes themselves. */
export interface NoteFxContext {
  /**
   * Musical length of the region being expanded, in beats. Generated notes are
   * bounded by it so an arpeggiator cannot run past its clip. 0 means
   * unbounded, which is what live playing wants.
   */
  lengthBeats: number;
  /** Quarter-note beats per bar where the region sits; bar-length rates need it. */
  beatsPerBar?: number;
}

/**
 * Tempo-synced divisions. Stored parameters are always numbers, so a rate is an
 * index into this table — the same trick effects.ts uses for its choices.
 */
export interface NoteFxDivision {
  label: string;
  /** length in quarter-note beats, or in bars when `bars` is set */
  beats?: number;
  bars?: number;
}

export const NOTE_FX_DIVISIONS: readonly NoteFxDivision[] = [
  { label: '2 bar', bars: 2 },
  { label: '1 bar', bars: 1 },
  { label: '1/2', beats: 2 },
  { label: '1/4', beats: 1 },
  { label: '1/8', beats: 0.5 },
  { label: '1/16', beats: 0.25 },
  { label: '1/32', beats: 0.125 },
  { label: '1/4T', beats: 2 / 3 },
  { label: '1/8T', beats: 1 / 3 },
  { label: '1/16T', beats: 1 / 6 },
  { label: '1/4.', beats: 1.5 },
  { label: '1/8.', beats: 0.75 },
  { label: '1/16.', beats: 0.375 },
];

const DIVISION_LABELS = NOTE_FX_DIVISIONS.map((d) => d.label);

/** Length in beats of a division index, resolving bar lengths against the context. */
export function divisionBeats(index: number, ctx: NoteFxContext): number {
  const d = NOTE_FX_DIVISIONS[clampInt(index, 0, NOTE_FX_DIVISIONS.length - 1)];
  const bar = ctx.beatsPerBar && ctx.beatsPerBar > 0 ? ctx.beatsPerBar : 4;
  return d.bars ? d.bars * bar : (d.beats ?? 1);
}

export const ARP_MODES = ['Up', 'Down', 'Up/Down', 'Down/Up', 'Random', 'As played', 'Chord'];
export const CHORDER_MODES = ['Intervals', 'Diatonic triad', 'Diatonic 7th'];
export const VELOCITY_MODES = ['Compress', 'Expand', 'Fixed', 'Random'];

const ARP_UP = 0;
const ARP_DOWN = 1;
const ARP_UPDOWN = 2;
const ARP_DOWNUP = 3;
const ARP_RANDOM = 4;
const ARP_AS_PLAYED = 5;
const ARP_CHORD = 6;

const CHORD_INTERVALS = 0;
const CHORD_SEVENTH = 2;

const VEL_COMPRESS = 0;
const VEL_EXPAND = 1;
const VEL_FIXED = 2;
const VEL_RANDOM = 3;

/** Default interval set for the chorder when the effect carries no list. */
export const DEFAULT_CHORDER_INTERVALS = [4, 7];

/**
 * Ceiling on notes any one stage may emit. A 1/32 arpeggiator over an
 * eight-minute clip is a plausible accident; melting the scheduler over it is
 * not.
 */
const MAX_STAGE_NOTES = 8192;

/** Positions are compared with a tolerance because gates and swing produce ties. */
const EPS = 1e-6;

// ------------------------------------------------------------------ specs

export interface NoteFxSpec {
  kind: NoteFxKind;
  label: string;
  /** One line explaining what it does, shown in the picker. */
  blurb: string;
  params: ParamSpec[];
  /** True when the effect reads `list` as well as `params`. */
  usesList?: boolean;
}

const choice = (key: string, label: string, choices: readonly string[], def = 0): ParamSpec => ({
  key,
  label,
  min: 0,
  max: choices.length - 1,
  step: 1,
  default: def,
  choices,
});

const seedParam = (def: number): ParamSpec => ({
  key: 'seed',
  label: 'Seed',
  min: 0,
  max: 9999,
  step: 1,
  default: def,
});

export const NOTE_FX_SPECS: NoteFxSpec[] = [
  {
    kind: 'arpeggiator',
    label: 'Arpeggiator',
    blurb: 'Turns held chords into a synced stream of single notes.',
    params: [
      choice('rate', 'Rate', DIVISION_LABELS, 5),
      choice('mode', 'Mode', ARP_MODES, ARP_UP),
      { key: 'octaves', label: 'Octaves', min: 1, max: 4, step: 1, default: 1 },
      { key: 'gate', label: 'Gate', min: 0.05, max: 2, step: 0.01, default: 0.9, unit: '%' },
      { key: 'swing', label: 'Swing', min: 0, max: 1, step: 0.01, default: 0, unit: '%' },
      choice('latch', 'Latch', ['Off', 'On'], 0),
      seedParam(1),
    ],
  },
  {
    kind: 'chorder',
    label: 'Chorder',
    blurb: 'Adds voices above or below every note, strummed or block.',
    usesList: true,
    params: [
      choice('mode', 'Mode', CHORDER_MODES, CHORD_INTERVALS),
      { key: 'key', label: 'Key', min: 0, max: 11, step: 1, default: 0 },
      choice(
        'scale',
        'Scale',
        SCALES.map((s) => s.label),
        0,
      ),
      { key: 'strum', label: 'Strum', min: 0, max: 0.5, step: 0.005, default: 0 },
      { key: 'falloff', label: 'Falloff', min: 0, max: 1, step: 0.01, default: 1, unit: '%' },
    ],
  },
  {
    kind: 'repeater',
    label: 'Repeater',
    blurb: 'Echoes each note in time, fading and optionally transposing.',
    params: [
      choice('division', 'Division', DIVISION_LABELS, 4),
      { key: 'repeats', label: 'Repeats', min: 1, max: 16, step: 1, default: 3 },
      { key: 'decay', label: 'Decay', min: 0, max: 1, step: 0.01, default: 0.7, unit: '%' },
      { key: 'pitch', label: 'Pitch step', min: -24, max: 24, step: 1, default: 0, unit: 'st' },
      { key: 'gate', label: 'Gate', min: 0.1, max: 2, step: 0.01, default: 1, unit: '%' },
    ],
  },
  {
    kind: 'noteFilter',
    label: 'Note filter',
    blurb: 'Passes a key range, a velocity range and a set of pitch classes.',
    usesList: true,
    params: [
      { key: 'keyLo', label: 'Key low', min: 0, max: 127, step: 1, default: 0 },
      { key: 'keyHi', label: 'Key high', min: 0, max: 127, step: 1, default: 127 },
      { key: 'velLo', label: 'Vel low', min: 1, max: 127, step: 1, default: 1 },
      { key: 'velHi', label: 'Vel high', min: 1, max: 127, step: 1, default: 127 },
      { key: 'transpose', label: 'Transpose', min: -24, max: 24, step: 1, default: 0, unit: 'st' },
      { key: 'velOffset', label: 'Vel offset', min: -64, max: 64, step: 1, default: 0 },
    ],
  },
  {
    kind: 'velocityCurve',
    label: 'Velocity curve',
    blurb: 'Reshapes dynamics: compress, expand, flatten or randomise.',
    params: [
      choice('mode', 'Mode', VELOCITY_MODES, VEL_COMPRESS),
      { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.5, unit: '%' },
      { key: 'center', label: 'Centre', min: 1, max: 127, step: 1, default: 64 },
      { key: 'fixed', label: 'Fixed', min: 1, max: 127, step: 1, default: 100 },
      { key: 'range', label: 'Range', min: 0, max: 64, step: 1, default: 12 },
      seedParam(1),
    ],
  },
];

const SPEC_BY_KIND = new Map(NOTE_FX_SPECS.map((s) => [s.kind, s]));

export function noteFxSpec(kind: NoteFxKind): NoteFxSpec | undefined {
  return SPEC_BY_KIND.get(kind);
}

/** Default parameter set for a kind, ready to store on a track. */
export function defaultNoteFxParams(kind: NoteFxKind): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of SPEC_BY_KIND.get(kind)?.params ?? []) out[p.key] = p.default;
  return out;
}

/** A stored effect of `kind` with defaults filled in. The id is the caller's. */
export function createNoteFx(kind: NoteFxKind, id: string): NoteFx {
  const fx: NoteFx = { id, kind, bypass: false, params: defaultNoteFxParams(kind) };
  if (kind === 'chorder') fx.list = [...DEFAULT_CHORDER_INTERVALS];
  return fx;
}

/** One parameter, clamped to its spec range, falling back to the default. */
export function noteFxParam(fx: NoteFx, key: string): number {
  const spec = SPEC_BY_KIND.get(fx.kind)?.params.find((p) => p.key === key);
  const raw = fx.params?.[key];
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : (spec?.default ?? 0);
  if (!spec) return value;
  return Math.min(spec.max, Math.max(spec.min, value));
}

// ------------------------------------------------------------- primitives

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function clampInt(v: number, min: number, max: number): number {
  return Math.round(clamp(Number.isFinite(v) ? v : min, min, max));
}

function clampVel(v: number): number {
  return Math.min(127, Math.max(1, Math.round(v)));
}

function mod12(v: number): number {
  return ((Math.round(v) % 12) + 12) % 12;
}

/**
 * Position-keyed uniform value in [0,1).
 *
 * Finney/mulberry-style integer mixing of the seed with the coordinates of the
 * event, so the same note yields the same number whichever window it is
 * expanded in — see the module header.
 */
function hashUnit(seed: number, a: number, b = 0): number {
  let h = (Math.round(seed) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (Math.round(a) >>> 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (Math.round(b) >>> 0), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}

/** Beats are hashed at 960 ticks so a position, not a float, keys the value. */
function tickOf(beat: number): number {
  return Math.round(beat * 960);
}

function sortNotes(notes: Note[]): Note[] {
  return notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch || (a.id < b.id ? -1 : 1));
}

// ------------------------------------------------------------ arpeggiator

interface ArpEntry {
  pitch: number;
  src: Note;
}

/** The pitch sequence one step of the arp walks, after octave and mode. */
function arpSequence(held: Note[], mode: number, octaves: number): ArpEntry[] {
  // 'As played' sorts on start alone: the sort is stable, so notes struck
  // together keep the order they arrived in, which is the order the player
  // rolled them.
  const ordered =
    mode === ARP_AS_PLAYED
      ? [...held].sort((a, b) => a.start - b.start)
      : [...held].sort((a, b) => a.pitch - b.pitch);
  const base: ArpEntry[] = [];
  const seen = new Set<number>();
  for (const n of ordered) {
    if (seen.has(n.pitch)) continue;
    seen.add(n.pitch);
    base.push({ pitch: n.pitch, src: n });
  }
  const up: ArpEntry[] = [];
  for (let o = 0; o < octaves; o++) {
    for (const e of base) {
      const pitch = e.pitch + 12 * o;
      if (pitch <= 127) up.push({ pitch, src: e.src });
    }
  }
  if (up.length === 0) return up;
  const down = [...up].reverse();
  switch (mode) {
    case ARP_DOWN:
      return down;
    case ARP_UPDOWN:
      return up.length > 2 ? [...up, ...up.slice(1, -1).reverse()] : up;
    case ARP_DOWNUP:
      return down.length > 2 ? [...down, ...down.slice(1, -1).reverse()] : down;
    default:
      return up;
  }
}

function arpeggiate(notes: Note[], fx: NoteFx, ctx: NoteFxContext): Note[] {
  const step = divisionBeats(noteFxParam(fx, 'rate'), ctx);
  const mode = clampInt(noteFxParam(fx, 'mode'), 0, ARP_MODES.length - 1);
  const octaves = clampInt(noteFxParam(fx, 'octaves'), 1, 4);
  const gate = noteFxParam(fx, 'gate');
  const swing = noteFxParam(fx, 'swing');
  const latch = noteFxParam(fx, 'latch') >= 0.5;
  const seed = noteFxParam(fx, 'seed');
  const src = notes.filter((n) => n.length > 0);
  if (src.length === 0 || step <= 0) return notes.map((n) => ({ ...n }));

  const lastEnd = src.reduce((m, n) => Math.max(m, n.start + n.length), 0);
  const bound = ctx.lengthBeats > 0 ? ctx.lengthBeats : lastEnd;
  // Latch holds the last chord to the end of the region; without it the arp
  // stops when the player lets go.
  const end = latch ? bound : Math.min(lastEnd, bound);

  const out: Note[] = [];
  let cursor = 0;
  let lastKey = '';
  let lastHeld: Note[] = [];
  for (let i = 0; i * step < end - EPS && out.length < MAX_STAGE_NOTES; i++) {
    const at = i * step + (i % 2 === 1 ? swing * step * 0.5 : 0);
    if (at >= end - EPS) break;
    let held = src.filter((n) => n.start <= at + EPS && n.start + n.length > at + EPS);
    if (held.length === 0) {
      if (!latch) {
        cursor = 0;
        lastKey = '';
        continue;
      }
      held = lastHeld;
      if (held.length === 0) continue;
    }
    lastHeld = held;
    const seq = arpSequence(held, mode, octaves);
    if (seq.length === 0) continue;
    // A new chord restarts the pattern; a sustained one keeps walking.
    const key = seq.map((e) => e.pitch).join(',');
    if (key !== lastKey) {
      cursor = 0;
      lastKey = key;
    }
    const length = Math.max(0.01, Math.min(step * gate, Math.max(0.01, end - at)));
    if (mode === ARP_CHORD) {
      seq.forEach((e, k) => {
        out.push({ ...e.src, id: `${e.src.id}:arp${i}.${k}`, start: at, length, pitch: e.pitch });
      });
    } else {
      const idx =
        mode === ARP_RANDOM ? Math.floor(hashUnit(seed, i, seq.length) * seq.length) : cursor;
      const e = seq[idx % seq.length];
      out.push({ ...e.src, id: `${e.src.id}:arp${i}`, start: at, length, pitch: e.pitch });
    }
    cursor++;
  }
  return out;
}

// ----------------------------------------------------------------- chorder

/**
 * Semitone offsets from `pitch` for a diatonic stack.
 *
 * Offsets are measured from the pitch class rather than from the nearest scale
 * member, so a chromatic passing note still gets voices that belong to the key
 * instead of dragging the whole chord off it.
 */
function diatonicOffsets(
  pitch: number,
  tonic: number,
  steps: number[],
  degrees: number[],
): number[] {
  if (steps.length === 0) return [];
  const pc = mod12(pitch - tonic);
  let i = 0;
  for (let k = 0; k < steps.length; k++) if (steps[k] <= pc) i = k;
  return degrees.map((d) => {
    const idx = i + d;
    const octave = Math.floor(idx / steps.length);
    return steps[((idx % steps.length) + steps.length) % steps.length] + 12 * octave - pc;
  });
}

function chorder(notes: Note[], fx: NoteFx): Note[] {
  const mode = clampInt(noteFxParam(fx, 'mode'), 0, CHORDER_MODES.length - 1);
  const tonic = clampInt(noteFxParam(fx, 'key'), 0, 11);
  const scale = SCALES[clampInt(noteFxParam(fx, 'scale'), 0, SCALES.length - 1)];
  const strum = noteFxParam(fx, 'strum');
  const falloff = noteFxParam(fx, 'falloff');
  const list = (fx.list?.length ? fx.list : DEFAULT_CHORDER_INTERVALS).filter((v) => v !== 0);

  const out: Note[] = [];
  for (const n of notes) {
    out.push({ ...n });
    const offsets =
      mode === CHORD_INTERVALS
        ? list
        : diatonicOffsets(n.pitch, tonic, scale.steps, mode === CHORD_SEVENTH ? [2, 4, 6] : [2, 4]);
    offsets.forEach((off, j) => {
      const pitch = Math.round(n.pitch + off);
      if (pitch < 0 || pitch > 127 || out.length >= MAX_STAGE_NOTES) return;
      const delay = strum * (j + 1);
      out.push({
        ...n,
        id: `${n.id}:ch${j}`,
        pitch,
        start: n.start + delay,
        // Strummed voices end with the root rather than trailing past it.
        length: Math.max(0.01, n.length - delay),
        velocity: clampVel(n.velocity * Math.pow(falloff, j + 1)),
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------- repeater

function repeater(notes: Note[], fx: NoteFx, ctx: NoteFxContext): Note[] {
  const step = divisionBeats(noteFxParam(fx, 'division'), ctx);
  const repeats = clampInt(noteFxParam(fx, 'repeats'), 1, 16);
  const decay = noteFxParam(fx, 'decay');
  const pitchStep = Math.round(noteFxParam(fx, 'pitch'));
  const gate = noteFxParam(fx, 'gate');
  const bound = ctx.lengthBeats > 0 ? ctx.lengthBeats : Infinity;

  const out: Note[] = [];
  for (const n of notes) {
    out.push({ ...n });
    let velocity = n.velocity;
    let length = n.length;
    for (let k = 1; k <= repeats && out.length < MAX_STAGE_NOTES; k++) {
      velocity *= decay;
      length *= gate;
      const start = n.start + k * step;
      const pitch = n.pitch + k * pitchStep;
      // An echo quieter than velocity 1 or off the keyboard is silence, and a
      // silent echo must not stop the louder ones behind it.
      if (start >= bound - EPS) break;
      if (Math.round(velocity) < 1) break;
      if (pitch < 0 || pitch > 127) continue;
      out.push({
        ...n,
        id: `${n.id}:rep${k}`,
        start,
        length: Math.max(0.01, Math.min(length, bound - start)),
        pitch,
        velocity: clampVel(velocity),
      });
    }
  }
  return out;
}

// -------------------------------------------------------------- noteFilter

function noteFilter(notes: Note[], fx: NoteFx): Note[] {
  const keyLo = clampInt(noteFxParam(fx, 'keyLo'), 0, 127);
  const keyHi = clampInt(noteFxParam(fx, 'keyHi'), 0, 127);
  const lo = Math.min(keyLo, keyHi);
  const hi = Math.max(keyLo, keyHi);
  const velLo = clampInt(noteFxParam(fx, 'velLo'), 1, 127);
  const velHi = clampInt(noteFxParam(fx, 'velHi'), 1, 127);
  const vLo = Math.min(velLo, velHi);
  const vHi = Math.max(velLo, velHi);
  const transpose = Math.round(noteFxParam(fx, 'transpose'));
  const velOffset = Math.round(noteFxParam(fx, 'velOffset'));
  const classes = fx.list?.length ? new Set(fx.list.map(mod12)) : undefined;

  const out: Note[] = [];
  for (const n of notes) {
    // Ranges test the written pitch, so moving the transpose does not change
    // which notes the filter lets through.
    if (n.pitch < lo || n.pitch > hi) continue;
    if (n.velocity < vLo || n.velocity > vHi) continue;
    if (classes && !classes.has(mod12(n.pitch))) continue;
    const pitch = n.pitch + transpose;
    if (pitch < 0 || pitch > 127) continue;
    out.push({ ...n, pitch, velocity: clampVel(n.velocity + velOffset) });
  }
  return out;
}

// ------------------------------------------------------------ velocityCurve

function velocityCurve(notes: Note[], fx: NoteFx): Note[] {
  const mode = clampInt(noteFxParam(fx, 'mode'), 0, VELOCITY_MODES.length - 1);
  const amount = noteFxParam(fx, 'amount');
  const center = noteFxParam(fx, 'center');
  const fixed = noteFxParam(fx, 'fixed');
  const range = noteFxParam(fx, 'range');
  const seed = noteFxParam(fx, 'seed');

  return notes.map((n) => {
    let v = n.velocity;
    switch (mode) {
      case VEL_COMPRESS:
        v = center + (n.velocity - center) * (1 - amount);
        break;
      case VEL_EXPAND:
        v = center + (n.velocity - center) * (1 + amount);
        break;
      case VEL_FIXED:
        v = fixed;
        break;
      case VEL_RANDOM:
        v = n.velocity + (hashUnit(seed, tickOf(n.start), n.pitch) * 2 - 1) * range;
        break;
    }
    return { ...n, velocity: clampVel(v) };
  });
}

// ------------------------------------------------------------------- chain

function applyOne(notes: Note[], fx: NoteFx, ctx: NoteFxContext): Note[] {
  // Muted notes bypass every stage: the piano roll's mute is the musician's
  // last word, and an arpeggiator must not play what they silenced.
  const active = notes.filter((n) => !n.muted);
  const muted = notes.filter((n) => n.muted);
  let processed: Note[];
  switch (fx.kind) {
    case 'arpeggiator':
      processed = arpeggiate(active, fx, ctx);
      break;
    case 'chorder':
      processed = chorder(active, fx);
      break;
    case 'repeater':
      processed = repeater(active, fx, ctx);
      break;
    case 'noteFilter':
      processed = noteFilter(active, fx);
      break;
    case 'velocityCurve':
      processed = velocityCurve(active, fx);
      break;
    default:
      processed = active.map((n) => ({ ...n }));
  }
  return sortNotes([...processed, ...muted.map((n) => ({ ...n }))]);
}

/**
 * Run a note-effect chain. Bypassed effects are skipped, so a fully bypassed
 * chain returns the input untouched, in its original order.
 */
export function applyNoteFx(notes: Note[], fx: NoteFx[], ctx: NoteFxContext): Note[] {
  let out = notes.map((n) => ({ ...n }));
  for (const one of fx) {
    if (one.bypass) continue;
    out = applyOne(out, one, ctx);
  }
  return out;
}

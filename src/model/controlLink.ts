/**
 * Control Link — hardware controls driving the product.
 *
 * A binding is a pair: what the controller sends, and what it moves. Both
 * halves are data, so a binding can be listed, edited and saved rather than
 * being a callback registered somewhere in the UI.
 *
 * Bindings live in the project because most of them name project objects — a
 * fader that rides *this* track's volume means nothing in another song. The
 * ones that do not (transport, master, tempo) travel with the project anyway,
 * which costs nothing and keeps one list instead of two.
 */
import type { ProjectData } from './types';
import { findAutoParam } from './paramRegistry';

/** What a controller sent. Channel 0 means "any channel". */
export type ControlSource =
  | { kind: 'cc'; cc: number; channel: number }
  | { kind: 'pitchbend'; channel: number }
  | { kind: 'note'; note: number; channel: number };

/** Transport actions a control can fire. */
export type TransportCommand =
  'play' | 'stop' | 'playStop' | 'record' | 'loop' | 'metronome' | 'rewind' | 'forward';

export type ControlTarget =
  | { kind: 'param'; trackId: string; paramId: string }
  | { kind: 'macro'; trackId: string; macroId: string }
  | { kind: 'transport'; command: TransportCommand }
  | { kind: 'master'; param: 'volume' | 'tempo' };

/**
 * How the incoming value is read.
 *
 * - `absolute` — the control's position is the value (a fader).
 * - `toggle` — a press flips the target between its ends (a button, or a
 *   sustain-style pedal that only ever sends 0 and 127).
 * - `relative` — 1..63 counts up and 65..127 counts down, which is what an
 *   endless encoder sends in the two-complement mode most of them ship in.
 */
export type ControlMode = 'absolute' | 'toggle' | 'relative';

export interface ControlLink {
  id: string;
  source: ControlSource;
  target: ControlTarget;
  mode: ControlMode;
  /** The target range this control sweeps, normalised. */
  min: number;
  max: number;
  invert: boolean;
}

export const MAX_CONTROL_LINKS = 128;

/** A stable key for a source, so a lookup is a map hit rather than a scan. */
export function sourceKey(source: ControlSource): string {
  if (source.kind === 'cc') return `cc:${source.cc}:${source.channel}`;
  if (source.kind === 'note') return `note:${source.note}:${source.channel}`;
  return `pb:${source.channel}`;
}

/** Every key an incoming message could match, most specific first. */
export function matchKeys(source: ControlSource): string[] {
  const omni = { ...source, channel: 0 } as ControlSource;
  return source.channel === 0 ? [sourceKey(source)] : [sourceKey(source), sourceKey(omni)];
}

export function sameSource(a: ControlSource, b: ControlSource): boolean {
  return sourceKey(a) === sourceKey(b);
}

export function describeSource(source: ControlSource): string {
  const ch = source.channel === 0 ? 'omni' : `ch ${source.channel}`;
  if (source.kind === 'cc') return `CC ${source.cc} · ${ch}`;
  if (source.kind === 'note') return `Note ${source.note} · ${ch}`;
  return `Pitch bend · ${ch}`;
}

export function describeTarget(target: ControlTarget, project: ProjectData): string {
  if (target.kind === 'transport') return `Transport · ${target.command}`;
  if (target.kind === 'master') return `Master · ${target.param}`;
  const track = project.tracks.find((t) => t.id === target.trackId);
  const name = track?.name ?? 'missing track';
  if (target.kind === 'macro') {
    const macro = track?.macros?.find((m) => m.id === target.macroId);
    return `${name} · ${macro?.name ?? 'missing macro'}`;
  }
  const param = track ? findAutoParam(track, project, target.paramId) : undefined;
  return `${name} · ${param?.name ?? target.paramId}`;
}

/**
 * A binding whose target no longer exists is dead weight that would silently
 * do nothing; the UI shows it as broken rather than pretending it works.
 */
export function targetExists(target: ControlTarget, project: ProjectData): boolean {
  if (target.kind === 'transport' || target.kind === 'master') return true;
  const track = project.tracks.find((t) => t.id === target.trackId);
  if (!track) return false;
  if (target.kind === 'macro') return !!track.macros?.some((m) => m.id === target.macroId);
  return !!findAutoParam(track, project, target.paramId);
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The raw 0..127 a controller sent, as a 0..1 position in the link's range.
 * `previous` is the target's current value, which only a relative encoder or a
 * toggle needs — they describe a change rather than a position.
 */
export function linkValue(link: ControlLink, raw: number, previous: number): number {
  const lo = Math.min(link.min, link.max);
  const hi = Math.max(link.min, link.max);
  const span = hi - lo;

  if (link.mode === 'toggle') {
    if (raw < 64) return previous;
    const mid = lo + span / 2;
    return previous >= mid ? lo : hi;
  }

  if (link.mode === 'relative') {
    // Two's-complement relative: 1..63 up, 65..127 down, 0 and 64 idle.
    const delta = raw === 0 || raw === 64 ? 0 : raw < 64 ? raw : raw - 128;
    const step = (delta / 63) * span * (link.invert ? -1 : 1);
    return clamp01(Math.min(hi, Math.max(lo, previous + step)));
  }

  const pos = clamp01(raw / 127);
  const scaled = link.invert ? 1 - pos : pos;
  return clamp01(lo + scaled * span);
}

/** A pressed button, for targets that fire rather than sweep. */
export function isPress(link: ControlLink, raw: number): boolean {
  return link.source.kind === 'pitchbend' ? raw > 90 : raw >= 64;
}

export function createLink(id: string, source: ControlSource, target: ControlTarget): ControlLink {
  // A transport target is a button by nature; a parameter is a sweep. Guessing
  // right here saves the mode menu being the first stop after every learn.
  const mode: ControlMode =
    target.kind === 'transport' || source.kind === 'note' ? 'toggle' : 'absolute';
  return { id, source, target, mode, min: 0, max: 1, invert: false };
}

export function normalizeLinks(raw: unknown): ControlLink[] {
  if (!Array.isArray(raw)) return [];
  const out: ControlLink[] = [];
  for (const item of raw as unknown[]) {
    const link = normalizeLink(item);
    if (link && !out.some((l) => l.id === link.id)) out.push(link);
    if (out.length >= MAX_CONTROL_LINKS) break;
  }
  return out;
}

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function normalizeSource(raw: unknown): ControlSource | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const channel = num(r.channel, 0, 16, 0);
  if (r.kind === 'cc') return { kind: 'cc', cc: num(r.cc, 0, 127, 1), channel };
  if (r.kind === 'note') return { kind: 'note', note: num(r.note, 0, 127, 60), channel };
  if (r.kind === 'pitchbend') return { kind: 'pitchbend', channel };
  return null;
}

const COMMANDS: readonly TransportCommand[] = [
  'play',
  'stop',
  'playStop',
  'record',
  'loop',
  'metronome',
  'rewind',
  'forward',
];

function normalizeTarget(raw: unknown): ControlTarget | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'transport') {
    const command = COMMANDS.find((c) => c === r.command);
    return command ? { kind: 'transport', command } : null;
  }
  if (r.kind === 'master') {
    const param = r.param === 'tempo' ? 'tempo' : 'volume';
    return { kind: 'master', param };
  }
  if (typeof r.trackId !== 'string') return null;
  if (r.kind === 'macro' && typeof r.macroId === 'string') {
    return { kind: 'macro', trackId: r.trackId, macroId: r.macroId };
  }
  if (r.kind === 'param' && typeof r.paramId === 'string') {
    return { kind: 'param', trackId: r.trackId, paramId: r.paramId };
  }
  return null;
}

function normalizeLink(raw: unknown): ControlLink | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  const source = normalizeSource(r.source);
  const target = normalizeTarget(r.target);
  if (!source || !target) return null;
  const mode: ControlMode =
    r.mode === 'toggle' ? 'toggle' : r.mode === 'relative' ? 'relative' : 'absolute';
  return {
    id: r.id,
    source,
    target,
    mode,
    min: num(r.min, 0, 1, 0),
    max: num(r.max, 0, 1, 1),
    invert: r.invert === true,
  };
}

import type { LoopRegion, TimeSignature } from './types';

export function secondsPerBeat(bpm: number): number {
  return 60 / bpm;
}

export function beatsToSeconds(beats: number, bpm: number): number {
  return beats * secondsPerBeat(bpm);
}

export function secondsToBeats(seconds: number, bpm: number): number {
  return seconds / secondsPerBeat(bpm);
}

/** Quarter-note beats per bar for a time signature (4/4 -> 4, 6/8 -> 3, 3/4 -> 3). */
export function beatsPerBar(sig: TimeSignature): number {
  return sig.num * (4 / sig.den);
}

/** Format an absolute beat position as bars.beats.sixteenths (1-based). */
export function formatPosition(beats: number, sig: TimeSignature): string {
  const bpb = beatsPerBar(sig);
  const safe = Math.max(0, beats);
  const bar = Math.floor(safe / bpb);
  const beatInBar = safe - bar * bpb;
  const beat = Math.floor(beatInBar);
  const sixteenth = Math.floor((beatInBar - beat) * 4);
  return `${bar + 1}.${beat + 1}.${sixteenth + 1}`;
}

/** Format seconds as m:ss.t */
export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const whole = Math.floor(sec);
  const tenth = Math.floor((sec - whole) * 10);
  return `${m}:${String(whole).padStart(2, '0')}.${tenth}`;
}

export function linToDb(lin: number): number {
  if (lin <= 0.00001) return -Infinity;
  return 20 * Math.log10(lin);
}

export function dbToLin(db: number): number {
  if (db === -Infinity) return 0;
  return Math.pow(10, db / 20);
}

export function formatDb(lin: number): string {
  const db = linToDb(lin);
  if (db === -Infinity) return '-inf';
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)}`;
}

/**
 * Map a raw linear beat position into the loop region.
 * Positions before the loop end pass through; beyond it they cycle
 * within [start, end).
 */
export function wrapLoopBeat(raw: number, loop: LoopRegion): number {
  if (!loop.enabled) return raw;
  const len = loop.end - loop.start;
  if (len <= 0) return raw;
  if (raw < loop.end) return raw;
  return loop.start + ((raw - loop.start) % len);
}

export function snapBeat(beat: number, snap: number): number {
  if (snap <= 0) return beat;
  return Math.round(beat / snap) * snap;
}

export function snapBeatFloor(beat: number, snap: number): number {
  if (snap <= 0) return beat;
  return Math.floor(beat / snap + 1e-6) * snap;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** MIDI note number to name, middle C (60) = C4. */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function midiToName(pitch: number): string {
  const p = Math.round(pitch);
  const octave = Math.floor(p / 12) - 1;
  return `${NOTE_NAMES[((p % 12) + 12) % 12]}${octave}`;
}

export function midiToFreq(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

/** Faders map 0..1 UI position to 0..~1.5 gain with a musical curve (~ -inf..+3.5dB). */
export function faderPosToGain(pos: number): number {
  const p = clamp(pos, 0, 1);
  return Math.pow(p, 2.2) * 1.5;
}

export function gainToFaderPos(gain: number): number {
  return clamp(Math.pow(clamp(gain, 0, 1.5) / 1.5, 1 / 2.2), 0, 1);
}

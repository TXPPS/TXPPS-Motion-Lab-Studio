/**
 * Media model.
 *
 * A project stores small *metadata* records (MediaRef) inline in its JSON and
 * keeps the actual audio bytes in a separate IndexedDB object store, keyed by
 * the same id. Large blobs never enter the project document.
 *
 *   Project → Clip.mediaId → MediaRef (metadata) → IndexedDB blob + peaks
 *
 * `procedural` media is generated at runtime and has no stored blob, which is
 * how Milestone 1 demo content keeps working unchanged.
 */

export type MediaKind = 'procedural' | 'recording' | 'import';

export interface MediaRef {
  id: string;
  /** user-facing name, editable */
  name: string;
  /** original file name for imports, undefined for recordings */
  fileName?: string;
  kind: MediaKind;
  /** e.g. "audio/webm;codecs=opus" — undefined for procedural */
  mimeType?: string;
  /** seconds */
  duration: number;
  sampleRate: number;
  channels: number;
  /** blob size in bytes; 0 for procedural */
  byteSize: number;
  createdAt: number;
  /** "microphone", a file name, or a generator id */
  source: string;
  /** bumped when the peak-generation algorithm changes */
  peaksVersion: number;
}

export const PEAKS_VERSION = 1;

/** Peak envelope for waveform drawing. One min/max pair per bucket, per channel. */
export interface PeakData {
  version: number;
  /** buckets per channel */
  buckets: number;
  channels: number;
  /** seconds represented by the whole envelope */
  duration: number;
  /** length = channels * buckets */
  min: Float32Array;
  max: Float32Array;
}

export function isProceduralMediaId(id: string): boolean {
  return PROCEDURAL_MEDIA_IDS.includes(id);
}

/** Ids served by the runtime generator rather than IndexedDB. */
export const PROCEDURAL_MEDIA_IDS = [
  'perc-110-2bar',
  'texture-110-4bar',
  // One-shot drum hits (Milestone 7 sampler sources)
  'hit-kick',
  'hit-snare',
  'hit-clap',
  'hit-hat',
  'hit-openhat',
];

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Human-readable summary used by the browser panel and diagnostics. */
export function describeMedia(m: MediaRef): string {
  const ch = m.channels === 1 ? 'mono' : m.channels === 2 ? 'stereo' : `${m.channels}ch`;
  return `${m.duration.toFixed(1)}s · ${ch} · ${(m.sampleRate / 1000).toFixed(1)}kHz${
    m.byteSize ? ` · ${formatBytes(m.byteSize)}` : ''
  }`;
}

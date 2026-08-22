/**
 * One entry point for turning a rendered mix into a downloadable file.
 *
 * The encoders themselves are format modules that know nothing about the
 * browser; this layer holds the small amount of glue an export dialog needs:
 * the list of formats with text a user can read, a size estimate that can be
 * shown before the render starts, option validation with errors that say what
 * to do, and the single `new Blob(...)` in the whole subsystem.
 *
 * Encoders emit a list of byte blocks and the Blob is built from that list, so
 * the file is never copied into one contiguous buffer on the way out.
 */
import type { DitherOptions } from './dither';
import { encodeFlacParts, type FlacBitDepth } from './flac';
import { encodeWavParts, wavLayout, type WavSampleFormat } from './wav';

export type AudioFormatId = 'wav' | 'flac';

export type EncodeBitDepth = 16 | 24 | 32;

export interface EncodeMetadata {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  comment?: string;
  software?: string;
  date?: string;
}

export interface EncodeOptions {
  format: AudioFormatId;
  sampleRate: number;
  bitDepth: EncodeBitDepth;
  /** 32-bit only: write IEEE floats rather than integers. */
  float?: boolean;
  /** Omitted means no dither: plain rounding. */
  dither?: DitherOptions;
  metadata?: EncodeMetadata;
}

export interface EncodedAudio {
  blob: Blob;
  /** File extension without the dot. */
  ext: string;
  mime: string;
  bytes: number;
}

export interface FormatDescriptor {
  id: AudioFormatId;
  name: string;
  ext: string;
  mime: string;
  /** One sentence for the export dialog. */
  description: string;
  bitDepths: EncodeBitDepth[];
  supportsFloat: boolean;
  compressed: boolean;
  supportsMetadata: boolean;
}

/**
 * Compression actually achieved depends entirely on the programme: a sparse
 * acoustic mix can reach 0.4, a loud limited master barely 0.75. 0.6 is the
 * middle of that range and is only ever used for the pre-render estimate.
 */
export const FLAC_TYPICAL_RATIO = 0.6;

export const AUDIO_FORMATS: readonly FormatDescriptor[] = [
  {
    id: 'wav',
    name: 'WAV',
    ext: 'wav',
    mime: 'audio/wav',
    description:
      'Uncompressed PCM. Read by everything, from phones to mastering houses. Largest files.',
    bitDepths: [16, 24, 32],
    supportsFloat: true,
    compressed: false,
    supportsMetadata: true,
  },
  {
    id: 'flac',
    name: 'FLAC',
    ext: 'flac',
    mime: 'audio/flac',
    description:
      'Lossless compression, usually 40-60% smaller than WAV and decoding to identical samples. Best for archiving.',
    bitDepths: [16, 24],
    supportsFloat: false,
    compressed: true,
    supportsMetadata: true,
  },
];

export function formatDescriptor(id: AudioFormatId): FormatDescriptor {
  const found = AUDIO_FORMATS.find((f) => f.id === id);
  if (!found) throw new RangeError(`Unknown export format: ${id}`);
  return found;
}

export class EncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncodeError';
  }
}

/** Throws with a message aimed at the user rather than at the caller. */
export function validateEncodeOptions(opts: EncodeOptions, channelCount: number): void {
  const desc = formatDescriptor(opts.format);
  if (!desc.bitDepths.includes(opts.bitDepth)) {
    throw new EncodeError(
      `${desc.name} supports ${desc.bitDepths.join(', ')}-bit; ${opts.bitDepth}-bit was requested.`,
    );
  }
  if (opts.float && !desc.supportsFloat) {
    throw new EncodeError(`${desc.name} has no floating-point form.`);
  }
  if (opts.float && opts.bitDepth !== 32) {
    throw new EncodeError('Floating-point output is 32-bit only.');
  }
  if (!Number.isFinite(opts.sampleRate) || opts.sampleRate <= 0) {
    throw new EncodeError(`Invalid sample rate: ${opts.sampleRate}.`);
  }
  if (channelCount < 1) throw new EncodeError('Nothing to encode: no channels.');
  if (opts.format === 'flac' && channelCount > 8) {
    throw new EncodeError(`FLAC carries at most 8 channels; ${channelCount} were given.`);
  }
}

function wavFormatOf(opts: EncodeOptions): WavSampleFormat {
  if (opts.bitDepth === 16) return 'int16';
  if (opts.bitDepth === 24) return 'int24';
  return opts.float ? 'float32' : 'int32';
}

/**
 * Predicted file size in bytes. Exact for WAV; for FLAC it is an estimate,
 * because the size of a lossless file is a property of the audio.
 */
export function estimateSize(frames: number, channelCount: number, opts: EncodeOptions): number {
  const n = Math.max(0, Math.floor(frames));
  if (opts.format === 'wav') {
    return wavLayout(channelCount, n, { format: wavFormatOf(opts), metadata: opts.metadata })
      .totalBytes;
  }
  const raw = n * channelCount * (opts.bitDepth / 8);
  // 4-byte marker, 38-byte STREAMINFO block, and a small tag block.
  return Math.round(raw * FLAC_TYPICAL_RATIO) + 128;
}

/** Encode a rendered mix. Channels must all be the same length. */
export function encodeAudio(channels: Float32Array[], opts: EncodeOptions): EncodedAudio {
  validateEncodeOptions(opts, channels.length);
  const desc = formatDescriptor(opts.format);

  let parts: Uint8Array[];
  let bytes: number;
  if (opts.format === 'wav') {
    const encoded = encodeWavParts(channels, {
      sampleRate: opts.sampleRate,
      format: wavFormatOf(opts),
      metadata: opts.metadata,
      dither: opts.dither,
    });
    parts = encoded.parts;
    bytes = encoded.layout.totalBytes;
  } else {
    const encoded = encodeFlacParts(channels, {
      sampleRate: opts.sampleRate,
      bitDepth: opts.bitDepth as FlacBitDepth,
      metadata: opts.metadata,
      dither: opts.dither,
    });
    parts = encoded.parts;
    bytes = encoded.totalBytes;
  }

  return {
    blob: new Blob(parts as BlobPart[], { type: desc.mime }),
    ext: desc.ext,
    mime: desc.mime,
    bytes,
  };
}

// Re-exported so callers need only this module.
export * from './dither';
export * from './wav';
export * from './flac';

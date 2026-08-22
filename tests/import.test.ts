import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_IMPORT_BYTES,
  audioFilesFromDrop,
  importAudioFile,
  summariseImport,
  type ImportOutcome,
} from '../src/audio/importAudio';
import { createEmptyProject } from '../src/model/demoProject';
import { useProjectStore } from '../src/state/projectStore';
import { resetMediaCaches } from '../src/audio/mediaLibrary';

/**
 * A stand-in decode context. jsdom has no Web Audio, so the pipeline is driven
 * with a fake that returns a buffer shaped like the real one — this exercises
 * the validation, storage and clip-creation logic, not the codec.
 */
function fakeBuffer(duration: number, channels = 1, sampleRate = 44100): AudioBuffer {
  const length = Math.max(1, Math.round(duration * sampleRate));
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) data[i] = Math.sin(i / 20) * 0.6;
  return {
    duration,
    length,
    numberOfChannels: channels,
    sampleRate,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

function ctxThatDecodes(buffer: AudioBuffer): BaseAudioContext {
  return { decodeAudioData: () => Promise.resolve(buffer) } as unknown as BaseAudioContext;
}

function ctxThatFails(message = 'Unable to decode audio data'): BaseAudioContext {
  return {
    decodeAudioData: () => Promise.reject(new Error(message)),
  } as unknown as BaseAudioContext;
}

function file(name: string, bytes: number, type = 'audio/wav'): File {
  const data = new Uint8Array(Math.max(0, bytes));
  const f = new File([data], name, { type });
  // jsdom's File does not implement arrayBuffer(); the import pipeline needs it.
  Object.defineProperty(f, 'arrayBuffer', {
    value: () => Promise.resolve(data.buffer),
    configurable: true,
  });
  return f;
}

function audioTrackId(): string {
  return useProjectStore.getState().project.tracks.find((t) => t.type === 'audio')!.id;
}

beforeEach(() => {
  resetMediaCaches();
  useProjectStore.getState().setProject(createEmptyProject('Import test'), { markClean: true });
  useProjectStore.getState().addTrack('audio');
});

describe('import validation', () => {
  it('refuses an empty file before attempting to decode', async () => {
    const ctx = ctxThatDecodes(fakeBuffer(1));
    const spy = vi.spyOn(ctx, 'decodeAudioData');
    const res = await importAudioFile(file('empty.wav', 0), {}, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/empty/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a file over the size ceiling and names both numbers', async () => {
    // Construct the oversized File lazily — allocating 120MB in a test is wasteful.
    const big = { name: 'huge.wav', size: MAX_IMPORT_BYTES + 1, type: 'audio/wav' } as File;
    const res = await importAudioFile(big, {}, ctxThatDecodes(fakeBuffer(1)));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/limit/i);
      expect(res.reason).toMatch(/MB/);
    }
  });

  it('reports an undecodable file honestly, naming the format', async () => {
    const res = await importAudioFile(file('track.flac', 2048), {}, ctxThatFails());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/FLAC/);
      expect(res.reason).toMatch(/WAV|MP3|M4A/);
    }
  });

  it('rejects audio that decodes to zero frames', async () => {
    const res = await importAudioFile(
      file('silent.wav', 1024),
      {},
      ctxThatDecodes(fakeBuffer(0, 1)),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/zero audio frames/i);
  });

  it('does not create a clip when the import fails', async () => {
    const before = useProjectStore.getState().project.clips.length;
    await importAudioFile(file('bad.ogg', 512), { trackId: audioTrackId() }, ctxThatFails());
    expect(useProjectStore.getState().project.clips.length).toBe(before);
  });
});

describe('successful import', () => {
  it('creates a clip on the target track with the source duration recorded', async () => {
    useProjectStore.getState().setBpm(120);
    const tid = audioTrackId();
    const res = await importAudioFile(
      file('loop.wav', 4096),
      { trackId: tid, startBeat: 4 },
      ctxThatDecodes(fakeBuffer(2, 2, 48000)),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.clipId).toBeTruthy();

    const clip = useProjectStore.getState().project.clips.find((c) => c.id === res.clipId)!;
    expect(clip.trackId).toBe(tid);
    expect(clip.start).toBe(4);
    // 2 seconds at 120 BPM is 4 beats
    expect(clip.length).toBeCloseTo(4, 5);
    expect(clip.type).toBe('audio');
    if (clip.type === 'audio') expect(clip.sourceDuration).toBeCloseTo(2, 5);
  });

  it('records accurate media metadata from the decoded buffer, not the file name', async () => {
    const res = await importAudioFile(
      file('My Track.wav', 9000, 'audio/wav'),
      { trackId: audioTrackId() },
      ctxThatDecodes(fakeBuffer(3.5, 2, 48000)),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mediaRef.name).toBe('My Track');
    expect(res.mediaRef.fileName).toBe('My Track.wav');
    expect(res.mediaRef.kind).toBe('import');
    expect(res.mediaRef.duration).toBeCloseTo(3.5, 5);
    expect(res.mediaRef.sampleRate).toBe(48000);
    expect(res.mediaRef.channels).toBe(2);
    expect(res.mediaRef.byteSize).toBe(9000);
  });

  it('registers media in the project without a clip when no track is given', async () => {
    const res = await importAudioFile(file('library.wav', 2048), {}, ctxThatDecodes(fakeBuffer(1)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.clipId).toBeNull();
    const media = useProjectStore.getState().project.media ?? [];
    expect(media.map((m) => m.id)).toContain(res.mediaRef.id);
    expect(useProjectStore.getState().project.clips.length).toBe(0);
  });

  it('strips only the final extension from the display name', async () => {
    const res = await importAudioFile(
      file('take.2.final.wav', 1024),
      {},
      ctxThatDecodes(fakeBuffer(1)),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.mediaRef.name).toBe('take.2.final');
  });
});

describe('batch reporting', () => {
  const ok = (name: string, silent = false): ImportOutcome => ({
    ok: true,
    file: name,
    mediaRef: { id: name } as ImportOutcome extends { ok: true } ? never : never as never,
    clipId: null,
    silent,
  });
  const fail = (name: string, reason: string): ImportOutcome => ({ ok: false, file: name, reason });

  it('reports a clean batch as info', () => {
    const s = summariseImport([ok('a.wav'), ok('b.wav')]);
    expect(s.level).toBe('info');
    expect(s.text).toMatch(/Imported 2 files/);
  });

  it('mentions silent files rather than passing them off as fine', () => {
    const s = summariseImport([ok('a.wav', true), ok('b.wav')]);
    expect(s.level).toBe('info');
    expect(s.text).toMatch(/silence/);
  });

  it('surfaces the reason when a single file fails', () => {
    const s = summariseImport([fail('a.flac', 'This browser could not decode FLAC.')]);
    expect(s.level).toBe('error');
    expect(s.text).toMatch(/a\.flac/);
    expect(s.text).toMatch(/FLAC/);
  });

  it('does not hide partial failure behind a success message', () => {
    const s = summariseImport([ok('a.wav'), fail('b.flac', 'nope')]);
    expect(s.level).toBe('error');
    expect(s.text).toMatch(/Imported 1/);
    expect(s.text).toMatch(/failed 1/);
  });
});

describe('drag payload extraction', () => {
  it('returns nothing for a null transfer', () => {
    expect(audioFilesFromDrop(null)).toEqual([]);
  });

  it('ignores non-file items such as dragged text', () => {
    const dt = {
      items: [
        { kind: 'string', getAsFile: () => null },
        { kind: 'file', getAsFile: () => file('a.wav', 100) },
      ],
      files: [],
    } as unknown as DataTransfer;
    const files = audioFilesFromDrop(dt);
    expect(files.map((f) => f.name)).toEqual(['a.wav']);
  });

  it('skips zero-byte entries, which is how directories present themselves', () => {
    const dt = {
      items: [
        { kind: 'file', getAsFile: () => file('folder', 0) },
        { kind: 'file', getAsFile: () => file('real.wav', 500) },
      ],
      files: [],
    } as unknown as DataTransfer;
    expect(audioFilesFromDrop(dt).map((f) => f.name)).toEqual(['real.wav']);
  });

  it('falls back to the files list when items is unavailable', () => {
    const dt = { items: [], files: [file('x.wav', 10)] } as unknown as DataTransfer;
    expect(audioFilesFromDrop(dt).map((f) => f.name)).toEqual(['x.wav']);
  });
});

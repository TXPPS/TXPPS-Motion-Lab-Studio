/**
 * Directive 09 §2.3 — a track's input is mono or stereo, and it is the track's
 * choice.
 *
 * There was no such choice. Every capture went out with
 * `channelCount: { ideal: 1 }` — a hint, which a device is free to ignore — so
 * on a two-input interface a "mono" vocal take could come back as a stereo file
 * with a dead side. It plays half-way to the left the moment the pan knob is
 * touched, and nothing anywhere told the user what had been recorded.
 *
 * Now the constraint is `exact`, the lease is keyed on the format as well as
 * the device, and what the device actually granted is read back and reported.
 */
import { beforeEach, describe, expect, it } from 'vitest';

interface FakeTrack {
  kind: 'audio';
  label: string;
  readyState: string;
  muted: boolean;
  stop: () => void;
  addEventListener: () => void;
  getSettings: () => { channelCount?: number };
}

let calls: MediaTrackConstraints[] = [];
/** Channel counts this fake device is willing to deliver. */
let supported = new Set<number>([1, 2]);
/** What `getSettings()` reports, or undefined to omit it as some engines do. */
let reportChannels: number | undefined;

function fakeStream(channels: number): MediaStream {
  const track: FakeTrack = {
    kind: 'audio',
    label: 'Fake input',
    readyState: 'live',
    muted: false,
    stop: () => {},
    addEventListener: () => {},
    getSettings: () => ({ channelCount: reportChannels ?? channels }),
  };
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
}

const ctx = {
  createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => {} }),
} as unknown as AudioContext;

beforeEach(async () => {
  calls = [];
  supported = new Set([1, 2]);
  reportChannels = undefined;
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: (c: MediaStreamConstraints) => {
        const audio = c.audio as MediaTrackConstraints;
        calls.push(audio);
        const req = audio.channelCount as { exact?: number; ideal?: number } | undefined;
        const exact = req?.exact;
        if (exact !== undefined && !supported.has(exact)) {
          const err = new Error('cannot') as Error & { name: string };
          err.name = 'OverconstrainedError';
          return Promise.reject(err);
        }
        const ideal = req?.ideal;
        const got = exact ?? (ideal !== undefined && supported.has(ideal) ? ideal : 1);
        return Promise.resolve(fakeStream(got));
      },
      enumerateDevices: () => Promise.resolve([]),
      addEventListener: () => {},
    },
  });
  const { audioInput } = await import('../src/audio/inputManager');
  audioInput.stopAll();
});

const mgr = async () => (await import('../src/audio/inputManager')).audioInput;

describe('asking the device for a channel count', () => {
  it('asks for exactly one channel for a mono track', async () => {
    const audioInput = await mgr();
    expect(await audioInput.acquire('mic', 'a', ctx, 1)).not.toBeNull();
    // `exact`, not `ideal`. A hint is free to be ignored, and being ignored is
    // precisely what produced a stereo file from a mono track.
    expect(calls[0].channelCount).toEqual({ exact: 1 });
  });

  it('asks for exactly two for a stereo track', async () => {
    const audioInput = await mgr();
    await audioInput.acquire('mic', 'a', ctx, 2);
    expect(calls[0].channelCount).toEqual({ exact: 2 });
  });

  it('defaults to mono, which is what every existing project was recording', async () => {
    const audioInput = await mgr();
    await audioInput.acquire('mic', 'a', ctx);
    expect(calls[0].channelCount).toEqual({ exact: 1 });
  });

  it('keeps the raw-signal constraints — no voice-call processing', async () => {
    const audioInput = await mgr();
    await audioInput.acquire('mic', 'a', ctx, 2);
    expect(calls[0]).toMatchObject({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
  });
});

describe('a device that cannot do what was asked', () => {
  it('falls back to a best effort rather than failing the take', async () => {
    supported = new Set([1]); // a single-input interface
    const audioInput = await mgr();
    const source = await audioInput.acquire('mic', 'a', ctx, 2);
    expect(source).not.toBeNull();
    expect(calls[0].channelCount).toEqual({ exact: 2 });
    expect(calls[1].channelCount).toEqual({ ideal: 2 });
  });

  it('reports what it actually got, not what was asked for', async () => {
    supported = new Set([1]);
    const audioInput = await mgr();
    await audioInput.acquire('mic', 'a', ctx, 2);
    // A user who chose Stereo and got mono has to be told, rather than left to
    // find out from the waveform.
    expect(audioInput.grantedFormat('mic', 2)).toBe(1);
  });

  it('falls back to the request when the engine omits the setting', async () => {
    reportChannels = -1; // stands in for "absent"
    const audioInput = await mgr();
    await audioInput.acquire('mic', 'a', ctx, 2);
    // `channelCount` is optional in the spec. Reporting a confident 0 would be
    // worse than reporting the request.
    expect(audioInput.grantedFormat('mic', 2)).toBe(2);
  });
});

describe('two tracks on one interface', () => {
  it('does not make a stereo track share a mono track’s stream', async () => {
    const audioInput = await mgr();
    await audioInput.acquire('mic', 'vocal', ctx, 1);
    await audioInput.acquire('mic', 'keys', ctx, 2);
    // Keyed on the device alone, the second track would have been handed the
    // first one's mono stream and would have recorded in a format it did not
    // choose.
    expect(calls).toHaveLength(2);
    expect(audioInput.activeStreamCount()).toBe(2);
    expect(audioInput.grantedFormat('mic', 1)).toBe(1);
    expect(audioInput.grantedFormat('mic', 2)).toBe(2);
  });

  it('shares one stream between two owners of the same format', async () => {
    const audioInput = await mgr();
    await audioInput.acquire('mic', 'monitor:t1', ctx, 1);
    await audioInput.acquire('mic', 'record:t1', ctx, 1);
    // Monitoring and recording the same track must not open the device twice.
    expect(calls).toHaveLength(1);
    expect(audioInput.activeStreamCount()).toBe(1);
  });

  it('keeps the stream until the last owner of that format lets go', async () => {
    const audioInput = await mgr();
    await audioInput.acquire('mic', 'monitor:t1', ctx, 1);
    await audioInput.acquire('mic', 'record:t1', ctx, 1);
    audioInput.release('mic', 'record:t1', 1);
    expect(audioInput.activeStreamCount()).toBe(1);
    audioInput.release('mic', 'monitor:t1', 1);
    expect(audioInput.activeStreamCount()).toBe(0);
  });

  it('does not release a stereo lease when the mono one is let go', async () => {
    const audioInput = await mgr();
    await audioInput.acquire('mic', 'vocal', ctx, 1);
    await audioInput.acquire('mic', 'keys', ctx, 2);
    audioInput.release('mic', 'vocal', 1);
    expect(audioInput.activeStreamCount()).toBe(1);
    expect(audioInput.grantedFormat('mic', 2)).toBe(2);
  });
});

describe('the stream a take is recorded from', () => {
  it('is the one opened at the track’s format', async () => {
    const audioInput = await mgr();
    await audioInput.acquire('mic', 'record:t1', ctx, 2);
    expect(audioInput.streamFor('mic', 2)).not.toBeNull();
    // Asked for at the wrong format there is nothing there — which is what
    // makes the format part of the key rather than a property hanging off it.
    expect(audioInput.streamFor('mic', 1)).toBeNull();
  });
});

describe('a saved track format', () => {
  it('survives a round trip, and a corrupt one is dropped rather than clamped', async () => {
    const { validateProject } = await import('../src/persistence/projectRepo');
    const { createEmptyProject } = await import('../src/model/demoProject');
    const base = createEmptyProject('Format');
    const withTracks = (n: unknown) => ({
      ...base,
      tracks: [
        {
          id: 't1',
          type: 'audio',
          name: 'A',
          color: '#888',
          volume: 1,
          pan: 0,
          mute: false,
          solo: false,
          armed: false,
          collapsed: false,
          output: 'master',
          inputChannels: n,
        },
      ],
    });
    expect(validateProject(withTracks(2)).tracks[0].inputChannels).toBe(2);
    expect(validateProject(withTracks(1)).tracks[0].inputChannels).toBe(1);
    // Dropped, not clamped: the field is a format, not a count, and a track
    // that loaded with 3 would ask for three channels and be refused by every
    // device there is.
    expect(validateProject(withTracks(3)).tracks[0].inputChannels).toBeUndefined();
    expect(validateProject(withTracks('stereo')).tracks[0].inputChannels).toBeUndefined();
    expect(validateProject(withTracks(0)).tracks[0].inputChannels).toBeUndefined();
  });
});

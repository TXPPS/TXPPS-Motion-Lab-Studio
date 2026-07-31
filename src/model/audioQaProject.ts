/**
 * Milestone 2 QA fixture: the audio-editing and routing states that are hard to
 * reach by hand and easy to break silently.
 *
 * Every clip uses procedurally generated repository-safe audio (`perc-110-2bar`,
 * `texture-110-4bar`) — no recorded microphone audio is committed. One track
 * deliberately references media that does not exist, so the missing-media state
 * can be inspected rather than only reasoned about.
 *
 * Loaded via `#/qa-audio`; never autosaved over a real project.
 */
import { newId } from './ids';
import { defaultParams } from './effects';
import { getPreset, DRUM_KIT_PARAMS } from './presets';
import { SCHEMA_VERSION } from './types';
import type { AudioClip, Clip, Effect, MidiClip, ProjectData, Track } from './types';

export const AUDIO_QA_PROJECT_ID = 'qa-audio-editing';

const PERC = 'perc-110-2bar';
const TEXTURE = 'texture-110-4bar';
/** Intentionally absent from storage — this is the missing-media case. */
export const MISSING_MEDIA_ID = 'qa-missing-media-does-not-exist';

function track(patch: Partial<Track> & Pick<Track, 'name' | 'type'>): Track {
  return {
    id: newId('t'),
    color: '#4a90c4',
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: 'master',
    ...patch,
  };
}

function audioClip(patch: Partial<AudioClip> & Pick<AudioClip, 'trackId' | 'name' | 'start'>): AudioClip {
  return {
    id: newId('c'),
    type: 'audio',
    length: 8,
    muted: false,
    mediaId: PERC,
    offset: 0,
    sourceDuration: 4.363,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    ...patch,
  };
}

function fx(kind: Effect['kind'], params: Record<string, number> = {}, bypass = false): Effect {
  return { id: newId('fx'), kind, bypass, params: { ...defaultParams(kind), ...params } };
}

/**
 * Builds the fixture. Each track isolates one condition so a screenshot or a
 * geometry assertion can point at exactly one thing.
 */
export function createAudioQaProject(): ProjectData {
  const now = Date.now();

  // 1. Untouched reference clips.
  const plain = track({ name: 'Plain Audio', type: 'audio', color: '#37b89a' });
  // 2. Trimmed from both edges.
  const trimmed = track({ name: 'Trimmed', type: 'audio', color: '#4a90c4' });
  // 3. Split into adjacent halves sharing one source.
  const split = track({ name: 'Split Halves', type: 'audio', color: '#9070c9' });
  // 4. Fades of several lengths, including a full crossfade-length pair.
  const faded = track({ name: 'Fades', type: 'audio', color: '#d97455' });
  // 5. Extreme clip gains, high and low.
  const gains = track({ name: 'Clip Gain', type: 'audio', color: '#d9a13c' });
  // 6. Media that is not in storage.
  const missing = track({ name: 'Missing Media', type: 'audio', color: '#b8536b' });
  // 7. Muted clips.
  const muted = track({ name: 'Muted Clips', type: 'audio', color: '#7f93a8' });
  // 8. Many short clips, for waveform rendering under load.
  const many = track({ name: 'Many Clips', type: 'audio', color: '#5aa9d6' });
  // 9. Long single clip at low zoom.
  const long = track({ name: 'Long Take', type: 'audio', color: '#6f8bb8' });
  // 10. Instrument + drums, so a bounce has synthesised content too.
  const keys = track({
    name: 'Keys',
    type: 'instrument',
    color: '#37b89a',
    synth: getPreset('Warm Keys'),
  });
  const drums = track({
    name: 'Drums',
    type: 'drum',
    color: '#d9a13c',
    synth: { ...DRUM_KIT_PARAMS },
  });

  // Buses: one for glue compression, one purely wet for sends.
  const drumBus = track({
    name: 'Drum Bus',
    type: 'bus',
    color: '#b8873a',
    volume: 1,
    effects: [fx('compressor', { threshold: -20, ratio: 4, makeupDb: 3 })],
  });
  const reverbBus = track({
    name: 'Reverb Bus',
    type: 'bus',
    color: '#6f8bb8',
    volume: 0.9,
    // Fully wet: the dry signal already reaches master via each channel.
    effects: [fx('reverb', { size: 2.6, mix: 1 })],
  });
  const delayBus = track({
    name: 'Delay Bus',
    type: 'bus',
    color: '#8a6fb8',
    volume: 0.8,
    effects: [fx('delay', { timeSixteenths: 6, feedback: 0.4, mix: 1 })],
  });

  drums.output = drumBus.id;
  // A full insert chain, to exercise several effects in series.
  plain.effects = [
    fx('trim', { gainDb: 2 }),
    fx('eq3', { lowDb: 3, midDb: -2, highDb: 4 }),
    fx('compressor', { threshold: -18, ratio: 3 }),
  ];
  // One bypassed insert, so the bypassed styling is inspectable.
  trimmed.effects = [fx('eq3', { lowDb: -6 }, true)];

  keys.sends = [
    { busId: reverbBus.id, amount: 0.4, enabled: true, preFader: false },
    { busId: delayBus.id, amount: 0.25, enabled: true, preFader: false },
  ];
  plain.sends = [{ busId: reverbBus.id, amount: 0.3, enabled: true, preFader: false }];
  // A disabled send, to check the OFF state renders distinctly.
  gains.sends = [{ busId: delayBus.id, amount: 0.5, enabled: false, preFader: true }];
  // A pre-fader send, which taps the insert output rather than the fader.
  long.sends = [{ busId: reverbBus.id, amount: 0.35, enabled: true, preFader: true }];

  const tracks: Track[] = [
    plain,
    trimmed,
    split,
    faded,
    gains,
    missing,
    muted,
    many,
    long,
    keys,
    drums,
    drumBus,
    reverbBus,
    delayBus,
  ];

  const clips: Clip[] = [];

  clips.push(audioClip({ trackId: plain.id, name: 'Reference', start: 0 }));
  clips.push(audioClip({ trackId: plain.id, name: 'Reference 2', start: 16 }));

  // Trimmed: starts 1.2s into the source and ends early.
  clips.push(
    audioClip({
      trackId: trimmed.id,
      name: 'Trim both edges',
      start: 2,
      length: 4,
      offset: 1.2,
      sourceDuration: 2.0,
    }),
  );
  clips.push(
    audioClip({
      trackId: trimmed.id,
      name: 'Trim tail only',
      start: 10,
      length: 3,
      sourceDuration: 1.6,
    }),
  );

  // Split: two halves whose offsets stay contiguous across the cut.
  clips.push(
    audioClip({ trackId: split.id, name: 'Left half', start: 0, length: 4, sourceDuration: 2.18 }),
  );
  clips.push(
    audioClip({
      trackId: split.id,
      name: 'Right half',
      start: 4,
      length: 4,
      offset: 2.18,
      sourceDuration: 2.18,
    }),
  );

  clips.push(
    audioClip({ trackId: faded.id, name: 'Short fades', start: 0, fadeIn: 0.3, fadeOut: 0.3 }),
  );
  clips.push(
    audioClip({ trackId: faded.id, name: 'Long fade in', start: 10, fadeIn: 3.5, fadeOut: 0.2 }),
  );
  clips.push(
    // Fades meeting in the middle: the maximum the store allows.
    audioClip({
      trackId: faded.id,
      name: 'Full triangle',
      start: 20,
      fadeIn: 2.18,
      fadeOut: 2.18,
    }),
  );

  clips.push(audioClip({ trackId: gains.id, name: 'Loud (+8 dB)', start: 0, gain: 2.5 }));
  clips.push(audioClip({ trackId: gains.id, name: 'Quiet (-20 dB)', start: 10, gain: 0.1 }));
  clips.push(audioClip({ trackId: gains.id, name: 'Silent (0)', start: 20, gain: 0 }));

  clips.push(
    audioClip({ trackId: missing.id, name: 'Missing source', start: 0, mediaId: MISSING_MEDIA_ID }),
  );
  clips.push(
    audioClip({
      trackId: missing.id,
      name: 'Also missing',
      start: 12,
      length: 6,
      mediaId: MISSING_MEDIA_ID,
    }),
  );

  clips.push(audioClip({ trackId: muted.id, name: 'Muted', start: 0, muted: true }));
  clips.push(audioClip({ trackId: muted.id, name: 'Muted 2', start: 10, muted: true, gain: 1.4 }));

  // Many short clips: waveform rendering under load.
  for (let i = 0; i < 28; i++) {
    clips.push(
      audioClip({
        trackId: many.id,
        name: `Slice ${i + 1}`,
        start: i * 2,
        length: 2,
        offset: (i % 4) * 0.5,
        sourceDuration: 1.05,
        gain: 0.6 + (i % 5) * 0.15,
        fadeIn: i % 3 === 0 ? 0.15 : 0,
        fadeOut: i % 4 === 0 ? 0.2 : 0,
      }),
    );
  }

  clips.push(
    audioClip({
      trackId: long.id,
      name: 'Long texture',
      start: 0,
      length: 32,
      mediaId: TEXTURE,
      sourceDuration: 8.727,
      fadeIn: 1,
      fadeOut: 2,
    }),
  );

  const keysNotes = [];
  for (let bar = 0; bar < 4; bar++) {
    for (const [i, p] of [57, 60, 64, 67].entries()) {
      keysNotes.push({
        id: newId('n'),
        pitch: p,
        start: bar * 4 + i * 0.5,
        length: 1.5,
        velocity: 88,
      });
    }
  }
  clips.push({
    id: newId('c'),
    trackId: keys.id,
    type: 'midi',
    name: 'Keys',
    start: 0,
    length: 16,
    muted: false,
    notes: keysNotes,
  } satisfies MidiClip);

  const drumNotes = [];
  for (let b = 0; b < 16; b++) {
    drumNotes.push({ id: newId('n'), pitch: 36, start: b, length: 0.3, velocity: 118 });
    if (b % 2 === 1) {
      drumNotes.push({ id: newId('n'), pitch: 38, start: b, length: 0.3, velocity: 108 });
    }
  }
  clips.push({
    id: newId('c'),
    trackId: drums.id,
    type: 'midi',
    name: 'Drums',
    start: 0,
    length: 16,
    muted: false,
    notes: drumNotes,
  } satisfies MidiClip);

  return {
    schemaVersion: SCHEMA_VERSION,
    id: AUDIO_QA_PROJECT_ID,
    name: 'QA — Audio Editing & Routing',
    bpm: 110,
    timeSig: { num: 4, den: 4 },
    masterVolume: 0.85,
    loop: { enabled: false, start: 0, end: 16 },
    metronome: false,
    createdAt: now,
    modifiedAt: now,
    // Zoomed in a little further than the layout fixture: these clips are
    // being inspected for waveform and fade detail, not for scroll range.
    workspace: { pxPerBeat: 30, snap: 0.25 },
    tracks,
    clips,
    media: [],
  };
}

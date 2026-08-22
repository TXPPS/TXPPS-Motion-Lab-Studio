/**
 * Audio-editing stress fixture (`#/qa-audio-edit`): crossfade chains, take
 * clips with comps, a healable split run, locked material, an edit-group
 * pair, and a dense field of faded clips — 2000+ audio clips total.
 * Deterministic; never autosaved. All media is procedurally generated.
 */
import { newId } from './ids';
import { SCHEMA_VERSION } from './types';
import type { AudioClip, ProjectData, Track } from './types';

export const AUDIO_EDIT_QA_PROJECT_ID = 'qa-audio-edit';

const PERC = 'perc-110-2bar';
const TEXTURE = 'texture-110-4bar';
/** 2 bars at 110 bpm */
const PERC_SEC = (2 * 4 * 60) / 110;

function track(patch: Partial<Track> & Pick<Track, 'name' | 'type'>): Track {
  return {
    id: newId('t'),
    color: ['#37b89a', '#4a90c4', '#9070c9', '#d9a13c', '#d97455'][patch.name.length % 5],
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

function clip(
  patch: Partial<AudioClip> & Pick<AudioClip, 'trackId' | 'start' | 'length'>,
): AudioClip {
  return {
    id: newId('c'),
    type: 'audio',
    name: patch.name ?? 'Clip',
    muted: false,
    mediaId: PERC,
    offset: 0,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    sourceDuration: (patch.length * 60) / 110,
    ...patch,
  };
}

export function createAudioEditQaProject(): ProjectData {
  const now = Date.now();
  const spb = 60 / 110;
  const tracks: Track[] = [];
  const clips: AudioClip[] = [];

  // 1. Crossfade chain: overlapping pairs with every shape.
  const xf = track({ name: 'Crossfades', type: 'audio' });
  tracks.push(xf);
  const shapes = ['equalPower', 'linear', 's', 'equalGain'] as const;
  for (let i = 0; i < 4; i++) {
    const a = clip({
      trackId: xf.id,
      name: `XF ${i}A`,
      start: i * 16,
      length: 9,
      fadeOut: 2 * spb,
      fadeOutShape: shapes[i],
    });
    const b = clip({
      trackId: xf.id,
      name: `XF ${i}B`,
      start: i * 16 + 7,
      length: 9,
      offset: 0.5,
      fadeIn: 2 * spb,
      fadeInShape: shapes[i],
      mediaId: TEXTURE,
    });
    clips.push(a, b);
  }

  // 2. Takes: comped clips with three takes each, first one open.
  const tk = track({ name: 'Takes', type: 'audio' });
  tracks.push(tk);
  for (let i = 0; i < 2; i++) {
    const takes = [
      { id: newId('tk'), name: 'Take 1 (perc)', mediaId: PERC, offset: 0 },
      { id: newId('tk'), name: 'Take 2 (texture)', mediaId: TEXTURE, offset: 0 },
      { id: newId('tk'), name: 'Take 3 (late perc)', mediaId: PERC, offset: 1 },
    ];
    clips.push(
      clip({
        trackId: tk.id,
        name: `Comp ${i + 1}`,
        start: i * 12,
        length: 8,
        takes,
        comp: [
          { at: 0, takeId: takes[0].id },
          { at: 4, takeId: takes[1].id },
        ],
        ...(i === 0 ? { takesOpen: true } : {}),
      }),
    );
  }

  // 3. Healable split run: one loop cut into 6 contiguous pieces.
  const sp = track({ name: 'Split Chain', type: 'audio' });
  tracks.push(sp);
  const pieceBeats = 8 / 6;
  for (let i = 0; i < 6; i++) {
    clips.push(
      clip({
        trackId: sp.id,
        name: `Piece ${i + 1}`,
        start: i * pieceBeats,
        length: pieceBeats,
        offset: i * pieceBeats * spb,
        sourceDuration: pieceBeats * spb,
      }),
    );
  }
  // Slip material: trimmed short so the slip tool has headroom both ways.
  clips.push(
    clip({
      trackId: sp.id,
      name: 'Slip me',
      start: 12,
      length: 4,
      offset: 1,
      sourceDuration: Math.min(4 * spb, PERC_SEC - 2),
    }),
  );

  // 4. Locked track.
  const lk = track({ name: 'Locked', type: 'audio', locked: true });
  tracks.push(lk);
  clips.push(clip({ trackId: lk.id, name: 'Untouchable', start: 0, length: 8 }));

  // 5. Edit-group pair: aligned clips that select together.
  const g1 = track({ name: 'Group Gtr L', type: 'audio', editGroup: 1 });
  const g2 = track({ name: 'Group Gtr R', type: 'audio', editGroup: 1 });
  tracks.push(g1, g2);
  for (const t of [g1, g2]) {
    clips.push(clip({ trackId: t.id, name: `${t.name} take`, start: 4, length: 8 }));
  }

  // 6. Dense field: 50 collapsed tracks × 40 clips, every one faded.
  for (let ti = 0; ti < 50; ti++) {
    const t = track({
      name: `Field ${String(ti + 1).padStart(2, '0')}`,
      type: 'audio',
      collapsed: true,
    });
    tracks.push(t);
    for (let ci = 0; ci < 40; ci++) {
      clips.push(
        clip({
          trackId: t.id,
          name: `F${ti}-${ci}`,
          start: ci * 4 + (ti % 3),
          length: 3,
          mediaId: ci % 3 === 2 ? TEXTURE : PERC,
          offset: (ci % 4) * 0.25,
          fadeIn: 0.08 + (ci % 5) * 0.05,
          fadeOut: 0.1 + (ti % 4) * 0.06,
          fadeInShape: shapes[ci % 4],
          fadeOutShape: shapes[(ci + 2) % 4],
          gain: 0.6 + ((ti + ci) % 5) * 0.1,
        }),
      );
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    id: AUDIO_EDIT_QA_PROJECT_ID,
    name: 'QA — Audio Editing (2k clips)',
    bpm: 110,
    timeSig: { num: 4, den: 4 },
    masterVolume: 0.8,
    loop: { enabled: false, start: 0, end: 16 },
    metronome: false,
    createdAt: now,
    modifiedAt: now,
    workspace: { pxPerBeat: 14, snap: 0.25 },
    tracks,
    clips: clips as ProjectData['clips'],
    media: [],
  };
}

/**
 * Automation stress fixture: 100 tracks, 500 automation lanes, 100,000 points.
 *
 * Deterministic (no Math.random) so tests can assert exact counts. Track 1 is
 * a curve showcase — every segment shape in one place for visual QA. Loaded
 * via `#/qa-automation`; never autosaved.
 */
import { newId } from './ids';
import { getPreset, DRUM_KIT_PARAMS } from './presets';
import { SCHEMA_VERSION } from './types';
import type { MidiClip, Note, ProjectData, Track } from './types';
import type { AutomationLane, AutomationPoint, CurveShape } from './automation';

export const HUGE_AUTOMATION_PROJECT_ID = 'qa-automation';
export const AUTO_FIXTURE_BEATS = 256;

const CURVE_CYCLE: CurveShape[] = ['linear', 's', 'exp', 'log', 'linear', 's', 'step', 'exp'];

function lane(paramId: string, points: AutomationPoint[], height?: number): AutomationLane {
  return { id: newId('al'), paramId, points, enabled: true, ...(height ? { height } : {}) };
}

/** `count` points across the fixture length; phase/rate vary the shape. */
function wavePoints(
  count: number,
  phase: number,
  rate: number,
  stepped = false,
): AutomationPoint[] {
  const pts: AutomationPoint[] = [];
  for (let i = 0; i < count; i++) {
    const beat = (i * AUTO_FIXTURE_BEATS) / count;
    const raw = 0.5 + 0.45 * Math.sin(phase + (i * rate * Math.PI) / 24);
    pts.push({
      id: newId('ap'),
      beat: Math.round(beat * 100) / 100,
      value: stepped ? (raw >= 0.5 ? 1 : 0) : Math.round(raw * 1000) / 1000,
      curve: stepped ? 'step' : CURVE_CYCLE[i % CURVE_CYCLE.length],
    });
  }
  return pts;
}

function track(patch: Partial<Track> & Pick<Track, 'name' | 'type'>): Track {
  return {
    id: newId('t'),
    color: ['#37b89a', '#4a90c4', '#9070c9', '#d9a13c', '#d97455', '#c96f9b'][
      patch.name.length % 6
    ],
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    collapsed: true,
    output: 'master',
    ...patch,
  };
}

export function createHugeAutomationProject(): ProjectData {
  const now = Date.now();
  const fxBus = track({ name: 'FX Bus', type: 'bus', collapsed: false });
  const subBus = track({ name: 'Sub Bus', type: 'bus', collapsed: false });

  // Track 1: the curve showcase — one segment of each shape, big lane heights.
  const showcase = track({
    name: 'Curve Showcase',
    type: 'instrument',
    collapsed: false,
    synth: getPreset('Warm Keys'),
    sends: [{ busId: fxBus.id, amount: 0.4, enabled: true, preFader: false }],
    automationOpen: true,
  });
  const showcaseVolume: AutomationPoint[] = (
    [
      [0, 0.9, 'linear'],
      [4, 0.2, 'exp'],
      [8, 0.9, 'log'],
      [12, 0.2, 's'],
      [16, 0.9, 'step'],
      [20, 0.2, 'linear'],
      [24, 0.75, 'linear'],
    ] as [number, number, CurveShape][]
  ).map(([beat, value, curve]) => ({ id: newId('ap'), beat, value, curve }));
  showcase.automation = [
    lane('volume', showcaseVolume, 64),
    lane('pan', wavePoints(48, 0, 3), 44),
    lane('mute', wavePoints(32, 1, 2, true), 30),
    lane(`send:${fxBus.id}`, wavePoints(48, 2, 5), 44),
    lane('synth:cutoff', wavePoints(64, 3, 4), 44),
  ];

  const tracks: Track[] = [showcase];
  const clips: MidiClip[] = [];

  // 97 dense tracks (plus showcase and two buses = 100) × ~5 lanes each.
  for (let i = 0; i < 97; i++) {
    const isInstrument = i % 3 !== 2;
    const isDrum = i % 9 === 4;
    const t = track({
      name: `${isDrum ? 'Drum' : isInstrument ? 'Synth' : 'Audio'} ${String(i + 1).padStart(2, '0')}`,
      type: isDrum ? 'drum' : isInstrument ? 'instrument' : 'audio',
      ...(isDrum
        ? { synth: { ...DRUM_KIT_PARAMS } }
        : isInstrument
          ? { synth: getPreset(i % 2 ? 'Sine Lead' : 'Warm Keys') }
          : {}),
      sends: [{ busId: i % 2 ? fxBus.id : subBus.id, amount: 0.3, enabled: true, preFader: false }],
      ...(i % 7 === 0
        ? {
            effects: [
              { id: newId('fx'), kind: 'trim' as const, bypass: false, params: { gainDb: 0 } },
            ],
          }
        : {}),
      ...(i < 2 ? { automationOpen: true, collapsed: false } : {}),
    });
    const busId = i % 2 ? fxBus.id : subBus.id;
    const lanes = [
      lane('volume', wavePoints(200, i, 2 + (i % 5))),
      lane('pan', wavePoints(200, i * 2, 3 + (i % 4))),
      lane('mute', wavePoints(200, i * 3, 1 + (i % 3), true)),
      lane(`send:${busId}`, wavePoints(200, i * 5, 2 + (i % 6))),
      t.synth ? lane('synth:cutoff', wavePoints(200, i * 7, 4 + (i % 5))) : lane('volume', [], 30), // placeholder never used: audio gets fx or pan2
    ];
    // Audio tracks without a synth get their fifth lane from the insert (when
    // present) or a second stepped mute pattern is replaced by send — keep it
    // simple: fx trim lane when the track has one, else a denser volume ride.
    if (!t.synth) {
      lanes[4] = t.effects
        ? lane(`fx:${t.effects[0].id}:gainDb`, wavePoints(200, i * 11, 3))
        : lane('pan', [], 0); // dropped below
    }
    t.automation = lanes.filter((l, idx) => !(idx === 4 && l.points.length === 0));
    // Tracks whose fifth lane was dropped get a compensating extra lane so the
    // fixture still reaches exactly 500 lanes / 100k points (added after loop).
    tracks.push(t);

    // Light musical content on the first 8 instruments so playback is audible.
    if (isInstrument && !isDrum && clips.length < 8) {
      const notes: Note[] = [];
      for (let n = 0; n < 64; n++) {
        notes.push({
          id: newId('n'),
          start: n * 4,
          length: 2,
          pitch: 48 + ((i * 5 + n * 7) % 24),
          velocity: 80,
        });
      }
      clips.push({
        id: newId('c'),
        trackId: t.id,
        type: 'midi',
        name: `Pad ${clips.length + 1}`,
        start: 0,
        length: AUTO_FIXTURE_BEATS,
        muted: false,
        notes,
      });
    }
  }

  // Bus volume lanes.
  fxBus.automation = [lane('volume', wavePoints(200, 11, 3))];
  subBus.automation = [lane('volume', wavePoints(200, 13, 4))];

  tracks.push(fxBus, subBus);

  // Count lanes/points and top up to exactly 500 lanes and 100,000 points by
  // adding pan lanes to audio tracks that lost their fifth lane.
  const laneCount = () => tracks.reduce((a, t) => a + (t.automation?.length ?? 0), 0);
  let i = 0;
  while (laneCount() < 500 && i < tracks.length) {
    const t = tracks[i++];
    if (!t.automation || t.type === 'bus') continue;
    const have = new Set(t.automation.map((l) => l.paramId));
    if (t.synth && !have.has('synth:resonance')) {
      t.automation.push(lane('synth:resonance', wavePoints(200, i * 17, 5)));
    } else if (t.synth && !have.has('synth:volume')) {
      t.automation.push(lane('synth:volume', wavePoints(200, i * 19, 3)));
    } else if (!have.has('pan')) {
      t.automation.push(lane('pan', wavePoints(200, i * 23, 5)));
    }
  }
  let points = tracks.reduce(
    (a, t) => a + (t.automation ?? []).reduce((b, l) => b + l.points.length, 0),
    0,
  );
  // Pad the final lane with extra points to land exactly on 100,000.
  const lastLane = tracks[tracks.length - 1].automation![0];
  let extra = 0;
  while (points < 100000) {
    lastLane.points.push({
      id: newId('ap'),
      beat: AUTO_FIXTURE_BEATS + 0.25 * extra++,
      value: 0.5 + 0.4 * Math.sin(extra),
      curve: 'linear',
    });
    points++;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    id: HUGE_AUTOMATION_PROJECT_ID,
    name: 'QA — Automation (100k points)',
    bpm: 120,
    timeSig: { num: 4, den: 4 },
    masterVolume: 0.8,
    loop: { enabled: false, start: 0, end: 32 },
    metronome: false,
    createdAt: now,
    modifiedAt: now,
    workspace: { pxPerBeat: 10, snap: 0.25 },
    tracks,
    clips,
    media: [],
  };
}

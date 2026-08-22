/**
 * MotionSynth — the face of the stock polysynth.
 *
 * Laid out the way a subtractive synth is wired, left to right: oscillator into
 * filter into amplifier, then the output stage, with the performance surface
 * (the keyboard) the largest thing on the panel. That ordering is the reference
 * convention for an instrument, and it is also the only arrangement in which
 * the pictures mean anything — the filter curve is downstream of the waveform
 * beside it, and the envelope is downstream of both.
 *
 * Every display is drawn from `model/synthFace.ts`, which reports what
 * `audio/synth.ts` builds. There is no second opinion about the filter or the
 * envelope anywhere in this file.
 */
import { useMemo } from 'react';
import { engine } from '../../audio/engine';
import { midi } from '../../audio/midi';
import { getPeaksSync } from '../../audio/mediaLibrary';
import { formatHz } from '../../model/effects';
import { clamp, midiToName } from '../../model/music';
import { DRUM_PITCHES, SYNTH_PRESETS } from '../../model/presets';
import { buildClassicKitRack } from '../../model/sampler';
import {
  formatSeconds,
  SYNTH_CUTOFF_MAX_HZ,
  SYNTH_CUTOFF_MIN_HZ,
  SYNTH_GLIDE_MAX_SEC,
  SYNTH_LFO_MAX_HZ,
  SYNTH_LFO_MIN_HZ,
  SYNTH_LFO_PITCH_CENTS,
  SYNTH_PW_MAX,
  SYNTH_PW_MIN,
  SYNTH_Q_MAX_DB,
  SYNTH_Q_MIN_DB,
  SYNTH_ROOT_KEY,
  synthAmpEnvelope,
  synthFilterSweep,
  synthGlideSec,
  synthLfoOf,
  synthOscillatorOf,
  synthSubOf,
  synthVoiceFilter,
  synthWidthSweep,
} from '../../model/synthFace';
import type { SynthParams, Track, Waveform } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useTransportStore } from '../../state/transportStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';
import { ParamKnob } from '../common/widgets';
import {
  EnvelopeGraph,
  FilterCurve,
  InstrumentSection,
  LfoScope,
  OscScope,
  PadWave,
} from '../instrument/displays';
import { InstrumentFrame } from '../instrument/InstrumentFrame';
import { InstrumentKindSelect, SamplerPanel } from '../sampler/SamplerPanel';
import { Keyboard } from './Keyboard';

/** One undo entry per knob sweep, not one per animation frame. */
const beginKnob = () => useProjectStore.getState().beginGesture();
const endKnob = () => useProjectStore.getState().endGesture();

/** Pick the synth target: armed instrument/drum track, else selected, else first. */
export function useSynthTarget(): Track | null {
  const tracks = useProjectStore((s) => s.project.tracks);
  const selId = useUiStore((s) => s.selectedTrackId);
  return useMemo(() => {
    const playable = (t: Track) => t.type === 'instrument' || t.type === 'drum';
    return (
      tracks.find((t) => t.id === selId && playable(t)) ??
      tracks.find((t) => t.armed && playable(t)) ??
      tracks.find(playable) ??
      null
    );
  }, [tracks, selId]);
}

/**
 * The oscillator's three families.
 *
 * The reference's mono synth has no waveform selector at all — one Shape
 * control blends saw into square and everything between is a real wave rather
 * than a fifth button. That is the interesting half of the range, so it becomes
 * one continuous family here; triangle and sine stay as themselves because they
 * are not on that axis and two of our stock patches are made of them.
 *
 * `waveform` is what the family writes, and it stays literally true of the
 * node: the morph is built by subtracting a delayed copy of the sawtooth, so a
 * morphing oscillator IS a sawtooth oscillator.
 */
const WAVE_FAMILIES: { id: Waveform; short: string; name: string; morphs: boolean }[] = [
  { id: 'sawtooth', short: 'Saw–Sqr', name: 'Saw to square', morphs: true },
  { id: 'triangle', short: 'Tri', name: 'Triangle', morphs: false },
  { id: 'sine', short: 'Sin', name: 'Sine', morphs: false },
];

/**
 * Which family a patch belongs to, and where its Shape control sits.
 *
 * A patch saved before the morph existed has no `shape` at all, and a stored
 * square is the top of the morph's range read a different way — so it selects
 * the same family and parks the knob at the square end. It keeps playing the
 * built-in square until the knob is actually moved, at which point the voice
 * builds the pulse instead; at that end of the travel the two are the same
 * wave.
 */
function familyOf(p: SynthParams): Waveform {
  return p.waveform === 'square' ? 'sawtooth' : p.waveform;
}

function shapePosition(p: SynthParams): number {
  return p.shape ?? (p.waveform === 'square' ? 1 : 0);
}

/** Does this patch's oscillator have a pulse for the width to be the width of? */
function morphs(p: SynthParams): boolean {
  return WAVE_FAMILIES.find((w) => w.id === familyOf(p))?.morphs === true;
}

/** The keys the key-tracking ghosts are drawn at: two octaves either side. */
const GHOST_KEYS = [SYNTH_ROOT_KEY - 24, SYNTH_ROOT_KEY + 24];

/**
 * The kit's pads.
 *
 * The reference's drum machine puts a pad grid first and everything else under
 * it, and the pads carry their sound: the envelope drawn on each one is what
 * tells the closed hat from the open one at a glance. Velocity comes from where
 * on the pad it was struck — the top edge is a rimshot, the bottom a ghost note
 * — which is what a pad is for and what a fixed 110 could not do.
 */
function DrumPads({ track, compact }: { track: Track; compact?: boolean }) {
  return (
    <div className={`pads${compact ? ' compact' : ''}`} data-testid="drum-pads">
      {DRUM_PITCHES.map((d) => (
        <button
          key={d.pitch}
          className="pad"
          title={`${d.name} · ${midiToName(d.pitch)} — strike high for hard, low for soft`}
          onPointerDown={(e) => {
            e.preventDefault();
            const box = e.currentTarget.getBoundingClientRect();
            const y = box.height > 0 ? (e.clientY - box.top) / box.height : 0.3;
            engine.liveNoteOn(track.id, d.pitch, padVelocity(y));
          }}
        >
          <span className="pad-head">
            <span className="pad-name">{d.name}</span>
            <span className="hint">{midiToName(d.pitch)}</span>
          </span>
          <PadWave peaks={hitPeaks(d.mediaId)} />
        </button>
      ))}
    </div>
  );
}

/** Softest at the bottom of the pad, hardest at the top — never silent. */
function padVelocity(y: number): number {
  return Math.round(clamp(127 - clamp(y, 0, 1) * 90, 30, 127));
}

/**
 * The hit's envelope, if the media library already has it.
 *
 * Procedural hits resolve synchronously, so there is nothing to await and no
 * state to hold; anything else simply draws no wave rather than making the pad
 * bank wait on a decode it does not need.
 */
function hitPeaks(mediaId: string): { min: Float32Array; max: Float32Array } | null {
  const p = getPeaksSync(mediaId);
  return p ? { min: p.min, max: p.max } : null;
}

/**
 * What this kit is, and the way out of it.
 *
 * The classic kit is five fixed one-shots sharing one level — no per-pad tune,
 * pan, choke or sample of its own. That is a real limit rather than a missing
 * screen, so the panel says so and offers the upgrade instead of pretending
 * there are controls to find. The conversion keeps the keys the part is
 * already written on, so nothing in the arrangement stops making a sound.
 */
function KitSection({ track }: { track: Track }) {
  return (
    <InstrumentSection title="Kit" aside="5 fixed hits">
      <div className="hint">
        TX Drum Kit plays five built-in hits at one shared level. The Drum Rack plays the same
        sounds with a level, tune, pan and choke group per pad, and takes your own samples.
      </div>
      <button
        className="btn primary"
        data-testid="kit-to-rack"
        title="Rebuild this kit as a Drum Rack on the same keys"
        onClick={() =>
          useProjectStore.getState().applySamplerPreset(track.id, buildClassicKitRack())
        }
      >
        <Icon name="grid" size={12} /> Load into Drum Rack
      </button>
      <div className="hint">
        Keeps {DRUM_PITCHES.map((d) => midiToName(d.pitch)).join(' · ')}, so the parts you have
        written keep playing.
      </div>
    </InstrumentSection>
  );
}

function MidiSection() {
  const supported = useTransportStore((s) => s.midiSupported);
  const enabled = useTransportStore((s) => s.midiEnabled);
  const inputs = useTransportStore((s) => s.midiInputs);
  const selectedId = useTransportStore((s) => s.midiSelectedId);
  const activity = useTransportStore((s) => s.midiActivity);
  const lastEvent = useTransportStore((s) => s.midiLastEvent);

  if (!supported) {
    return (
      <InstrumentSection title="MIDI in">
        <div className="hint" data-testid="midi-status">
          Web MIDI is not supported in this browser. The on-screen and computer keyboards still
          work.
        </div>
      </InstrumentSection>
    );
  }
  return (
    <InstrumentSection title="MIDI in">
      {!enabled ? (
        <button className="btn" onClick={() => void midi.enable()} data-testid="midi-enable">
          Enable MIDI input
        </button>
      ) : (
        <>
          <select
            value={selectedId ?? ''}
            onChange={(e) => midi.select(e.target.value || null)}
            aria-label="MIDI input"
          >
            <option value="">No input</option>
            {inputs.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <div className="hint" data-testid="midi-status">
            {inputs.length === 0
              ? 'No MIDI devices found — connect one and it will appear here.'
              : `${activity} events${lastEvent ? ` · ${lastEvent}` : ''}`}
          </div>
        </>
      )}
    </InstrumentSection>
  );
}

/** How the oscillator reads: the wave, and the pulse if it has one. */
function describeOscillator(p: SynthParams): string {
  const osc = synthOscillatorOf(p);
  if (!morphs(p)) return WAVE_FAMILIES.find((w) => w.id === p.waveform)?.name ?? p.waveform;
  if (!osc.morph) return p.waveform === 'square' ? 'Square' : 'Sawtooth';
  return osc.morph.shape >= 1
    ? `Pulse ${Math.round(osc.morph.width * 100)}%`
    : `Saw–Sqr ${Math.round(osc.morph.shape * 100)}% · PW ${Math.round(osc.morph.width * 100)}%`;
}

/** How the patch reads on one line, for the frame's footer. */
function describePatch(p: SynthParams, isDrum: boolean): string {
  if (isDrum) return `Sample kit · level ${Math.round(p.volume * 100)}%`;
  const filter = synthVoiceFilter(p);
  const sub = synthSubOf(p);
  const lfo = synthLfoOf(p);
  const glide = synthGlideSec(p);
  return [
    describeOscillator(p),
    ...(sub ? [`Sub ${Math.round(sub.gain * 100)}%`] : []),
    ...(glide > 0 ? [`Glide ${formatSeconds(glide)}`] : []),
    `LP ${formatHz(filter.freqHz)} · ${filter.qDb.toFixed(1)} dB`,
    `A ${formatSeconds(p.attack)} · D ${formatSeconds(p.decay)} · S ${Math.round(
      p.sustain * 100,
    )}% · R ${formatSeconds(p.release)}`,
    ...(lfo ? [`LFO ${lfo.rateHz.toFixed(2)} Hz`] : []),
  ].join(' · ');
}

export function SynthPanel({ performMode }: { performMode?: boolean }) {
  const track = useSynthTarget();
  const setSynthParams = useProjectStore((s) => s.setSynthParams);
  const applyPreset = useProjectStore((s) => s.applyPreset);

  // Sampler and instrument-rack tracks get the sampler workstation instead.
  if (track && (track.sampler || track.rack?.items.length)) {
    return <SamplerPanel track={track} performMode={performMode} />;
  }

  if (!track || !track.synth) {
    return (
      <div className="syn">
        <div className="syn-empty">
          <Icon name="piano" size={28} />
          <div>No instrument track available.</div>
          <button
            className="btn primary"
            onClick={() => {
              const id = useProjectStore.getState().addTrack('instrument');
              useUiStore.getState().selectTrack(id);
            }}
          >
            Add instrument track
          </button>
        </div>
      </div>
    );
  }

  const p = track.synth;
  const set = (patch: Partial<SynthParams>) => setSynthParams(track.id, patch);
  const isDrum = track.type === 'drum';
  const store = useProjectStore.getState();
  const gesture = {
    onGestureStart: () => store.beginGesture(),
    onGestureEnd: () => store.endGesture(),
  };

  const filter = synthVoiceFilter(p);
  const envelope = synthAmpEnvelope(p);
  // Everything the oscillator section draws comes from the descriptors the
  // voice builds itself from, so a picture of a pulse that the audio is not
  // making is not expressible here.
  const oscillator = synthOscillatorOf(p);
  const sub = synthSubOf(p);
  const lfo = synthLfoOf(p);
  const widthSweep = synthWidthSweep(oscillator, lfo);
  const family = familyOf(p);
  const canMorph = morphs(p);
  // One range for the knob, the curve handle, the automation lane and the
  // voice: the knob used to stop at 12 kHz while everything else reached 18.
  const cutoffSpan = Math.log(SYNTH_CUTOFF_MAX_HZ / SYNTH_CUTOFF_MIN_HZ);
  const cutoffNorm = Math.log(p.cutoff / SYNTH_CUTOFF_MIN_HZ) / cutoffSpan;
  const lfoSpan = Math.log(SYNTH_LFO_MAX_HZ / SYNTH_LFO_MIN_HZ);
  const lfoRate = clamp(p.lfoRate ?? 5, SYNTH_LFO_MIN_HZ, SYNTH_LFO_MAX_HZ);

  return (
    <InstrumentFrame<SynthParams>
      name={isDrum ? 'TX Drum Kit' : 'MotionSynth'}
      track={track}
      testId="synth-panel"
      className={
        `${isDrum ? 'is-drum' : ''}${performMode ? ' perform-page' : ''}`.trim() || undefined
      }
      summary={describePatch(p, isDrum)}
      compare={{ take: () => ({ ...p }), put: (v) => set(v) }}
      performance={
        isDrum ? (
          performMode ? (
            <DrumPads track={track} compact />
          ) : undefined
        ) : (
          <Keyboard track={track} octaves={2} />
        )
      }
      controls={
        <>
          <InstrumentKindSelect track={track} />
          {!isDrum && (
            <select
              value={SYNTH_PRESETS.some((x) => x.presetName === p.presetName) ? p.presetName : ''}
              onChange={(e) => e.target.value && applyPreset(track.id, e.target.value)}
              aria-label="Preset"
              data-testid="preset-select"
              className="pw-preset"
            >
              {!SYNTH_PRESETS.some((x) => x.presetName === p.presetName) && (
                <option value="">Custom</option>
              )}
              {SYNTH_PRESETS.map((s) => (
                <option key={s.presetName} value={s.presetName}>
                  {s.presetName}
                </option>
              ))}
            </select>
          )}
          <button
            className="btn danger"
            onClick={() => engine.allNotesOff()}
            title="All notes off"
            data-testid="notes-off"
          >
            <Icon name="zap" size={12} /> Notes off
          </button>
        </>
      }
    >
      <div className="ins-sections">
        {/* Pads first, and widest: the reference's convention for a drum
            machine is that the pad grid IS the face and everything else sits
            under it. On the phone's perform page they are pinned below the
            body instead, because there the controls are the thing you scroll
            to and the pads are the thing you play. */}
        {isDrum && !performMode && (
          <InstrumentSection title="Pads" full aside={`${DRUM_PITCHES.length} hits`}>
            <DrumPads track={track} />
          </InstrumentSection>
        )}

        {!isDrum && (
          <>
            <InstrumentSection title="Oscillator" wide aside={describeOscillator(p)}>
              <OscScope
                osc={oscillator}
                sub={sub}
                widthSweep={widthSweep}
                testId="syn-osc"
                label={`Oscillator: ${describeOscillator(p)}${
                  sub ? `, sub an octave down at ${Math.round(sub.gain * 100)}%` : ''
                }${
                  widthSweep
                    ? `, width swept ${Math.round(widthSweep.lowDuty * 100)}% to ${Math.round(
                        widthSweep.highDuty * 100,
                      )}%`
                    : ''
                }`}
              />
              {(sub || widthSweep) && (
                <div className="ins-legend">
                  {sub && <span className="t-label">Dashed: sub −1 oct</span>}
                  <span className="grow" />
                  {widthSweep && <span className="t-label">Faint: LFO width sweep</span>}
                </div>
              )}
              <div className="seg" role="group" aria-label="Waveform">
                {WAVE_FAMILIES.map((w) => (
                  <button
                    key={w.id}
                    className={family === w.id ? 'on' : ''}
                    aria-pressed={family === w.id}
                    // Selecting the family already selected writes nothing:
                    // a patch stored as a plain square belongs to this family
                    // without holding a `shape`, and answering the click would
                    // turn it into the sawtooth underneath. Leaving the morph
                    // clears `shape` rather than parking it at zero, so a
                    // triangle patch is stored exactly as a triangle patch
                    // always was and builds the same one-oscillator voice.
                    onClick={() => {
                      if (family === w.id) return;
                      set(w.morphs ? { waveform: w.id } : { waveform: w.id, shape: undefined });
                    }}
                    title={w.name}
                  >
                    {w.short}
                  </button>
                ))}
              </div>
              <div className="syn-knobs">
                {/* Shape and Width belong to the saw–square family and are not
                    drawn for the other two, which have no morph and no pulse.
                    A dial that reads "—" is still a dial a hand lands on, and
                    landing on this one would have turned a sine patch into a
                    sawtooth without asking. */}
                {canMorph && (
                  <ParamKnob
                    label="Shape"
                    norm={shapePosition(p)}
                    onNorm={(n) => set({ waveform: 'sawtooth', shape: Math.round(n * 100) / 100 })}
                    display={
                      shapePosition(p) <= 0
                        ? 'Saw'
                        : shapePosition(p) >= 1
                          ? 'Square'
                          : `${Math.round(shapePosition(p) * 100)}%`
                    }
                    onGestureStart={beginKnob}
                    onGestureEnd={endKnob}
                  />
                )}
                {canMorph && (
                  <ParamKnob
                    label="Width"
                    norm={
                      (clamp(p.pulseWidth ?? 0.5, SYNTH_PW_MIN, SYNTH_PW_MAX) - SYNTH_PW_MIN) /
                      (SYNTH_PW_MAX - SYNTH_PW_MIN)
                    }
                    onNorm={(n) =>
                      set({
                        pulseWidth:
                          Math.round((SYNTH_PW_MIN + n * (SYNTH_PW_MAX - SYNTH_PW_MIN)) * 100) /
                          100,
                      })
                    }
                    // The width has nothing to be the width of until the morph
                    // is off the saw end, and saying so is better than a
                    // percentage that changes the sound by nothing.
                    display={
                      oscillator.morph
                        ? `${Math.round(
                            clamp(p.pulseWidth ?? 0.5, SYNTH_PW_MIN, SYNTH_PW_MAX) * 100,
                          )}%`
                        : 'No pulse'
                    }
                    onGestureStart={beginKnob}
                    onGestureEnd={endKnob}
                  />
                )}
                <ParamKnob
                  label="Sub"
                  norm={clamp(p.subLevel ?? 0, 0, 1)}
                  onNorm={(n) => set({ subLevel: Math.round(n * 100) / 100 })}
                  display={sub ? `${Math.round(sub.gain * 100)}%` : 'Off'}
                  onGestureStart={beginKnob}
                  onGestureEnd={endKnob}
                />
                <ParamKnob
                  label="Glide"
                  // Cubed, like the envelope times: portamento lives in the
                  // first tenth of a second and a linear knob would hide it.
                  norm={Math.pow(synthGlideSec(p) / SYNTH_GLIDE_MAX_SEC, 1 / 3)}
                  onNorm={(n) =>
                    set({
                      glide: Math.round(Math.pow(n, 3) * SYNTH_GLIDE_MAX_SEC * 1000) / 1000,
                    })
                  }
                  display={synthGlideSec(p) > 0 ? formatSeconds(synthGlideSec(p)) : 'Off'}
                  onGestureStart={beginKnob}
                  onGestureEnd={endKnob}
                />
              </div>
            </InstrumentSection>

            <InstrumentSection
              title="Filter"
              wide
              aside={`${formatHz(filter.freqHz)} · ${filter.qDb.toFixed(1)} dB`}
            >
              <FilterCurve
                filter={filter}
                testId="syn-filter"
                label="Filter response"
                // The voice opens the cutoff with the key, so the corner a note
                // is played through is not the one the knob reads. Two octaves
                // either side of C4 is the span these ghosts show.
                ghosts={GHOST_KEYS.map((key) => ({
                  filter: synthVoiceFilter(p, key),
                  label: midiToName(key),
                }))}
                // The band the modulator actually sweeps the corner through —
                // drawn on the curve rather than left as a percentage on a dial
                // in another section, because that is where it is heard.
                sweep={synthFilterSweep(filter, lfo)}
                cutoff={{
                  value: p.cutoff,
                  min: SYNTH_CUTOFF_MIN_HZ,
                  max: SYNTH_CUTOFF_MAX_HZ,
                  onChange: (hz) => set({ cutoff: Math.round(hz) }),
                }}
                resonance={{
                  value: p.resonance,
                  min: SYNTH_Q_MIN_DB,
                  max: SYNTH_Q_MAX_DB,
                  // Two decimals, not one: the voice's floor is 0.05 dB, and
                  // a coarser grid would make the bottom of the range a place
                  // the control could not actually reach.
                  onChange: (db) => set({ resonance: Math.round(db * 100) / 100 }),
                }}
                {...gesture}
              />
              <div className="ins-legend">
                <span className="t-label">Key track ±2 oct</span>
                <span className="grow" />
                <span className="t-label">Quoted at {midiToName(SYNTH_ROOT_KEY)}</span>
              </div>
              <div className="syn-knobs">
                <ParamKnob
                  label="Cutoff"
                  norm={clamp(cutoffNorm, 0, 1)}
                  onNorm={(n) =>
                    set({ cutoff: Math.round(SYNTH_CUTOFF_MIN_HZ * Math.exp(n * cutoffSpan)) })
                  }
                  display={formatHz(p.cutoff)}
                  onGestureStart={beginKnob}
                  onGestureEnd={endKnob}
                />
                <ParamKnob
                  label="Res"
                  norm={clamp(
                    (p.resonance - SYNTH_Q_MIN_DB) / (SYNTH_Q_MAX_DB - SYNTH_Q_MIN_DB),
                    0,
                    1,
                  )}
                  onNorm={(n) =>
                    set({
                      resonance:
                        Math.round((SYNTH_Q_MIN_DB + n * (SYNTH_Q_MAX_DB - SYNTH_Q_MIN_DB)) * 100) /
                        100,
                    })
                  }
                  // The filter's magnitude at its own corner is its Q, and this
                  // Q is in decibels — so this number is the lift you can read
                  // off the curve above, not an abstract quality factor.
                  display={`${p.resonance.toFixed(1)} dB`}
                  onGestureStart={beginKnob}
                  onGestureEnd={endKnob}
                />
              </div>
            </InstrumentSection>

            <InstrumentSection
              title="Amp envelope"
              wide
              aside={`${formatSeconds(p.attack)} · ${formatSeconds(p.decay)} · ${Math.round(
                p.sustain * 100,
              )}% · ${formatSeconds(p.release)}`}
            >
              <EnvelopeGraph env={envelope} label="Amplitude envelope" testId="syn-env" />
              <div className="syn-knobs">
                <ParamKnob
                  label="A"
                  norm={Math.pow(p.attack / 2, 1 / 3)}
                  onNorm={(n) => set({ attack: Math.round(Math.pow(n, 3) * 2 * 1000) / 1000 })}
                  display={formatSeconds(p.attack)}
                  onGestureStart={beginKnob}
                  onGestureEnd={endKnob}
                />
                <ParamKnob
                  label="D"
                  norm={Math.pow(p.decay / 2, 1 / 3)}
                  onNorm={(n) =>
                    set({ decay: Math.max(0.01, Math.round(Math.pow(n, 3) * 2 * 1000) / 1000) })
                  }
                  display={formatSeconds(p.decay)}
                  onGestureStart={beginKnob}
                  onGestureEnd={endKnob}
                />
                <ParamKnob
                  label="S"
                  norm={p.sustain}
                  onNorm={(n) => set({ sustain: Math.round(n * 100) / 100 })}
                  display={`${Math.round(p.sustain * 100)}%`}
                  onGestureStart={beginKnob}
                  onGestureEnd={endKnob}
                />
                <ParamKnob
                  label="R"
                  norm={Math.pow(p.release / 3, 1 / 3)}
                  onNorm={(n) =>
                    set({ release: Math.max(0.01, Math.round(Math.pow(n, 3) * 3 * 1000) / 1000) })
                  }
                  display={formatSeconds(p.release)}
                  onGestureStart={beginKnob}
                  onGestureEnd={endKnob}
                />
              </div>
            </InstrumentSection>

            {/* One LFO, three fixed destinations, a depth each — the reference's
                small synth calls this a matrix without a matrix, and it is the
                right trade at this size: nothing to route, nothing to leave
                pointing at nothing. Each dial names where it goes, and each
                destination shows the modulation where it is heard: the filter
                curve shades the band the corner sweeps, and the oscillator
                scope traces the two pulse widths. */}
            <InstrumentSection
              title="LFO"
              wide
              aside={
                lfo
                  ? [
                      `${lfo.rateHz.toFixed(2)} Hz`,
                      ...(lfo.toPitchCents > 0 ? [`±${Math.round(lfo.toPitchCents)} cents`] : []),
                      ...(lfo.toFilterHz > 0 ? [`±${formatHz(lfo.toFilterHz)}`] : []),
                      ...(lfo.toWidthDuty > 0
                        ? [`±${Math.round(lfo.toWidthDuty * 100)}% width`]
                        : []),
                    ].join(' · ')
                  : 'Off'
              }
            >
              {lfo ? (
                <LfoScope
                  lfo={lfo}
                  testId="syn-lfo"
                  label={`Modulator, ${lfo.rateHz.toFixed(2)} Hz`}
                />
              ) : (
                <div className="hint" data-testid="syn-lfo-off">
                  Every depth is at zero, so the voice builds no modulator at all.
                </div>
              )}
              {lfo && (p.lfoToWidth ?? 0) > 0 && lfo.toWidthDuty <= 0 && (
                <div className="hint" data-testid="syn-lfo-width-inert">
                  {oscillator.morph
                    ? 'The width is at the end of its travel, so there is no room left to sweep it.'
                    : 'The oscillator has no pulse, so the width depth reaches nothing.'}
                </div>
              )}
              <div className="syn-knobs">
                <ParamKnob
                  label="Rate"
                  norm={clamp(Math.log(lfoRate / SYNTH_LFO_MIN_HZ) / lfoSpan, 0, 1)}
                  onNorm={(n) =>
                    set({
                      lfoRate:
                        Math.round(SYNTH_LFO_MIN_HZ * Math.exp(n * lfoSpan) * 100) / 100,
                    })
                  }
                  display={`${lfoRate.toFixed(2)} Hz`}
                  onGestureStart={beginKnob}
                  onGestureEnd={endKnob}
                />
                <ParamKnob
                  label="Pitch"
                  norm={clamp(p.lfoToPitch ?? 0, 0, 1)}
                  onNorm={(n) => set({ lfoToPitch: Math.round(n * 100) / 100 })}
                  display={
                    lfo && lfo.toPitchCents > 0 ? `±${Math.round(lfo.toPitchCents)} c` : 'Off'
                  }
                  onGestureStart={beginKnob}
                  onGestureEnd={endKnob}
                />
                <ParamKnob
                  label="Filter"
                  norm={clamp(p.lfoToFilter ?? 0, 0, 1)}
                  onNorm={(n) => set({ lfoToFilter: Math.round(n * 100) / 100 })}
                  display={lfo && lfo.toFilterHz > 0 ? `±${formatHz(lfo.toFilterHz)}` : 'Off'}
                  onGestureStart={beginKnob}
                  onGestureEnd={endKnob}
                />
                <ParamKnob
                  label="Width"
                  norm={clamp(p.lfoToWidth ?? 0, 0, 1)}
                  onNorm={(n) => set({ lfoToWidth: Math.round(n * 100) / 100 })}
                  // The reachable swing, not the dial position: the sweep is
                  // held inside the width's own range so the pulse cannot be
                  // driven through zero and collapse into the bare oscillator.
                  display={
                    lfo && lfo.toWidthDuty > 0 ? `±${Math.round(lfo.toWidthDuty * 100)}%` : 'Off'
                  }
                  onGestureStart={beginKnob}
                  onGestureEnd={endKnob}
                />
              </div>
              <div className="ins-legend">
                <span className="t-label">
                  Pitch ±{SYNTH_LFO_PITCH_CENTS} cents · filter ±half the cutoff
                </span>
              </div>
            </InstrumentSection>
          </>
        )}

        <InstrumentSection title="Output">
          <div className="syn-knobs">
            <ParamKnob
              label="Volume"
              norm={p.volume}
              onNorm={(n) => set({ volume: Math.round(n * 100) / 100 })}
              display={`${Math.round(p.volume * 100)}%`}
              onGestureStart={beginKnob}
              onGestureEnd={endKnob}
            />
            <ParamKnob
              label="Pan"
              norm={(track.pan + 1) / 2}
              onNorm={(n) =>
                useProjectStore
                  .getState()
                  .setTrack(track.id, { pan: Math.round((n * 2 - 1) * 100) / 100 })
              }
              display={
                track.pan === 0
                  ? 'C'
                  : `${Math.abs(Math.round(track.pan * 100))}${track.pan < 0 ? 'L' : 'R'}`
              }
              onGestureStart={beginKnob}
              onGestureEnd={endKnob}
            />
          </div>
        </InstrumentSection>

        {isDrum && <KitSection track={track} />}

        <MidiSection />
      </div>

      {!performMode && (
        <div className="hint ins-hint">
          Computer keys: A–L rows play notes · Z/X shift octave · keys route to the armed track
        </div>
      )}
    </InstrumentFrame>
  );
}

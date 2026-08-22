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
import { formatHz } from '../../model/effects';
import { clamp, midiToName } from '../../model/music';
import { DRUM_PITCHES, SYNTH_PRESETS } from '../../model/presets';
import {
  formatSeconds,
  SYNTH_CUTOFF_MAX_HZ,
  SYNTH_CUTOFF_MIN_HZ,
  SYNTH_Q_MAX_DB,
  SYNTH_Q_MIN_DB,
  SYNTH_ROOT_KEY,
  synthAmpEnvelope,
  synthVoiceFilter,
} from '../../model/synthFace';
import type { SynthParams, Track, Waveform } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useTransportStore } from '../../state/transportStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';
import { ParamKnob } from '../common/widgets';
import { EnvelopeGraph, FilterCurve, InstrumentSection, OscScope } from '../instrument/displays';
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

const WAVES: { id: Waveform; short: string; name: string }[] = [
  { id: 'sawtooth', short: 'Saw', name: 'Sawtooth' },
  { id: 'square', short: 'Sqr', name: 'Square' },
  { id: 'triangle', short: 'Tri', name: 'Triangle' },
  { id: 'sine', short: 'Sin', name: 'Sine' },
];

/** The keys the key-tracking ghosts are drawn at: two octaves either side. */
const GHOST_KEYS = [SYNTH_ROOT_KEY - 24, SYNTH_ROOT_KEY + 24];

function DrumPads({ track }: { track: Track }) {
  return (
    <div className="pads" data-testid="drum-pads">
      {DRUM_PITCHES.map((d) => (
        <button
          key={d.pitch}
          className="pad"
          onPointerDown={(e) => {
            e.preventDefault();
            engine.liveNoteOn(track.id, d.pitch, 110);
          }}
        >
          <Icon name="grid" size={15} />
          {d.name}
          <span className="hint">{midiToName(d.pitch)}</span>
        </button>
      ))}
    </div>
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

/** How the patch reads on one line, for the frame's footer. */
function describePatch(p: SynthParams, isDrum: boolean): string {
  if (isDrum) return `Sample kit · level ${Math.round(p.volume * 100)}%`;
  const wave = WAVES.find((w) => w.id === p.waveform)?.name ?? p.waveform;
  const filter = synthVoiceFilter(p);
  return [
    wave,
    `LP ${formatHz(filter.freqHz)} · ${filter.qDb.toFixed(1)} dB`,
    `A ${formatSeconds(p.attack)} · D ${formatSeconds(p.decay)} · S ${Math.round(
      p.sustain * 100,
    )}% · R ${formatSeconds(p.release)}`,
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
  // One range for the knob, the curve handle, the automation lane and the
  // voice: the knob used to stop at 12 kHz while everything else reached 18.
  const cutoffSpan = Math.log(SYNTH_CUTOFF_MAX_HZ / SYNTH_CUTOFF_MIN_HZ);
  const cutoffNorm = Math.log(p.cutoff / SYNTH_CUTOFF_MIN_HZ) / cutoffSpan;

  return (
    <InstrumentFrame<SynthParams>
      name={isDrum ? 'TX Drum Kit' : 'MotionSynth'}
      track={track}
      testId="synth-panel"
      className={performMode ? 'perform-page' : undefined}
      summary={describePatch(p, isDrum)}
      compare={{ take: () => ({ ...p }), put: (v) => set(v) }}
      performance={isDrum ? <DrumPads track={track} /> : <Keyboard track={track} octaves={2} />}
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
        {!isDrum && (
          <>
            <InstrumentSection
              title="Oscillator"
              aside={WAVES.find((w) => w.id === p.waveform)?.name}
            >
              <OscScope shape={p.waveform} label={`Oscillator waveform: ${p.waveform}`} />
              <div className="seg" role="group" aria-label="Waveform">
                {WAVES.map((w) => (
                  <button
                    key={w.id}
                    className={p.waveform === w.id ? 'on' : ''}
                    aria-pressed={p.waveform === w.id}
                    onClick={() => set({ waveform: w.id })}
                    title={w.name}
                  >
                    {w.short}
                  </button>
                ))}
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

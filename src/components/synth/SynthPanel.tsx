import { useMemo } from 'react';
import { engine } from '../../audio/engine';
import { midi } from '../../audio/midi';
import { clamp, midiToName } from '../../model/music';
import { DRUM_PITCHES, SYNTH_PRESETS } from '../../model/presets';
import type { SynthParams, Track, Waveform } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useTransportStore } from '../../state/transportStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';
import { ParamKnob } from '../common/widgets';
import { InstrumentKindSelect, SamplerPanel } from '../sampler/SamplerPanel';
import { Keyboard } from './Keyboard';

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
      <div className="syn-group">
        <div className="g-title">MIDI</div>
        <div className="hint" data-testid="midi-status">
          Web MIDI is not supported in this browser.
          <br />
          The on-screen and computer keyboards still work.
        </div>
      </div>
    );
  }
  return (
    <div className="syn-group">
      <div className="g-title">MIDI</div>
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
    </div>
  );
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

  // knob mappings
  const cutoffNorm = Math.log(p.cutoff / 40) / Math.log(12000 / 40);
  const setCutoff = (n: number) => set({ cutoff: Math.round(40 * Math.pow(12000 / 40, n)) });

  return (
    <div className={`syn${performMode ? ' perform-page' : ''}`} data-testid="synth-panel">
      <div className="syn-scroll">
        <div className="syn-head">
          <span className="syn-title" title={track.name}>
            <span className="swatch" style={{ background: track.color }} />
            <span className="syn-title-text">
              {isDrum ? 'TX Drum Kit' : 'MotionSynth'} — {track.name}
            </span>
          </span>
          <InstrumentKindSelect track={track} />
          {!isDrum && (
            <select
              value={SYNTH_PRESETS.some((x) => x.presetName === p.presetName) ? p.presetName : ''}
              onChange={(e) => e.target.value && applyPreset(track.id, e.target.value)}
              aria-label="Preset"
              data-testid="preset-select"
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
        </div>

        <div className="syn-controls">
          {!isDrum && (
            <>
              <div className="syn-group">
                <div className="g-title">Oscillator</div>
                <div className="seg" role="group" aria-label="Waveform">
                  {(['sawtooth', 'square', 'triangle', 'sine'] as Waveform[]).map((w) => (
                    <button
                      key={w}
                      className={p.waveform === w ? 'on' : ''}
                      onClick={() => set({ waveform: w })}
                      title={w}
                    >
                      {w === 'sawtooth'
                        ? 'Saw'
                        : w === 'square'
                          ? 'Sqr'
                          : w === 'triangle'
                            ? 'Tri'
                            : 'Sin'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="syn-group">
                <div className="g-title">Filter</div>
                <div className="syn-knobs">
                  <ParamKnob
                    label="Cutoff"
                    norm={clamp(cutoffNorm, 0, 1)}
                    onNorm={setCutoff}
                    display={p.cutoff >= 1000 ? `${(p.cutoff / 1000).toFixed(1)}k` : `${p.cutoff}`}
                  />
                  <ParamKnob
                    label="Res"
                    norm={clamp((p.resonance - 0.1) / 13.9, 0, 1)}
                    onNorm={(n) => set({ resonance: Math.round((0.1 + n * 13.9) * 10) / 10 })}
                    display={p.resonance.toFixed(1)}
                  />
                </div>
              </div>
              <div className="syn-group">
                <div className="g-title">Envelope</div>
                <div className="syn-knobs">
                  <ParamKnob
                    label="A"
                    norm={Math.pow(p.attack / 2, 1 / 3)}
                    onNorm={(n) => set({ attack: Math.round(Math.pow(n, 3) * 2 * 1000) / 1000 })}
                    display={`${(p.attack * 1000).toFixed(0)}ms`}
                  />
                  <ParamKnob
                    label="D"
                    norm={Math.pow(p.decay / 2, 1 / 3)}
                    onNorm={(n) =>
                      set({ decay: Math.max(0.01, Math.round(Math.pow(n, 3) * 2 * 1000) / 1000) })
                    }
                    display={`${(p.decay * 1000).toFixed(0)}ms`}
                  />
                  <ParamKnob
                    label="S"
                    norm={p.sustain}
                    onNorm={(n) => set({ sustain: Math.round(n * 100) / 100 })}
                    display={`${Math.round(p.sustain * 100)}%`}
                  />
                  <ParamKnob
                    label="R"
                    norm={Math.pow(p.release / 3, 1 / 3)}
                    onNorm={(n) =>
                      set({ release: Math.max(0.01, Math.round(Math.pow(n, 3) * 3 * 1000) / 1000) })
                    }
                    display={`${(p.release * 1000).toFixed(0)}ms`}
                  />
                </div>
              </div>
            </>
          )}
          <div className="syn-group">
            <div className="g-title">Output</div>
            <div className="syn-knobs">
              <ParamKnob
                label="Volume"
                norm={p.volume}
                onNorm={(n) => set({ volume: Math.round(n * 100) / 100 })}
                display={`${Math.round(p.volume * 100)}%`}
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
              />
            </div>
          </div>
          <MidiSection />
        </div>

        {isDrum && <DrumPads track={track} />}
        {!performMode && (
          <div className="hint" style={{ padding: '0 10px 6px' }}>
            Computer keys: A–L rows play notes · Z/X shift octave · keys route to the armed track
          </div>
        )}
      </div>
      {!isDrum && <Keyboard track={track} octaves={performMode ? 2 : 2} />}
    </div>
  );
}

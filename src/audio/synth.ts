/**
 * TXPPS MotionSynth — lightweight polyphonic subtractive synth, plus the
 * sample-based drum kit. Instruments render into a track channel input node
 * and register every voice with the engine's source registry so panic /
 * stop-all and the diagnostics active-source count stay truthful.
 */
import { midiToFreq, clamp } from '../model/music';
import type { SynthParams } from '../model/types';
import { getDrumBuffer } from './demoAudio';

export interface SourceRegistry {
  register: (h: ActiveHandle) => void;
  unregister: (h: ActiveHandle) => void;
  /** true when there is room for another source (safety cap) */
  canAllocate: () => boolean;
}

export interface ActiveHandle {
  kind: 'voice' | 'buffer' | 'metronome';
  trackId?: string;
  clipId?: string;
  /** stop with a short fade; hard=true stops as fast as possible */
  stop: (hard?: boolean) => void;
}

export interface Instrument {
  scheduleNote(
    pitch: number,
    velocity: number,
    when: number,
    durSec: number,
    clipId?: string,
  ): void;
  noteOn(pitch: number, velocity: number): void;
  noteOff(pitch: number): void;
  setSustain(on: boolean): void;
  allNotesOff(): void;
  dispose(): void;
}

const MAX_VOICES = 24;

class Voice {
  readonly handle: ActiveHandle;
  private osc: OscillatorNode;
  private filter: BiquadFilterNode;
  private amp: GainNode;
  private ended = false;
  released = false;
  readonly startedAt: number;

  constructor(
    private ctx: AudioContext,
    out: AudioNode,
    params: SynthParams,
    readonly pitch: number,
    velocity: number,
    when: number,
    private onEnd: (v: Voice) => void,
    trackId: string,
    clipId?: string,
  ) {
    this.startedAt = when;
    this.osc = ctx.createOscillator();
    this.osc.type = params.waveform;
    this.osc.frequency.value = midiToFreq(pitch);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    // gentle key tracking keeps high notes from sounding choked
    const keyTrack = Math.pow(2, (pitch - 60) / 24);
    this.filter.frequency.value = clamp(params.cutoff * keyTrack, 40, 18000);
    this.filter.Q.value = clamp(params.resonance, 0.05, 24);
    this.amp = ctx.createGain();
    const peak = clamp(params.volume, 0, 1) * Math.pow(velocity / 127, 1.4) * 0.5;
    const g = this.amp.gain;
    g.setValueAtTime(0, when);
    g.linearRampToValueAtTime(peak, when + Math.max(0.002, params.attack));
    g.setTargetAtTime(
      peak * clamp(params.sustain, 0, 1),
      when + Math.max(0.002, params.attack),
      Math.max(0.01, params.decay) / 3,
    );
    this.osc.connect(this.filter);
    this.filter.connect(this.amp);
    this.amp.connect(out);
    this.osc.onended = () => {
      if (this.ended) return;
      this.ended = true;
      try {
        this.osc.disconnect();
        this.filter.disconnect();
        this.amp.disconnect();
      } catch {}
      this.onEnd(this);
    };
    this.osc.start(when);
    this.releaseTau = Math.max(0.01, params.release) / 3;
    this.handle = { kind: 'voice', trackId, clipId, stop: (hard) => this.stopNow(hard) };
  }

  private releaseTau: number;

  release(at: number): void {
    if (this.ended) return;
    this.released = true;
    this.amp.gain.setTargetAtTime(0, at, this.releaseTau);
    try {
      this.osc.stop(at + this.releaseTau * 6 + 0.05);
    } catch {}
  }

  stopNow(hard?: boolean): void {
    if (this.ended) return;
    this.released = true;
    const t = this.ctx.currentTime;
    const tau = hard ? 0.005 : 0.02;
    this.amp.gain.cancelScheduledValues(t);
    this.amp.gain.setTargetAtTime(0, t, tau);
    try {
      this.osc.stop(t + tau * 6 + 0.02);
    } catch {}
  }
}

export class PolySynth implements Instrument {
  private voices = new Set<Voice>();
  private live = new Map<number, Voice>();
  private sustain = false;
  private sustained = new Set<Voice>();

  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
    private trackId: string,
    private getParams: () => SynthParams,
    private registry: SourceRegistry,
  ) {}

  private spawn(
    pitch: number,
    velocity: number,
    when: number,
    clipId?: string,
  ): Voice | null {
    if (!this.registry.canAllocate()) return null;
    if (this.voices.size >= MAX_VOICES) {
      // steal the oldest voice
      let oldest: Voice | null = null;
      for (const v of this.voices) if (!oldest || v.startedAt < oldest.startedAt) oldest = v;
      oldest?.stopNow(true);
    }
    const v = new Voice(
      this.ctx,
      this.out,
      this.getParams(),
      pitch,
      velocity,
      when,
      (voice) => {
        this.voices.delete(voice);
        this.sustained.delete(voice);
        if (this.live.get(voice.pitch) === voice) this.live.delete(voice.pitch);
        this.registry.unregister(voice.handle);
      },
      this.trackId,
      clipId,
    );
    this.voices.add(v);
    this.registry.register(v.handle);
    return v;
  }

  scheduleNote(pitch: number, velocity: number, when: number, durSec: number, clipId?: string): void {
    const v = this.spawn(pitch, velocity, when, clipId);
    v?.release(when + Math.max(0.02, durSec));
  }

  noteOn(pitch: number, velocity: number): void {
    const existing = this.live.get(pitch);
    if (existing) existing.release(this.ctx.currentTime);
    const v = this.spawn(pitch, velocity, this.ctx.currentTime);
    if (v) this.live.set(pitch, v);
  }

  noteOff(pitch: number): void {
    const v = this.live.get(pitch);
    if (!v) return;
    this.live.delete(pitch);
    if (this.sustain) this.sustained.add(v);
    else v.release(this.ctx.currentTime);
  }

  setSustain(on: boolean): void {
    this.sustain = on;
    if (!on) {
      for (const v of this.sustained) v.release(this.ctx.currentTime);
      this.sustained.clear();
    }
  }

  allNotesOff(): void {
    for (const v of [...this.voices]) v.stopNow();
    this.live.clear();
    this.sustained.clear();
  }

  dispose(): void {
    this.allNotesOff();
  }
}

/** Sample-based drum kit (kick/snare/clap/hats) sharing the Instrument interface. */
export class DrumKit implements Instrument {
  private active = new Set<{ src: AudioBufferSourceNode; g: GainNode; handle: ActiveHandle }>();

  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
    private trackId: string,
    private getParams: () => SynthParams,
    private registry: SourceRegistry,
  ) {}

  private trigger(pitch: number, velocity: number, when: number, clipId?: string): void {
    if (!this.registry.canAllocate()) return;
    const buffer = getDrumBuffer(pitch);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = clamp(this.getParams().volume, 0, 1) * Math.pow(velocity / 127, 1.3);
    src.connect(g);
    g.connect(this.out);
    const entry = {
      src,
      g,
      handle: {
        kind: 'buffer' as const,
        trackId: this.trackId,
        clipId,
        stop: (hard?: boolean) => {
          const t = this.ctx.currentTime;
          g.gain.setTargetAtTime(0, t, hard ? 0.004 : 0.015);
          try {
            src.stop(t + 0.06);
          } catch {}
        },
      },
    };
    src.onended = () => {
      this.active.delete(entry);
      this.registry.unregister(entry.handle);
      try {
        src.disconnect();
        g.disconnect();
      } catch {}
    };
    this.active.add(entry);
    this.registry.register(entry.handle);
    src.start(when);
  }

  scheduleNote(pitch: number, velocity: number, when: number, _durSec: number, clipId?: string): void {
    this.trigger(pitch, velocity, when, clipId);
  }

  noteOn(pitch: number, velocity: number): void {
    this.trigger(pitch, velocity, this.ctx.currentTime);
  }

  noteOff(): void {
    // one-shots — nothing to do
  }

  setSustain(): void {}

  allNotesOff(): void {
    for (const e of [...this.active]) e.handle.stop(true);
  }

  dispose(): void {
    this.allNotesOff();
  }
}

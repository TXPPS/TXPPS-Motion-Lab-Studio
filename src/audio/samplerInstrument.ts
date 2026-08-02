/**
 * Sampler voice engine — implements the same Instrument contract the synth
 * does, so the scheduler, the export renderer, live keys and the source
 * registry treat a sampler track exactly like any instrument.
 *
 * Voice graph: BufferSource → (Biquad?) → Gain(ADSR) → Panner → out, with an
 * optional per-voice LFO (osc + gain) into pitch detune or filter frequency.
 * Reversed playback uses a cached reversed copy of the buffer.
 */
import { clamp } from '../model/music';
import {
  matchZones,
  zonePlaybackRate,
  type SamplerParams,
  type SampleZone,
} from '../model/sampler';
import { getBufferSync } from './mediaLibrary';
import type { ActiveHandle, Instrument, SourceRegistry } from './synth';

const MAX_SAMPLER_VOICES = 48;

const reversedCache = new WeakMap<AudioBuffer, AudioBuffer>();

function reversedBuffer(ctx: BaseAudioContext, buf: AudioBuffer): AudioBuffer {
  let rev = reversedCache.get(buf);
  if (!rev) {
    rev = new AudioBuffer({
      numberOfChannels: buf.numberOfChannels,
      length: buf.length,
      sampleRate: buf.sampleRate,
    });
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const src = buf.getChannelData(ch);
      const dst = rev.getChannelData(ch);
      for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i];
    }
    reversedCache.set(buf, rev);
    void ctx; // ctx only anchors the API shape; AudioBuffer is context-free
  }
  return rev;
}

interface SamplerVoice {
  zoneId: string;
  chokeGroup?: number;
  key: number;
  startedAt: number;
  oneShot: boolean;
  stop: (hard: boolean) => void;
  /** begin the release stage (note-off) */
  release: (when: number) => void;
  handle: ActiveHandle;
}

export class SamplerInstrument implements Instrument {
  private voices = new Set<SamplerVoice>();
  private live = new Map<number, SamplerVoice[]>();
  private sustain = false;
  private sustained = new Set<SamplerVoice>();
  private rrCounters = new Map<number, number>();

  constructor(
    private ctx: BaseAudioContext,
    private out: AudioNode,
    private trackId: string,
    private getParams: () => SamplerParams,
    private registry: SourceRegistry,
  ) {}

  private spawn(
    zone: SampleZone,
    xfGain: number,
    key: number,
    velocity: number,
    when: number,
    durSec: number | null,
    clipId?: string,
  ): void {
    if (!this.registry.canAllocate()) return;
    if (this.voices.size >= MAX_SAMPLER_VOICES) {
      let oldest: SamplerVoice | null = null;
      for (const v of this.voices) if (!oldest || v.startedAt < oldest.startedAt) oldest = v;
      oldest?.stop(true);
    }
    const p = this.getParams();
    const raw = getBufferSync(zone.mediaId);
    if (!raw) return;
    const buffer = zone.reverse ? reversedBuffer(this.ctx, raw) : raw;

    // Choke: a new voice in the group ends the running ones at its start time.
    if (zone.chokeGroup !== undefined) {
      for (const v of [...this.voices]) {
        if (v.chokeGroup === zone.chokeGroup && v.zoneId !== zone.id) v.release(when);
      }
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = zonePlaybackRate(zone, key);

    const dur = buffer.duration;
    // The window is authored against the forward waveform; mirror it when
    // playing the reversed copy so "start" still means the same material.
    const winStart = clamp(zone.startSec, 0, dur);
    const winEnd = clamp(zone.endSec ?? dur, winStart, dur);
    const offset = zone.reverse ? dur - winEnd : winStart;
    const windowSec = Math.max(0.005, winEnd - winStart);
    if (zone.loop) {
      src.loop = true;
      const ls = clamp(zone.loopStartSec ?? winStart, winStart, winEnd);
      const le = clamp(zone.loopEndSec ?? winEnd, ls + 0.003, winEnd);
      src.loopStart = zone.reverse ? dur - le : ls;
      src.loopEnd = zone.reverse ? dur - ls : le;
    }

    const gainNode = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = clamp(zone.pan, -1, 1);

    let filter: BiquadFilterNode | null = null;
    if (p.filterType !== 'off') {
      filter = this.ctx.createBiquadFilter();
      filter.type = p.filterType;
      filter.frequency.value = p.filterCutoff;
      filter.Q.value = p.filterRes;
    }

    let lfo: OscillatorNode | null = null;
    let lfoGain: GainNode | null = null;
    if (p.lfoTarget !== 'off' && p.lfoDepth > 0) {
      lfo = this.ctx.createOscillator();
      lfo.frequency.value = p.lfoRate;
      lfoGain = this.ctx.createGain();
      lfo.connect(lfoGain);
      if (p.lfoTarget === 'pitch') {
        lfoGain.gain.value = p.lfoDepth * 100; // up to a semitone in cents
        lfoGain.connect(src.detune);
      } else if (filter) {
        lfoGain.gain.value = p.lfoDepth * p.filterCutoff * 0.5;
        lfoGain.connect(filter.frequency);
      }
      lfo.start(when);
    }

    src.connect(filter ?? gainNode);
    if (filter) filter.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(this.out);

    // Velocity → gain (sensitivity blend), zone gain, crossfade, master.
    const velCurve = Math.pow(clamp(velocity, 1, 127) / 127, 1.2);
    const velGain = 1 - p.velToGain + p.velToGain * velCurve;
    const peak = clamp(zone.gain, 0, 4) * xfGain * velGain * clamp(p.volume, 0, 1.5);

    // ADSR on the gain node.
    const a = Math.max(0.001, p.attack);
    const d = Math.max(0.001, p.decay);
    const s = clamp(p.sustain, 0, 1);
    gainNode.gain.setValueAtTime(0.0001, when);
    gainNode.gain.linearRampToValueAtTime(peak, when + a);
    gainNode.gain.setTargetAtTime(peak * Math.max(0.0001, s), when + a, d / 3);

    let ended = false;
    const cleanup = () => {
      if (ended) return;
      ended = true;
      this.voices.delete(voice);
      this.sustained.delete(voice);
      const list = this.live.get(key);
      if (list) {
        const i = list.indexOf(voice);
        if (i >= 0) list.splice(i, 1);
        if (list.length === 0) this.live.delete(key);
      }
      this.registry.unregister(voice.handle);
      try {
        src.disconnect();
        gainNode.disconnect();
        panner.disconnect();
        filter?.disconnect();
        lfoGain?.disconnect();
        lfo?.stop();
        lfo?.disconnect();
      } catch {
        /* already gone */
      }
    };

    const release = (at: number) => {
      const r = Math.max(0.005, this.getParams().release);
      gainNode.gain.cancelScheduledValues(at);
      gainNode.gain.setTargetAtTime(0.0001, at, r / 3);
      try {
        src.stop(at + r + 0.05);
      } catch {
        /* already stopped */
      }
    };

    const voice: SamplerVoice = {
      zoneId: zone.id,
      chokeGroup: zone.chokeGroup,
      key,
      startedAt: when,
      oneShot: zone.oneShot,
      release,
      stop: (hard) => {
        const t = this.ctx.currentTime;
        gainNode.gain.cancelScheduledValues(t);
        gainNode.gain.setTargetAtTime(0.0001, t, hard ? 0.004 : 0.02);
        try {
          src.stop(t + (hard ? 0.02 : 0.09));
        } catch {
          /* already stopped */
        }
      },
      handle: {
        kind: 'voice',
        trackId: this.trackId,
        clipId,
        stop: (hard) => voice.stop(hard === true),
      },
    };

    src.onended = cleanup;
    this.voices.add(voice);
    const list = this.live.get(key) ?? [];
    list.push(voice);
    this.live.set(key, list);
    this.registry.register(voice.handle);

    src.start(when, clamp(offset, 0, Math.max(0, dur - 0.005)));
    if (!zone.loop) {
      // Bound playback to the window (rate-adjusted); one-shots always run
      // the window out, timed notes may be released earlier by durSec below.
      const playSec = windowSec / Math.max(0.05, src.playbackRate.value);
      try {
        src.stop(when + playSec + Math.max(0.005, this.getParams().release) + 0.1);
      } catch {
        /* concurrent stop */
      }
      release(when + playSec);
    }
    if (durSec !== null && !zone.oneShot) {
      release(when + Math.max(0.01, durSec));
    }
  }

  private trigger(
    key: number,
    velocity: number,
    when: number,
    durSec: number | null,
    clipId?: string,
  ): void {
    const p = this.getParams();
    for (const hit of matchZones(p.zones, key, velocity, this.rrCounters)) {
      this.spawn(hit.zone, hit.xfGain, key, velocity, when, durSec, clipId);
    }
  }

  scheduleNote(pitch: number, velocity: number, when: number, durSec: number, clipId?: string): void {
    this.trigger(pitch, velocity, when, durSec, clipId);
  }

  noteOn(pitch: number, velocity: number): void {
    this.trigger(pitch, velocity, this.ctx.currentTime + 0.003, null);
  }

  noteOff(pitch: number): void {
    const list = this.live.get(pitch);
    if (!list) return;
    for (const v of [...list]) {
      if (v.oneShot) continue;
      if (this.sustain) this.sustained.add(v);
      else v.release(this.ctx.currentTime + 0.003);
    }
  }

  setSustain(on: boolean): void {
    this.sustain = on;
    if (!on) {
      for (const v of [...this.sustained]) v.release(this.ctx.currentTime + 0.003);
      this.sustained.clear();
    }
  }

  allNotesOff(): void {
    for (const v of [...this.voices]) v.stop(false);
  }

  dispose(): void {
    for (const v of [...this.voices]) v.stop(true);
    this.voices.clear();
  }

  /** Test/diagnostic probe. */
  activeVoices(): number {
    return this.voices.size;
  }
}

/**
 * Instrument rack: multiple child instruments on one track, each answering a
 * key range with its own mute/solo. Children share the track channel, so the
 * mixer, sends, inserts and track automation all keep working unchanged.
 */
export interface RackChild {
  id: string;
  keyLo: number;
  keyHi: number;
  muted: boolean;
  solo: boolean;
  instrument: Instrument;
}

export class RackInstrument implements Instrument {
  constructor(private children: () => RackChild[]) {}

  private targets(pitch: number): Instrument[] {
    const kids = this.children();
    const soloActive = kids.some((k) => k.solo);
    return kids
      .filter(
        (k) =>
          !k.muted && (!soloActive || k.solo) && pitch >= k.keyLo && pitch <= k.keyHi,
      )
      .map((k) => k.instrument);
  }

  scheduleNote(pitch: number, velocity: number, when: number, durSec: number, clipId?: string): void {
    for (const i of this.targets(pitch)) i.scheduleNote(pitch, velocity, when, durSec, clipId);
  }
  noteOn(pitch: number, velocity: number): void {
    for (const i of this.targets(pitch)) i.noteOn(pitch, velocity);
  }
  noteOff(pitch: number): void {
    for (const k of this.children()) k.instrument.noteOff(pitch);
  }
  setSustain(on: boolean): void {
    for (const k of this.children()) k.instrument.setSustain(on);
  }
  allNotesOff(): void {
    for (const k of this.children()) k.instrument.allNotesOff();
  }
  dispose(): void {
    for (const k of this.children()) k.instrument.dispose();
  }
}

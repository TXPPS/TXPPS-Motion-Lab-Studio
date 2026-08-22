/**
 * Web MIDI input. Where unsupported, the app reports an honest unsupported
 * state and keeps working. Notes route through each track's channel filter to
 * the armed (or selected) instrument tracks via the engine.
 */
import { midiToName } from '../model/music';
import { isFrozen } from '../model/freeze';
import type { ProjectData, Track } from '../model/types';
import { useProjectStore } from '../state/projectStore';
import { useTransportStore } from '../state/transportStore';
import { useUiStore } from '../state/uiStore';
import { diagLog } from '../state/diagnostics';
import { engine } from './engine';
import { applyControl, offerToLearn } from './controlLink';
import type { ControlSource } from '../model/controlLink';

/**
 * Does this track listen to that MIDI channel?
 *
 * `midiChannel` is a filter, not a route: 0 is omni and takes everything, any
 * other value takes that channel alone. Channels are 1..16 here, as they are
 * on every instrument's front panel — the wire's 0..15 is converted once, at
 * the message.
 */
export function acceptsMidiChannel(track: Track, channel: number): boolean {
  const filter = track.midiChannel ?? 0;
  return filter === 0 || filter === channel;
}

/**
 * The tracks a note arriving on `channel` plays.
 *
 * Every armed track that accepts the channel gets it, not just the first.
 * Layering two instruments under one key is a technique, and a multi-timbral
 * controller sending on two channels is the whole reason the filter exists —
 * choosing one armed track by its position in an array would be a coin toss
 * the player cannot see, and would make two-channel setups silently half-dead.
 *
 * With nothing armed the keyboard still plays, so the selected track answers,
 * and failing that the first instrument in the song. The filter applies there
 * too: a note on channel 3 does not sound on a track listening to channel 1.
 * When nothing matches at all the note is dropped and the transport says so,
 * because a silent keyboard with no explanation is the worst of the three.
 *
 * Frozen tracks are never targets — their instrument is not running.
 */
export function midiTargetTrackIds(
  project: ProjectData,
  selectedTrackId: string | null,
  channel: number,
): string[] {
  const candidates = project.tracks.filter(
    (t) =>
      (t.type === 'instrument' || t.type === 'drum') &&
      !isFrozen(t) &&
      acceptsMidiChannel(t, channel),
  );
  const armed = candidates.filter((t) => t.armed);
  if (armed.length > 0) return armed.map((t) => t.id);
  const selected = candidates.find((t) => t.id === selectedTrackId);
  if (selected) return [selected.id];
  return candidates.length > 0 ? [candidates[0].id] : [];
}

/**
 * The bindable half of a message. Sustain (CC 64) is deliberately included:
 * a pedal is the control most players want on "start/stop" or a macro, and
 * the instrument path still gets it when nothing is bound to it.
 */
function controlSourceOf(status: number, d1: number, chan: number): ControlSource | null {
  if (status === 0xb0) return { kind: 'cc', cc: d1, channel: chan };
  if (status === 0xe0) return { kind: 'pitchbend', channel: chan };
  return null;
}

/** Pitch bend arrives as 14 bits; a binding only ever wants 0..127 of it. */
function controlValueOf(status: number, d1: number, d2: number): number {
  if (status !== 0xe0) return d2;
  return ((d2 << 7) | d1) >> 7;
}

function describeRaw(source: ControlSource): string {
  if (source.kind === 'cc') return `CC ${source.cc} ch ${source.channel}`;
  if (source.kind === 'note') return `Note ${source.note} ch ${source.channel}`;
  return `Pitch bend ch ${source.channel}`;
}

class MidiManager {
  readonly supported =
    typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  private access: MIDIAccess | null = null;
  private selectedId: string | null = null;
  private activity = 0;
  private warnedNotRunning = false;
  private warnedNoTarget = false;

  async enable(): Promise<boolean> {
    const t = useTransportStore.getState();
    if (!this.supported) {
      t.set({ midiSupported: false, midiEnabled: false });
      diagLog('info', 'Web MIDI not supported in this browser');
      return false;
    }
    if (this.access) return true;
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => this.refreshInputs();
      this.refreshInputs();
      t.set({ midiSupported: true, midiEnabled: true });
      diagLog('info', `MIDI enabled (${this.access.inputs.size} input(s))`);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      t.set({ midiSupported: true, midiEnabled: false });
      diagLog('warn', `MIDI access denied/failed: ${msg}`);
      return false;
    }
  }

  private refreshInputs(): void {
    if (!this.access) return;
    const inputs = [...this.access.inputs.values()].map((i) => ({
      id: i.id,
      name: i.name ?? 'MIDI Input',
    }));
    const t = useTransportStore.getState();
    if (this.selectedId && !inputs.some((i) => i.id === this.selectedId)) {
      diagLog('warn', 'Selected MIDI input disconnected');
      this.select(null);
    }
    if (!this.selectedId && inputs.length > 0) this.select(inputs[0].id);
    t.set({ midiInputs: inputs });
  }

  select(id: string | null): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) input.onmidimessage = null;
    this.selectedId = id;
    if (id) {
      const input = this.access.inputs.get(id);
      if (input) {
        input.onmidimessage = (e) => this.handleMessage(e);
        diagLog('info', `MIDI input selected: ${input.name}`);
      }
    }
    useTransportStore.getState().set({ midiSelectedId: id });
  }

  private handleMessage(e: MIDIMessageEvent): void {
    const data = e.data;
    if (!data || data.length < 1) return;
    const status = data[0] & 0xf0;
    const chan = (data[0] & 0x0f) + 1;
    const d1 = data[1] ?? 0;
    const d2 = data[2] ?? 0;
    let desc: string | null = null;
    const targets = midiTargetTrackIds(
      useProjectStore.getState().project,
      useUiStore.getState().selectedTrackId,
      chan,
    );

    // Control Link sees continuous controls first: a bound knob moves what it
    // is bound to rather than reaching the instrument. Notes are never stolen
    // this way — a keyboard has to keep playing while a mapping is learned.
    const source = controlSourceOf(status, d1, chan);
    if (source && offerToLearn(source)) {
      useTransportStore.getState().set({ midiLastEvent: `Learned ${describeRaw(source)}` });
      return;
    }
    if (source && applyControl(source, controlValueOf(status, d1, d2))) {
      this.activity++;
      useTransportStore.getState().set({
        midiActivity: this.activity,
        midiLastEvent: `${describeRaw(source)} → linked`,
      });
      return;
    }

    if (status === 0x90 && d2 > 0) {
      desc = `Note On ${midiToName(d1)} vel ${d2} ch ${chan}`;
      if (targets.length === 0) {
        // The channel filter is invisible until it refuses something, so the
        // one moment it must speak up is the moment a key makes no sound.
        desc += ' — no track listening';
        if (!this.warnedNoTarget) {
          this.warnedNoTarget = true;
          diagLog(
            'warn',
            `MIDI note on channel ${chan} reached no track (check the channel filter)`,
          );
        }
      } else if (!engine.isRunning() && !this.warnedNotRunning) {
        this.warnedNotRunning = true;
        diagLog('warn', 'MIDI note received before audio start — press Start Audio');
      }
      for (const trackId of targets) engine.liveNoteOn(trackId, d1, d2);
    } else if (status === 0x80 || (status === 0x90 && d2 === 0)) {
      desc = `Note Off ${midiToName(d1)} ch ${chan}`;
      for (const trackId of targets) engine.liveNoteOff(trackId, d1);
    } else if (status === 0xb0 && d1 === 64) {
      const on = d2 >= 64;
      desc = `Sustain ${on ? 'down' : 'up'} ch ${chan}`;
      for (const trackId of targets) engine.setSustain(trackId, on);
    } else if (status === 0xb0 && d1 === 123) {
      desc = 'All notes off';
      engine.allNotesOff();
    }

    if (desc) {
      this.activity++;
      useTransportStore.getState().set({ midiActivity: this.activity, midiLastEvent: desc });
    }
  }

  /** Part of global panic: silence everything and reset pedal state. */
  panic(): void {
    engine.allNotesOff();
  }

  reportSupport(): void {
    useTransportStore.getState().set({ midiSupported: this.supported });
  }
}

export const midi = new MidiManager();

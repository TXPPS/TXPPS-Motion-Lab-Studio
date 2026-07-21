/**
 * Web MIDI input. Where unsupported, the app reports an honest unsupported
 * state and keeps working. Notes route to the armed (or selected) instrument
 * track via the engine.
 */
import { midiToName } from '../model/music';
import { useProjectStore } from '../state/projectStore';
import { useTransportStore } from '../state/transportStore';
import { useUiStore } from '../state/uiStore';
import { diagLog } from '../state/diagnostics';
import { engine } from './engine';

function targetTrackId(): string | null {
  const p = useProjectStore.getState().project;
  const sel = useUiStore.getState().selectedTrackId;
  const playable = (t: { type: string }) => t.type === 'instrument' || t.type === 'drum';
  const armed = p.tracks.find((t) => t.armed && playable(t));
  if (armed) return armed.id;
  const selected = p.tracks.find((t) => t.id === sel && playable(t));
  if (selected) return selected.id;
  return p.tracks.find(playable)?.id ?? null;
}

class MidiManager {
  readonly supported =
    typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  private access: MIDIAccess | null = null;
  private selectedId: string | null = null;
  private activity = 0;
  private warnedNotRunning = false;

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
    const trackId = targetTrackId();

    if (status === 0x90 && d2 > 0) {
      desc = `Note On ${midiToName(d1)} vel ${d2} ch ${chan}`;
      if (trackId) {
        if (!engine.isRunning() && !this.warnedNotRunning) {
          this.warnedNotRunning = true;
          diagLog('warn', 'MIDI note received before audio start — press Start Audio');
        }
        engine.liveNoteOn(trackId, d1, d2);
      }
    } else if (status === 0x80 || (status === 0x90 && d2 === 0)) {
      desc = `Note Off ${midiToName(d1)} ch ${chan}`;
      if (trackId) engine.liveNoteOff(trackId, d1);
    } else if (status === 0xb0 && d1 === 64) {
      const on = d2 >= 64;
      desc = `Sustain ${on ? 'down' : 'up'} ch ${chan}`;
      if (trackId) engine.setSustain(trackId, on);
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

/**
 * MIDI recording.
 *
 * Playing a keyboard into the app already worked; keeping what was played did
 * not. This captures live notes while the transport records, and commits them
 * as a clip when it stops.
 *
 * It hangs off `engine.liveNoteOn/liveNoteOff` rather than off the Web MIDI
 * handler, because those are what every input already goes through — hardware
 * MIDI, the on-screen keyboard, and the computer keyboard — so all three are
 * recorded by one hook instead of three that can drift.
 *
 * Timing is taken from the transport's own position, so a note lands where it
 * was played under the tempo map in force at that moment, ramps included.
 */
import { newId } from '../model/ids';
import { quantizeNotes } from '../model/midiTools';
import { tempoMapOf } from '../model/music';
import { beatsPerBarAt } from '../model/tempo';
import type { Note } from '../model/types';
import { diagLog } from '../state/diagnostics';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';

interface OpenNote {
  pitch: number;
  velocity: number;
  startBeat: number;
}

/** A note short enough that it was almost certainly a mistake to keep. */
const MIN_NOTE_BEATS = 1 / 64;

class MidiRecorder {
  private trackId: string | null = null;
  private startBeat = 0;
  private open = new Map<number, OpenNote>();
  private captured: Note[] = [];
  /** Quantise on commit; 0 keeps the performance exactly as played. */
  private grid = 0;

  get isRecording(): boolean {
    return this.trackId !== null;
  }

  get recordingTrackId(): string | null {
    return this.trackId;
  }

  get noteCount(): number {
    return this.captured.length + this.open.size;
  }

  start(trackId: string, startBeat: number, grid = 0): void {
    this.trackId = trackId;
    this.startBeat = Math.max(0, startBeat);
    this.grid = grid;
    this.open.clear();
    this.captured = [];
    diagLog('info', `MIDI recording armed on ${trackId} from beat ${startBeat.toFixed(2)}`);
  }

  noteOn(trackId: string, pitch: number, velocity: number, beat: number): void {
    if (this.trackId !== trackId) return;
    // A retrigger without a note-off (a stuck key, or a controller that only
    // sends note-ons) closes the previous note rather than losing it.
    if (this.open.has(pitch)) this.noteOff(trackId, pitch, beat);
    this.open.set(pitch, { pitch, velocity, startBeat: beat });
  }

  noteOff(trackId: string, pitch: number, beat: number): void {
    if (this.trackId !== trackId) return;
    const held = this.open.get(pitch);
    if (!held) return;
    this.open.delete(pitch);
    const length = Math.max(MIN_NOTE_BEATS, beat - held.startBeat);
    this.captured.push({
      id: newId('n'),
      start: Math.max(0, held.startBeat - this.startBeat),
      length,
      pitch: held.pitch,
      velocity: Math.min(127, Math.max(1, Math.round(held.velocity))),
    });
  }

  /** Discard everything without writing a clip. */
  cancel(): void {
    this.trackId = null;
    this.open.clear();
    this.captured = [];
  }

  /**
   * Commit what was played.
   *
   * Notes still held at the stop are closed there rather than dropped — a
   * musician who was holding a chord when they hit stop played that chord.
   * Returns the new clip id, or null when nothing was played.
   */
  stop(endBeat: number): string | null {
    const trackId = this.trackId;
    if (!trackId) return null;
    for (const pitch of [...this.open.keys()]) this.noteOff(trackId, pitch, endBeat);
    const notes = this.captured;
    this.trackId = null;
    this.captured = [];
    if (notes.length === 0) return null;

    const project = useProjectStore.getState().project;
    const map = tempoMapOf(project);
    const bar = beatsPerBarAt(map, this.startBeat);
    const played = Math.max(...notes.map((n) => n.start + n.length));
    // Round the clip out to a whole bar: a take that ends mid-bar is a clip
    // whose edge is in a musically meaningless place.
    const length = Math.max(bar, Math.ceil(played / bar) * bar);
    const final =
      this.grid > 0
        ? quantizeNotes(notes, { grid: this.grid, strength: 1, swing: 0, lengths: false })
        : notes;

    const clipId = useProjectStore.getState().addMidiClip(trackId, this.startBeat, length);
    useProjectStore.getState().addNotes(
      clipId,
      final.map(({ id: _id, ...rest }) => rest),
    );
    useUiStore.getState().selectClip(clipId, trackId);
    diagLog('info', `MIDI recording kept ${final.length} notes on ${trackId}`);
    return clipId;
  }
}

export const midiRecorder = new MidiRecorder();

/**
 * Standard MIDI File import and export.
 *
 * The pure model layer decides what a file means (`model/midiImport.ts`,
 * `model/midiExport.ts`); this is the thin layer that reads bytes, mints real
 * ids, commits one undoable step, and hands a download to the browser. Keeping
 * the decision-making pure is what makes the round trip testable.
 */
import { buildMidiFile, parseMidiFile } from '../model/midiFile';
import { buildImportPlan, type MidiImportOptions } from '../model/midiImport';
import { buildMidiExport, type MidiExportOptions } from '../model/midiExport';
import { newId } from '../model/ids';
import { getPreset } from '../model/presets';
import { TRACK_COLORS, type Clip, type Track } from '../model/types';
import { diagLog } from '../state/diagnostics';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';

export function isMidiFile(file: File): boolean {
  return /\.midi?$/i.test(file.name) || file.type === 'audio/midi' || file.type === 'audio/x-midi';
}

/**
 * Import a .mid into the current project as new tracks and clips.
 *
 * Everything lands in ONE undoable step: a musician who drags in the wrong file
 * presses Ctrl+Z once, not once per track.
 */
export async function importMidiFile(file: File, opts: MidiImportOptions = {}): Promise<boolean> {
  let plan;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    plan = buildImportPlan(parseMidiFile(bytes), opts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    useUiStore.getState().toast('error', `Could not read ${file.name}: ${msg}`);
    diagLog('error', `MIDI import failed: ${msg}`);
    return false;
  }

  if (plan.noteCount === 0) {
    useUiStore.getState().toast('error', `${file.name} contains no notes.`);
    return false;
  }

  const firstTrackId = newId('trk');
  useProjectStore.getState().update((d) => {
    const baseColor = d.tracks.length;
    plan.tracks.forEach((tp, i) => {
      const trackId = i === 0 ? firstTrackId : newId('trk');
      const track: Track = {
        id: trackId,
        type: tp.type,
        name: tp.name,
        color: TRACK_COLORS[(baseColor + i) % TRACK_COLORS.length],
        volume: 1,
        pan: 0,
        mute: false,
        solo: false,
        armed: false,
        collapsed: false,
        output: 'master',
        synth: getPreset(tp.type === 'drum' ? 'TX Drum Kit' : 'Warm Keys'),
        ...(tp.channel === 9 ? { midiChannel: 10 } : {}),
      };
      d.tracks.push(track);
      for (const cp of tp.clips) {
        const clip: Clip = {
          id: newId('clip'),
          trackId,
          type: 'midi',
          name: cp.name,
          start: cp.start,
          length: cp.length,
          muted: false,
          notes: cp.notes.map((n) => ({ ...n, id: newId('n') })),
        };
        d.clips.push(clip);
      }
    });
    if (plan.tempoMap && opts.importTempo !== false) {
      d.tempoMap = plan.tempoMap;
      d.bpm = plan.bpm;
      d.timeSig = plan.timeSig;
    }
  });

  useUiStore.getState().selectTrack(firstTrackId);
  for (const w of plan.warnings) diagLog('warn', `MIDI import: ${w}`);
  useUiStore
    .getState()
    .toast(
      'info',
      `Imported ${plan.noteCount} notes across ${plan.tracks.length} track${
        plan.tracks.length === 1 ? '' : 's'
      }${plan.warnings.length ? ` (${plan.warnings.length} warning${plan.warnings.length === 1 ? '' : 's'})` : ''}`,
    );
  diagLog(
    'info',
    `MIDI import: ${file.name} → ${plan.tracks.length} tracks, ${plan.noteCount} notes`,
  );
  return true;
}

function download(bytes: Uint8Array, name: string): void {
  const blob = new Blob([bytes], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Write the project (or a selection) out as one or more .mid files. */
export function exportMidiFile(opts: MidiExportOptions = {}): boolean {
  const project = useProjectStore.getState().project;
  const plan = buildMidiExport(project, opts);
  if (plan.noteCount === 0) {
    useUiStore.getState().toast('error', 'Nothing to export: no MIDI notes in range.');
    return false;
  }
  for (const f of plan.files) {
    download(buildMidiFile(f.tracks, f.options), `${f.name}.mid`);
  }
  for (const w of plan.warnings) diagLog('warn', `MIDI export: ${w}`);
  useUiStore
    .getState()
    .toast(
      'info',
      `Exported ${plan.noteCount} notes as ${plan.files.length} MIDI file${
        plan.files.length === 1 ? '' : 's'
      }`,
    );
  return true;
}

/** Open a file picker for .mid files. Used by the browser panel and the menu. */
export function pickMidiFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.mid,.midi,audio/midi';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void importMidiFile(file);
  };
  input.click();
}

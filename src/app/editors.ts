/**
 * Editor registry.
 *
 * Adding an editor used to mean editing six files: the EditorTab union, the tab
 * list, the phone navigation, the tablet layout, the maximizable-pane union and
 * the scroll-restore selector list. That is why the whole sampler workstation
 * ended up hidden inside the "Synth" tab. One array now describes every editor
 * surface, and everything that needs to know about editors reads it.
 *
 * Components are lazy: the score engraver and the drum grid are not needed to
 * start a session and should not be in the boot bundle.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { IconName } from '../components/common/Icon';
import type { EditorId } from './editorIds';
import type { ProjectData } from '../model/types';

export type { EditorId } from './editorIds';

export interface EditorDef {
  id: EditorId;
  label: string;
  icon: IconName;
  /** One line for the tab's tooltip. */
  hint: string;
  component: LazyExoticComponent<ComponentType>;
  /**
   * Whether this editor has anything to show for the current selection. A tab
   * that cannot do anything is still shown — hiding it would make the product
   * feel like it changes shape — but it is dimmed and says why.
   */
  appliesTo?: (
    project: ProjectData,
    selection: { trackId: string | null; clipId: string | null },
  ) => boolean;
  /** Why it is unavailable, shown on the dimmed tab. */
  unavailable?: string;
}

const Mixer = lazy(() => import('../components/mixer/Mixer').then((m) => ({ default: m.Mixer })));
const ChannelEditor = lazy(() =>
  import('../components/channel/ChannelView').then((m) => ({ default: m.ChannelEditor })),
);
const PianoRoll = lazy(() =>
  import('../components/pianoroll/PianoRoll').then((m) => ({ default: m.PianoRoll })),
);
const DrumEditor = lazy(() =>
  import('../components/drumeditor/DrumEditor').then((m) => ({ default: m.DrumEditor })),
);
const ScoreView = lazy(() =>
  import('../components/score/ScoreView').then((m) => ({ default: m.ScoreView })),
);
const AudioEditor = lazy(() =>
  import('../components/audioeditor/AudioEditor').then((m) => ({ default: m.AudioEditor })),
);
const ChordAssistant = lazy(() =>
  import('../components/chords/ChordAssistant').then((m) => ({ default: m.ChordAssistant })),
);
const SynthPanel = lazy(() =>
  import('../components/synth/SynthPanel').then((m) => ({ default: m.SynthPanel })),
);
const DiagnosticsPanel = lazy(() =>
  import('../components/diagnostics/DiagnosticsPanel').then((m) => ({
    default: m.DiagnosticsPanel,
  })),
);

const isMidiClipOpen = (project: ProjectData, sel: { clipId: string | null }) =>
  project.clips.some((c) => c.id === sel.clipId && c.type === 'midi');

export const EDITORS: EditorDef[] = [
  {
    id: 'mixer',
    label: 'Mixer',
    icon: 'mixer',
    hint: 'The console: channels, inserts, sends and metering',
    component: Mixer,
  },
  {
    id: 'piano',
    label: 'Piano Roll',
    icon: 'piano',
    hint: 'Note editing for the open MIDI clip',
    component: PianoRoll,
    appliesTo: isMidiClipOpen,
    unavailable: 'Open a MIDI clip',
  },
  {
    id: 'drums',
    label: 'Drums',
    icon: 'drum',
    hint: 'A lane per drum, a step per hit',
    component: DrumEditor,
    appliesTo: isMidiClipOpen,
    unavailable: 'Open a MIDI clip',
  },
  {
    id: 'score',
    label: 'Score',
    icon: 'score',
    hint: 'Engraved notation for the open MIDI clip',
    component: ScoreView,
    appliesTo: isMidiClipOpen,
    unavailable: 'Open a MIDI clip',
  },
  {
    id: 'audio',
    label: 'Audio',
    icon: 'wave',
    hint: 'Waveform editing, audio to notes, vocal tune and stems',
    component: AudioEditor,
    appliesTo: (project, sel) =>
      project.clips.some((c) => c.id === sel.clipId && c.type === 'audio'),
    unavailable: 'Select an audio clip',
  },
  {
    id: 'chords',
    label: 'Chords',
    icon: 'chord',
    hint: 'Detect chords, get suggestions, follow the chord track',
    component: ChordAssistant,
  },
  {
    id: 'synth',
    label: 'Instrument',
    icon: 'synth',
    hint: 'The selected track’s instrument',
    component: SynthPanel,
  },
  /*
   * After the instrument, and after every note editor — which is a position
   * with a reason rather than a preference.
   *
   * `EditorBody` falls back to the *first* offered editor when the selected one
   * is excluded, and a phone excludes Mixer because its bottom navigation
   * already offers it. Placed second, this became the phone's fallback and the
   * Edit tab stopped landing on a note editor: measured by
   * `layout.spec.ts`'s "exactly one primary workspace is mounted at a time",
   * which counts a phone workspace and found none.
   *
   * It also reads correctly here: piano, drums, score, audio and chords are
   * editors of the *material*; Instrument and Channel are editors of what the
   * material plays through, in that order down the signal.
   */
  {
    id: 'channel',
    label: 'Channel',
    icon: 'layers',
    hint: 'One channel end to end: in, MIDI FX, instrument, inserts, sends and output',
    component: ChannelEditor,
  },
  {
    id: 'diagnostics',
    label: 'Diagnostics',
    icon: 'wrench',
    hint: 'Engine, storage and browser state',
    component: DiagnosticsPanel,
  },
];

export function editorById(id: string): EditorDef | undefined {
  return EDITORS.find((e) => e.id === id);
}

/** Register an editor that ships as its own module (drum grid, score view). */
export function registerEditor(def: EditorDef, after?: EditorId): void {
  if (EDITORS.some((e) => e.id === def.id)) return;
  const at = after ? EDITORS.findIndex((e) => e.id === after) : -1;
  if (at >= 0) EDITORS.splice(at + 1, 0, def);
  else EDITORS.push(def);
}

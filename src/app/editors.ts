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
import type { ProjectData } from '../model/types';

export type EditorId = 'mixer' | 'piano' | 'drums' | 'score' | 'chords' | 'synth' | 'diagnostics';

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
const PianoRoll = lazy(() =>
  import('../components/pianoroll/PianoRoll').then((m) => ({ default: m.PianoRoll })),
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

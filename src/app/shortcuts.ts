/**
 * Keyboard shortcut registry.
 *
 * One declarative table drives the help sheet and the shortcut hints shown in
 * context menus, and a unit test asserts no two entries claim the same
 * combination — the registry is where a conflict becomes visible before a user
 * finds it. The handlers themselves live in `hooks/useKeyboard.ts`; this table
 * is the documentation of record for what they bind.
 *
 * `combo` is a normalised string for conflict checking: modifiers sorted
 * (ctrl+shift+X), `mod` meaning Ctrl/Cmd. `display` is what a musician reads.
 */

export interface Shortcut {
  id: string;
  combo: string;
  display: string;
  description: string;
  category: 'Transport' | 'Editing' | 'Selection' | 'View' | 'Project' | 'Piano roll';
  /** Context in which the combo applies, when not global. */
  when?: string;
}

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
const MOD = IS_MAC ? '⌘' : 'Ctrl';

export const SHORTCUTS: Shortcut[] = [
  // Transport
  { id: 'play', combo: 'space', display: 'Space', description: 'Play / stop', category: 'Transport' },
  { id: 'return', combo: 'enter', display: 'Enter', description: 'Return to start', category: 'Transport' },
  { id: 'record', combo: 'r', display: 'R', description: 'Start / stop recording', category: 'Transport' },
  {
    id: 'escape',
    combo: 'escape',
    display: 'Esc',
    description: 'Cancel recording · pointer tool · clear selection · stop all audio',
    category: 'Transport',
  },

  // Project
  { id: 'save', combo: 'mod+s', display: `${MOD}+S`, description: 'Save project', category: 'Project' },
  { id: 'undo', combo: 'mod+z', display: `${MOD}+Z`, description: 'Undo', category: 'Project' },
  {
    id: 'redo',
    combo: 'mod+shift+z',
    display: `${MOD}+Shift+Z`,
    description: 'Redo',
    category: 'Project',
  },

  // Selection
  {
    id: 'select-all',
    combo: 'mod+a',
    display: `${MOD}+A`,
    description: 'Select all clips',
    category: 'Selection',
  },
  {
    id: 'add-to-selection',
    combo: 'shift+click',
    display: 'Shift+Click',
    description: 'Add or remove a clip from the selection',
    category: 'Selection',
    when: 'on a clip',
  },
  {
    id: 'marquee',
    combo: 'drag',
    display: 'Drag empty lane',
    description: 'Marquee-select clips (mouse)',
    category: 'Selection',
    when: 'arrangement',
  },

  // Editing
  { id: 'copy', combo: 'mod+c', display: `${MOD}+C`, description: 'Copy selected clips', category: 'Editing' },
  { id: 'cut', combo: 'mod+x', display: `${MOD}+X`, description: 'Cut selected clips', category: 'Editing' },
  {
    id: 'paste',
    combo: 'mod+v',
    display: `${MOD}+V`,
    description: 'Paste at the playhead',
    category: 'Editing',
  },
  {
    id: 'duplicate',
    combo: 'mod+d',
    display: `${MOD}+D`,
    description: 'Duplicate selection after itself',
    category: 'Editing',
  },
  {
    id: 'delete',
    combo: 'delete',
    display: 'Delete',
    description: 'Delete selected clips (or notes in the piano roll)',
    category: 'Editing',
  },
  {
    id: 'split',
    combo: 'mod+e',
    display: `${MOD}+E`,
    description: 'Split selected clip at the playhead',
    category: 'Editing',
  },
  {
    id: 'snap-bypass',
    combo: 'shift+drag',
    display: 'Shift while dragging',
    description: 'Temporarily ignore snapping',
    category: 'Editing',
    when: 'while dragging a clip',
  },
  {
    id: 'alt-duplicate',
    combo: 'alt+drag',
    display: 'Alt+Drag',
    description: 'Drag a copy instead of the clip',
    category: 'Editing',
    when: 'on a clip',
  },

  // Piano roll
  {
    id: 'pr-nudge',
    combo: 'arrowleft/right',
    display: '← →',
    description: 'Nudge selected notes by the snap (Shift: fine)',
    category: 'Piano roll',
    when: 'notes selected',
  },
  {
    id: 'pr-transpose',
    combo: 'arrowup/down',
    display: '↑ ↓',
    description: 'Transpose ±1 semitone (Shift: ±octave; scale lock steps in scale)',
    category: 'Piano roll',
    when: 'notes selected',
  },
  {
    id: 'pr-mute',
    combo: 'm',
    display: 'M',
    description: 'Mute / unmute selected notes',
    category: 'Piano roll',
    when: 'notes selected',
  },
  {
    id: 'pr-alt-mute',
    combo: 'alt+click',
    display: 'Alt+Click',
    description: 'Toggle mute on one note',
    category: 'Piano roll',
    when: 'on a note',
  },
  {
    id: 'pr-select-all',
    combo: 'mod+a (piano roll)',
    display: `${MOD}+A`,
    description: 'Select all notes in the open clip',
    category: 'Piano roll',
  },
  {
    id: 'pr-duplicate',
    combo: 'mod+d (piano roll)',
    display: `${MOD}+D`,
    description: 'Duplicate selected notes after themselves',
    category: 'Piano roll',
  },

  // View
  {
    id: 'tools',
    combo: '1-4',
    display: '1–4',
    description: 'Pointer · Split · Erase · Mute tool',
    category: 'View',
  },
  { id: 'octave-down', combo: 'z', display: 'Z', description: 'Keyboard octave down', category: 'View' },
  { id: 'octave-up', combo: 'x', display: 'X', description: 'Keyboard octave up', category: 'View' },
  {
    id: 'help',
    combo: 'shift+/',
    display: '?',
    description: 'Show this shortcut list',
    category: 'View',
  },
];

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

/** Display string for a shortcut id — used by menus. Empty when unknown. */
export function shortcutLabel(id: string): string {
  return BY_ID.get(id)?.display ?? '';
}

/**
 * Combos claimed more than once. `click`/`drag` pseudo-combos are contextual
 * and excluded. Kept as a function so the conflict test reads the same data
 * the help sheet renders.
 */
export function findShortcutConflicts(): string[] {
  const seen = new Map<string, string>();
  const conflicts: string[] = [];
  for (const s of SHORTCUTS) {
    if (/click|drag/.test(s.combo)) continue;
    const prev = seen.get(s.combo);
    if (prev) conflicts.push(`${s.combo}: ${prev} vs ${s.id}`);
    else seen.set(s.combo, s.id);
  }
  return conflicts;
}

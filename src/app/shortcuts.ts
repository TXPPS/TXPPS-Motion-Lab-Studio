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
  category:
    'Transport' | 'Editing' | 'Selection' | 'View' | 'Project' | 'Piano roll' | 'Automation';
  /** Context in which the combo applies, when not global. */
  when?: string;
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
const MOD = IS_MAC ? '⌘' : 'Ctrl';

export const SHORTCUTS: Shortcut[] = [
  // Transport
  {
    id: 'play',
    combo: 'space',
    display: 'Space',
    description: 'Play / stop',
    category: 'Transport',
  },
  {
    id: 'return',
    combo: 'enter',
    display: 'Enter',
    description: 'Return to start',
    category: 'Transport',
  },
  {
    id: 'return-home',
    combo: 'home',
    display: 'Home',
    description: 'Return to start',
    category: 'Transport',
  },
  {
    id: 'record',
    combo: 'r',
    display: 'R',
    description: 'Start / stop recording',
    category: 'Transport',
  },
  {
    id: 'escape',
    combo: 'escape',
    display: 'Esc',
    description: 'Cancel recording · pointer tool · clear selection · stop all audio',
    category: 'Transport',
  },

  // Project
  {
    id: 'save',
    combo: 'mod+s',
    display: `${MOD}+S`,
    description: 'Save project',
    category: 'Project',
  },
  {
    id: 'export',
    combo: 'mod+shift+e',
    display: `${MOD}+Shift+E`,
    description: 'Export…',
    category: 'Project',
  },
  {
    id: 'preferences',
    combo: 'mod+,',
    display: `${MOD}+,`,
    description: 'Preferences',
    category: 'Project',
  },
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
  {
    id: 'context-menu',
    combo: 'contextmenu',
    display: 'Menu / Shift+F10',
    description: 'Open the menu for the focused object',
    category: 'Selection',
  },

  // Editing
  {
    id: 'copy',
    combo: 'mod+c',
    display: `${MOD}+C`,
    description: 'Copy selected clips',
    category: 'Editing',
  },
  {
    id: 'cut',
    combo: 'mod+x',
    display: `${MOD}+X`,
    description: 'Cut selected clips',
    category: 'Editing',
  },
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
    combo: '1-9',
    display: '1–9',
    description:
      'Tools, in toolbar order: Pointer · Range · Split · Erase · Mute · Slip · Paint · Listen · Zoom',
    category: 'View',
  },
  {
    id: 'octave-down',
    combo: 'z',
    display: 'Z',
    description: 'Keyboard octave down',
    category: 'View',
  },
  {
    id: 'octave-up',
    combo: 'x',
    display: 'X',
    description: 'Keyboard octave up',
    category: 'View',
  },
  // Panels. The reference's F2-F10 map, matched because a professional user's
  // hands already know it. F11 is deliberately absent: it is the browser's own
  // fullscreen, and taking it would break the key a web user relies on to get
  // back out of a full-screen page.
  {
    id: 'panel-editor',
    combo: 'f2',
    display: 'F2',
    description: 'Show or hide the editor',
    category: 'View',
  },
  {
    id: 'panel-mixer',
    combo: 'f3',
    display: 'F3',
    description: 'Open the mixer',
    category: 'View',
  },
  {
    id: 'panel-inspector',
    combo: 'f4',
    display: 'F4',
    description: 'Show or hide the inspector',
    category: 'View',
  },
  {
    id: 'panel-browser',
    combo: 'f5',
    display: 'F5',
    description: 'Show or hide the browser — Ctrl/Cmd+R still reloads',
    category: 'View',
  },
  {
    id: 'panel-instruments',
    combo: 'f6',
    display: 'F6',
    description: 'Browser: instruments',
    category: 'View',
  },
  {
    id: 'panel-effects',
    combo: 'f7',
    display: 'F7',
    description: 'Browser: effects',
    category: 'View',
  },
  {
    id: 'panel-loops',
    combo: 'f8',
    display: 'F8',
    description: 'Browser: loops',
    category: 'View',
  },
  {
    id: 'panel-samples',
    combo: 'f9',
    display: 'F9',
    description: 'Browser: samples',
    category: 'View',
  },
  {
    id: 'panel-pool',
    combo: 'f10',
    display: 'F10',
    description: 'Browser: everything this project uses',
    category: 'View',
  },
  {
    id: 'maximize-arrange',
    combo: 'shift+f',
    display: 'Shift F',
    description: 'Full-screen the arrangement, and back again',
    category: 'View',
  },
  {
    id: 'pages',
    combo: 'mod+1-4',
    display: `${MOD} 1–4`,
    description: 'Start · Song · Release · Live',
    category: 'View',
  },
  {
    id: 'help',
    combo: 'shift+/',
    display: '?',
    description: 'Show this shortcut list',
    category: 'View',
  },

  // Audio editing (Milestone 6)
  {
    id: 'tool-slip',
    combo: '6',
    display: '6',
    description: 'Slip tool: drag audio inside a fixed clip window',
    category: 'Editing',
  },
  {
    id: 'tool-paint',
    combo: '7',
    display: '7',
    description: 'Paint tool: drag an empty instrument or drum lane to draw a MIDI clip',
    category: 'Editing',
  },
  {
    id: 'tool-listen',
    combo: '8',
    display: '8',
    description: 'Listen tool: hold a clip to hear it from the point pressed',
    category: 'Editing',
  },
  {
    id: 'tool-zoom',
    combo: '9',
    display: '9',
    description: 'Zoom tool: drag across to zoom, down for taller tracks, click to step in',
    category: 'View',
  },
  {
    id: 'clip-nudge',
    combo: 'arrowleft/right (clips)',
    display: '←/→',
    description: 'Nudge the selected clips by the grid (Shift = fine)',
    category: 'Editing',
    when: 'clips selected',
  },
  {
    id: 'crossfade',
    combo: 'menu (two audio clips)',
    display: 'Right-click',
    description: 'Crossfade two adjacent audio clips (equal power / linear)',
    category: 'Editing',
    when: 'two clips selected',
  },
  {
    id: 'take-swipe',
    combo: 'drag (take lane)',
    display: 'Swipe lane',
    description: 'Comp that range from the take; click auditions it',
    category: 'Editing',
    when: 'take lanes open',
  },

  // Automation
  {
    id: 'auto-add-point',
    combo: 'dblclick (automation lane)',
    display: 'Double-click',
    description: 'Add a point (Alt bypasses snap)',
    category: 'Automation',
    when: 'automation lane',
  },
  {
    id: 'auto-delete-point',
    combo: 'dblclick (automation point)',
    display: 'Double-click point',
    description: 'Delete that point',
    category: 'Automation',
    when: 'automation lane',
  },
  {
    id: 'auto-marquee',
    combo: 'drag (automation lane)',
    display: 'Drag empty space',
    description: 'Marquee-select points (Shift adds)',
    category: 'Automation',
    when: 'automation lane',
  },
  {
    id: 'auto-drag',
    combo: 'drag (automation point)',
    display: 'Drag point',
    description: 'Move points · Shift = fine values · Alt = no snap',
    category: 'Automation',
    when: 'points selected',
  },
  {
    id: 'auto-delete',
    combo: 'delete (automation)',
    display: 'Del',
    description: 'Delete the selected points',
    category: 'Automation',
    when: 'points selected',
  },
  {
    id: 'auto-copy',
    combo: 'mod+c (automation)',
    display: `${MOD}+C`,
    description: 'Copy the selected points',
    category: 'Automation',
    when: 'points selected',
  },
  {
    id: 'auto-paste',
    combo: 'mod+v (automation)',
    display: `${MOD}+V`,
    description: 'Paste points into the active lane at the playhead',
    category: 'Automation',
    when: 'lane active',
  },
  {
    id: 'auto-duplicate',
    combo: 'mod+d (automation)',
    display: `${MOD}+D`,
    description: 'Duplicate the selected points after themselves',
    category: 'Automation',
    when: 'points selected',
  },

  // Keyboard editing of the three musical surfaces. Every entry here is
  // handled by the focused object itself, which is why each combo carries the
  // object it belongs to: the same arrow key means four things depending on
  // what has focus, and the registry has to say which is which.
  {
    id: 'clip-select',
    combo: 'enter (clip)',
    display: 'Enter',
    description: 'Select the focused clip (Shift: add it to the selection)',
    category: 'Selection',
    when: 'a clip is focused',
  },
  {
    id: 'clip-trim-start',
    combo: '[/] (clip)',
    display: '[ ]',
    description: 'Trim the focused clip’s start edge by the grid',
    category: 'Editing',
    when: 'a clip is focused',
  },
  {
    id: 'clip-trim-end',
    combo: 'shift+[/] (clip)',
    display: 'Shift+[ ]',
    description: 'Trim the focused clip’s end edge by the grid',
    category: 'Editing',
    when: 'a clip is focused',
  },
  {
    id: 'clip-fade-in',
    combo: ',/. (clip)',
    display: ', .',
    description: 'Shorten / lengthen the fade in of the focused audio clip',
    category: 'Editing',
    when: 'a clip is focused',
  },
  {
    id: 'clip-fade-out',
    combo: 'shift+,/. (clip)',
    display: 'Shift+, .',
    description: 'Shorten / lengthen the fade out of the focused audio clip',
    category: 'Editing',
    when: 'a clip is focused',
  },
  {
    id: 'pr-note-select',
    combo: 'enter (note)',
    display: 'Enter',
    description: 'Select the focused note (Shift: add it to the selection)',
    category: 'Piano roll',
    when: 'a note is focused',
  },
  {
    id: 'pr-note-resize',
    combo: 'alt+arrowleft/right (note)',
    display: 'Alt+← →',
    description: 'Shorten / lengthen the focused note by the snap',
    category: 'Piano roll',
    when: 'a note is focused',
  },
  {
    id: 'pr-grid-cursor',
    combo: 'arrows (note grid)',
    display: '← → ↑ ↓',
    description: 'Move the note cursor by the snap and by a semitone',
    category: 'Piano roll',
    when: 'the grid is focused',
  },
  {
    id: 'pr-grid-add',
    combo: 'enter (note grid)',
    display: 'Enter',
    description: 'Add a note at the cursor, or remove the one already there',
    category: 'Piano roll',
    when: 'the grid is focused',
  },
  {
    id: 'pr-velocity',
    combo: 'arrowup/down (velocity lane)',
    display: '↑ ↓',
    description: 'Set the velocity of the focused note (Shift: ±10)',
    category: 'Piano roll',
    when: 'a velocity bar is focused',
  },
  {
    id: 'auto-point-keys',
    combo: 'arrows (automation point)',
    display: '↑ ↓ ← →',
    description: 'Change the value (Shift: fine) · move by the snap',
    category: 'Automation',
    when: 'a point is focused',
  },
  {
    id: 'auto-point-select',
    combo: 'enter (automation point)',
    display: 'Enter',
    description: 'Add or remove the focused point from the selection',
    category: 'Automation',
    when: 'a point is focused',
  },
  {
    id: 'auto-add-at-playhead',
    combo: 'enter (automation lane)',
    display: 'Enter',
    description: 'Add a point at the playhead',
    category: 'Automation',
    when: 'the lane is focused',
  },
];

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

/** Display string for a shortcut id — used by menus. Empty when unknown. */
/**
 * The combo string for a keyboard event, in the registry's own format.
 *
 * Modifiers are sorted so `Ctrl+Shift+E` and `Shift+Ctrl+E` are one string, and
 * Cmd is folded into `mod` so a Mac binding and a Windows binding are the same
 * entry rather than two that can disagree.
 */
export function comboOf(e: {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  const key = e.code === 'Space' || e.key === ' ' ? 'space' : e.key.toLowerCase();
  // A bare modifier is not a shortcut; the caller filters those out.
  if (['control', 'meta', 'shift', 'alt'].includes(key)) return '';
  parts.push(key);
  return parts.join('+');
}

/** How a combo string reads to a musician: `mod+shift+e` → `Ctrl+Shift+E`. */
export function comboLabel(combo: string): string {
  return combo
    .split('+')
    .map((part) =>
      part === 'mod'
        ? MOD
        : part === 'alt'
          ? IS_MAC
            ? '⌥'
            : 'Alt'
          : part === 'shift'
            ? 'Shift'
            : part === 'space'
              ? 'Space'
              : part.length === 1
                ? part.toUpperCase()
                : part[0].toUpperCase() + part.slice(1),
    )
    .join(IS_MAC ? '' : '+');
}

export function shortcutById(id: string): Shortcut | undefined {
  return SHORTCUTS.find((s) => s.id === id);
}

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

/**
 * Capability parity for the piano roll: every keyboard command has a control.
 *
 * The rule §6 is written to is "capability parity, affordance divergence" —
 * a desktop keeps hover, thin edges and modifier keys, and a phone gets to do
 * everything a desktop can. Divergence in *how* is the point; divergence in
 * *what* is a feature that exists on one form factor, and this repository has
 * shipped four of those.
 *
 * The half that goes wrong is always the same: somebody adds a keyboard
 * shortcut, which is the cheap way to add a command, and the phone never gets
 * it. `geometry.ts` already carried a sentence of that shape — a note too
 * narrow for a resize grip "is moved by dragging and resized from the toolbar
 * or the keyboard" — while the toolbar's only length commands were ×2 and ÷2.
 * A sixteenth that wants to be a dotted sixteenth is not reachable by doubling
 * or halving anything, so on a phone that capability was simply absent, for
 * exactly the notes whose grip had been taken away to make room for it.
 *
 * So: every `case` arm and every modifier branch in the roll's key handlers is
 * enumerated from the source, and each must name the on-screen control that
 * makes the same edit — or say why it needs none. A command added without
 * either fails here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('src/components/pianoroll/PianoRoll.tsx', 'utf8');

/**
 * What each keyboard command is, and where its control is.
 *
 * `control` is a `data-testid` that must be present in the same file. `why` is
 * for the commands whose on-screen equivalent is the surface itself — moving a
 * cell cursor is what a finger does by touching the cell it wants, and a button
 * for "move the cursor right" would be a control for the absence of a pointer.
 */
const COMMANDS: Record<string, { control?: string; why?: string }> = {
  // ---- a selected note owns these -----------------------------------------
  Delete: { control: 'pr-note' /* its own menu carries "Delete note" */ },
  Backspace: { control: 'pr-note' },
  ArrowLeft: { control: 'pr-nudge-earlier' },
  ArrowRight: { control: 'pr-nudge-later' },
  ArrowUp: { control: 'pr-nudge-up' },
  ArrowDown: { control: 'pr-nudge-down' },
  // ---- the grid cursor ----------------------------------------------------
  Home: { why: 'moves the cell cursor; a finger goes to the start by touching it' },
  End: { why: 'moves the cell cursor; a finger goes to the end by touching it' },
  Enter: { control: 'pr-grid' /* tapping a cell is the same toggle */ },
  ' ': { control: 'pr-grid' },
  // ---- the key column -----------------------------------------------------
  PageUp: { control: 'pr-key', why: 'moves the key cursor an octave; a finger touches the key' },
  PageDown: { control: 'pr-key' },
};

/** Modifier branches, which are the affordance the desktop is allowed to keep. */
const MODIFIERS: Record<string, { control: string; note: string }> = {
  altKey: {
    control: 'pr-len-longer',
    note: 'Alt+←/→ resizes by one snap step; the length pad is the same edit',
  },
  shiftKey: {
    control: 'pr-nudge-up',
    note: 'Shift multiplies the step (an octave, a quarter of a snap). The unmodified control makes the same edit at the base step, which is capability parity — a finger reaching an octave by twelve presses has the capability, slower; and `pr-tools` carries Transpose ±12 outright',
  },
  ctrlKey: {
    control: 'pr-marquee',
    note: 'adds to the selection rather than replacing it. A finger has no modifier, so the marquee is the route: drag across the notes wanted and the selection is the set',
  },
  metaKey: {
    control: 'pr-marquee',
    note: 'the same as ctrlKey, on a Mac',
  },
};

/** Every `case '<key>':` arm inside the file's keyboard handlers. */
function keyCases(): string[] {
  const out = new Set<string>();
  for (const m of SRC.matchAll(/case '([^']*)':/g)) out.add(m[1]);
  return [...out];
}

/** Every modifier the handlers branch on. */
function modifiers(): string[] {
  const out = new Set<string>();
  for (const m of SRC.matchAll(/e\.(altKey|shiftKey|metaKey|ctrlKey)\b/g)) out.add(m[1]);
  return [...out];
}

const hasControl = (id: string) => SRC.includes(`data-testid="${id}"`);

describe('piano roll — capability parity', () => {
  it('every keyboard command is registered', () => {
    const unregistered = keyCases().filter((k) => !(k in COMMANDS));
    expect(
      unregistered,
      'keyboard commands with no on-screen control and no reason recorded',
    ).toEqual([]);
  });

  it('every registered control exists in the markup', () => {
    const dangling = Object.entries(COMMANDS)
      .filter(([, spec]) => spec.control && !hasControl(spec.control))
      .map(([key, spec]) => `${key} -> ${spec.control}`);
    expect(dangling, 'a command names a control that is not drawn').toEqual([]);
  });

  it('every command either names a control or says why it needs none', () => {
    const silent = Object.entries(COMMANDS)
      .filter(([, spec]) => !spec.control && !spec.why)
      .map(([key]) => key);
    expect(silent).toEqual([]);
  });

  it('every modifier branch is registered, with the control that matches it', () => {
    const unregistered = modifiers().filter((m) => !(m in MODIFIERS));
    expect(unregistered, 'a modifier changes what a key does and nothing on screen does').toEqual(
      [],
    );
    const dangling = Object.entries(MODIFIERS)
      .filter(([, spec]) => !hasControl(spec.control))
      .map(([mod, spec]) => `${mod} -> ${spec.control}`);
    expect(dangling).toEqual([]);
  });

  it('the registry has not outlived the handlers', () => {
    // Non-vacuity, in the direction that rots quietly: a command removed from
    // the roll leaves an entry here claiming a parity nobody needs, and the
    // next reader takes the list as the inventory.
    const cases = new Set(keyCases());
    const stale = Object.keys(COMMANDS).filter((k) => !cases.has(k));
    expect(stale, 'registered commands the handlers no longer have').toEqual([]);
  });

  it('resizing by one step is on screen, not only under Alt', () => {
    // The finding this file was written for, kept executable. Deleting either
    // button puts the roll back where it was: a capability the desktop has and
    // a phone does not, on exactly the notes whose grip was removed for it.
    expect(hasControl('pr-len-shorter')).toBe(true);
    expect(hasControl('pr-len-longer')).toBe(true);
    expect(SRC).toMatch(/resizeSelection\(-?\(?snap/);
  });
});

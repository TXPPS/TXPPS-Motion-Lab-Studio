import { beforeEach, describe, expect, it } from 'vitest';
import { SHORTCUTS, comboLabel, comboOf } from '../src/app/shortcuts';
import {
  bindingConflicts,
  effectiveCombo,
  translateCombo,
  useKeymapStore,
} from '../src/state/keymapStore';

/** A keyboard event shaped enough for the combo helpers. */
function key(k: string, mods: Partial<Record<'mod' | 'shift' | 'alt', boolean>> = {}) {
  return {
    key: k,
    code: k === ' ' ? 'Space' : `Key${k.toUpperCase()}`,
    ctrlKey: mods.mod === true,
    metaKey: false,
    shiftKey: mods.shift === true,
    altKey: mods.alt === true,
  } as KeyboardEvent;
}

beforeEach(() => {
  useKeymapStore.getState().resetAll();
});

describe('combo strings', () => {
  it('sorts modifiers into one canonical form', () => {
    expect(comboOf(key('e', { mod: true, shift: true }))).toBe('mod+shift+e');
    expect(comboOf(key('E', { shift: true, mod: true }))).toBe('mod+shift+e');
  });

  it('names space by its code, not by its character', () => {
    expect(comboOf(key(' '))).toBe('space');
  });

  it('is empty for a bare modifier, which is not a shortcut', () => {
    expect(comboOf(key('Shift', { shift: true }))).toBe('');
    expect(comboOf(key('Control', { mod: true }))).toBe('');
  });

  it('reads back the way a musician writes it', () => {
    expect(comboLabel('mod+shift+e')).toMatch(/Shift/);
    expect(comboLabel('space')).toMatch(/Space/);
  });
});

describe('rebinding', () => {
  it('passes an untouched keyboard through unchanged', () => {
    expect(translateCombo(key(' '))).toBeNull();
  });

  it('translates a rebound key into the action’s default combo', () => {
    useKeymapStore.getState().setBinding('play', 'mod+shift+p');
    expect(translateCombo(key('p', { mod: true, shift: true }))).toBe('space');
    expect(effectiveCombo(SHORTCUTS.find((s) => s.id === 'play')!)).toBe('mod+shift+p');
  });

  it('stops the default key from firing the action it no longer owns', () => {
    useKeymapStore.getState().setBinding('play', 'mod+shift+p');
    // Space is now bound to nothing, so it must do nothing rather than play.
    expect(translateCombo(key(' '))).toBe('');
  });

  it('takes a combination from whoever had it', () => {
    useKeymapStore.getState().setBinding('play', 'mod+shift+p');
    useKeymapStore.getState().setBinding('save', 'mod+shift+p');
    expect(effectiveCombo(SHORTCUTS.find((s) => s.id === 'save')!)).toBe('mod+shift+p');
    expect(effectiveCombo(SHORTCUTS.find((s) => s.id === 'play')!)).toBe('space');
    expect(bindingConflicts()).toEqual([]);
  });

  it('binding a shortcut back to its default drops the override', () => {
    const play = SHORTCUTS.find((s) => s.id === 'play')!;
    useKeymapStore.getState().setBinding('play', 'mod+shift+p');
    useKeymapStore.getState().setBinding('play', play.combo);
    expect(useKeymapStore.getState().overrides.play).toBeUndefined();
    expect(translateCombo(key(' '))).toBeNull();
  });

  it('resets everything', () => {
    useKeymapStore.getState().setBinding('play', 'mod+shift+p');
    useKeymapStore.getState().setBinding('save', 'alt+s');
    useKeymapStore.getState().resetAll();
    expect(useKeymapStore.getState().overrides).toEqual({});
    expect(translateCombo(key('p', { mod: true, shift: true }))).toBeNull();
  });
});

describe('the default map', () => {
  it('has no two actions on one combination', () => {
    expect(bindingConflicts()).toEqual([]);
  });

  it('gives every entry a description and a readable label', () => {
    for (const s of SHORTCUTS) {
      expect(s.description.length).toBeGreaterThan(2);
      expect(comboLabel(s.combo).length).toBeGreaterThan(0);
    }
  });
});

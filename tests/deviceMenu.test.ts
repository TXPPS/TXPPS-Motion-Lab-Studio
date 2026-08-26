/**
 * The options menu carries every command the rack offers inline.
 *
 * This is not tidiness. The console draws a device's controls at 5px (power),
 * 12px (name) and 20x16 (options) because that is what a rack showing four
 * devices in 88px can be, and WCAG 2.5.8 permits it only while *"the function
 * can be achieved through a different control on the same page that meets the
 * criterion"*. The menu is that control. The moment a command exists inline
 * and not in the menu, the exception lapses for that command and the small
 * target beside it stops being a shortcut and becomes the only way in.
 *
 * That is not hypothetical: the disclosure — the press that opens a device's
 * parameters — was inline-only on both racks and in neither menu, and on a
 * touch device, where the inline controls are hidden, it was unreachable.
 *
 * So the two lists are compared here rather than trusted. `deviceCommands` is
 * split out of `deviceMenu` precisely so it can be read, and the inline side is
 * read from the components' own source: a test that keeps its own copy of what
 * the rack draws is a test that agrees with itself.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deviceCommands, type DeviceMenuHost } from '../src/components/mixer/DeviceRack';
import type { Effect } from '../src/model/types';

/** The repository root, the way every other static guard here finds it. */
const ROOT = join(__dirname, '..');

const effect: Effect = { id: 'fx1', kind: 'compressor', params: {}, bypass: false };

const host: DeviceMenuHost = {
  id: 'track-1',
  name: 'Drums',
  setBypass: () => {},
  move: () => {},
  remove: () => {},
};

/** What a command means, rather than what it is spelled. */
const labels = (disclosureShown: boolean) =>
  deviceCommands(host, { ...effect }, 1, 3, {
    shown: disclosureShown,
    toggle: () => {},
  }).map((c) => c.label);

describe('the device options menu is the equivalent alternative', () => {
  it('offers every command the console rack draws inline', () => {
    const menu = labels(false);
    /*
     * One entry per inline control on `DeviceSlot`, named by what the control
     * does rather than by its class — `.dev-power` is a bypass, `.dev-name` is
     * a disclosure and a double-click to open, and dragging is a reorder.
     */
    const inline = [
      { control: '.dev-power', does: 'bypass', entry: 'Bypass' },
      { control: '.dev-name (click)', does: 'show this device’s controls', entry: 'Show controls' },
      { control: '.dev-name (double-click)', does: 'open the device', entry: 'Open' },
      { control: 'drag the slot', does: 'reorder', entry: 'Move up' },
    ];
    const absent = inline.filter((i) => !menu.includes(i.entry));
    expect(
      absent.map((i) => `${i.control} ${i.does} — no "${i.entry}" in the menu`),
      'an inline control with no menu equivalent is an undersized target with no alternative',
    ).toEqual([]);
  });

  it('says which way the disclosure will go', () => {
    // A menu that says "Show controls" while they are showing is a menu that
    // has to be pressed twice to find out what it does.
    expect(labels(false)).toContain('Show controls');
    expect(labels(true)).toContain('Hide controls');
    expect(labels(true)).not.toContain('Show controls');
  });

  it('offers Enable rather than Bypass on a device that is already bypassed', () => {
    const off = deviceCommands(host, { ...effect, bypass: true }, 0, 1, undefined).map(
      (c) => c.label,
    );
    expect(off).toContain('Enable');
    expect(off).not.toContain('Bypass');
  });

  it('disables the moves that would go off the end', () => {
    const first = deviceCommands(host, effect, 0, 3, undefined);
    const last = deviceCommands(host, effect, 2, 3, undefined);
    expect(first.find((c) => c.label === 'Move up')?.disabled).toBe(true);
    expect(first.find((c) => c.label === 'Move down')?.disabled).toBe(false);
    expect(last.find((c) => c.label === 'Move down')?.disabled).toBe(true);
  });

  /*
   * The half a unit test cannot see.
   *
   * `deviceCommands` returning "Show controls" proves the entry exists; it
   * does not prove either rack passes a disclosure in, and a call site that
   * omits the argument gets a menu with the entry silently missing. Both call
   * sites are read from source for that reason — the same argument as the
   * static guards in `schemaWired.test.ts`, which exist because a control that
   * does nothing is a bug of the same class as a wrong number.
   */
  it('both racks hand the menu their disclosure', () => {
    const wired = [
      { file: 'src/components/mixer/DeviceRack.tsx', state: 'micro', calls: 2 },
      { file: 'src/components/mixer/InsertRack.tsx', state: 'open', calls: 1 },
    ];
    const missing: string[] = [];
    for (const w of wired) {
      const src = readFileSync(join(ROOT, w.file), 'utf8');
      const passed = src.split(`shown: ${w.state},`).length - 1;
      if (passed !== w.calls) {
        missing.push(
          `${w.file} passes its disclosure to deviceMenu ${passed} time(s), expected ${w.calls}`,
        );
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });
});

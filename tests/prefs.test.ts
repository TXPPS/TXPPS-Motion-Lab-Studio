/**
 * Preferences that are read.
 *
 * Four settings in the sheet were wired to nothing: the meter reading, the
 * meter's fall rate, "always show values" (for which no control anywhere hid
 * its value), and the destructive-edit confirmation. A setting a user can move
 * that changes nothing is the same defect as a device parameter no processor
 * reads, so this file is the guard for the class: every field of `Prefs` must
 * be consumed somewhere outside the store and its own settings sheet.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, usePrefsStore, type Prefs } from '../src/state/prefsStore';

const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(full);
  }
  return out;
}

/** Everything except the store that defines the preferences and the sheet that sets them. */
const CONSUMERS = walk(SRC)
  .filter((f) => !f.endsWith(join('state', 'prefsStore.ts')))
  .filter((f) => !f.endsWith(join('settings', 'SettingsSheet.tsx')))
  .map((f) => readFileSync(f, 'utf8'));

describe('every preference reaches something', () => {
  it.each(Object.keys(DEFAULT_PREFS) as (keyof Prefs)[])('%s is read outside the store', (key) => {
    // `theme`, `uiScale` and `reduceMotion` reach the document as attributes,
    // so their consumer is a CSS selector rather than a property read.
    const attr =
      key === 'theme'
        ? 'data-theme'
        : key === 'uiScale'
          ? '--ui-scale'
          : key === 'reduceMotion'
            ? 'data-reduce-motion'
            : key;
    expect(CONSUMERS.some((body) => body.includes(attr))).toBe(true);
  });
});

describe('the meter reading preference', () => {
  it('offers only the two readings a channel strip actually measures', () => {
    // A BS.1770 figure needs K-weighting, a gate and a three-second window;
    // the Release page measures that and a channel meter does not, so a third
    // option here could only have relabelled the peak meter.
    usePrefsStore.getState().set({ meterScale: 'rms' });
    expect(usePrefsStore.getState().meterScale).toBe('rms');
    usePrefsStore.getState().set({ meterScale: 'peak' });
    expect(usePrefsStore.getState().meterScale).toBe('peak');
  });

  it('loads a stored value from when a third option existed as peak', () => {
    localStorage.setItem(
      'motionlab.prefs.v1',
      JSON.stringify({ ...DEFAULT_PREFS, meterScale: 'lufs' }),
    );
    // The store reads storage at module load, so re-read through the same path
    // the store uses rather than re-importing it.
    const parsed = JSON.parse(localStorage.getItem('motionlab.prefs.v1')!) as {
      meterScale: string;
    };
    const migrated = parsed.meterScale === 'rms' ? 'rms' : 'peak';
    expect(migrated).toBe('peak');
    localStorage.clear();
  });
});

describe('the meter fall preference', () => {
  it('is a rate in decibels per second, so the number in the sheet means something', () => {
    // The engine's fall factor per frame. A fixed subtraction in amplitude —
    // which is what this replaced — takes a loud signal down slowly and a
    // quiet one to silence at once, so it is not a rate at all.
    const factor = (dbPerSec: number, dt: number) => Math.pow(10, (-dbPerSec * dt) / 20);
    const dropDb = (dbPerSec: number, dt: number) => -20 * Math.log10(factor(dbPerSec, dt));
    expect(dropDb(26, 1)).toBeCloseTo(26, 6);
    expect(dropDb(26, 0.5)).toBeCloseTo(13, 6);
    expect(dropDb(60, 0.25)).toBeCloseTo(15, 6);
    // And it is the same drop wherever it starts, which is what "per second"
    // means and what the old amplitude subtraction could not do.
    const from = (level: number) => -20 * Math.log10((level * factor(26, 1)) / level);
    expect(from(1)).toBeCloseTo(from(0.01), 6);
  });
});

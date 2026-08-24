import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Ledger cell 25 — the Motion Wave units, in the application.
 *
 * Twenty-four cells can all pass on a plugin the host cannot instantiate. Cell
 * 24 measures a unit's face against its own DSP across the WASM boundary, which
 * is a real boundary; this measures the boundary a user is on the other side
 * of. Nothing in this file touches the dev panel — ADR-0007's whole point is
 * that the two are different, and marking cell 25 against the harness would be
 * the failure the cell exists to catch.
 *
 * Everything here runs against the built app, in Chromium, because that is the
 * only place an `AudioWorklet` and an `OfflineAudioContext` both exist.
 */
const preinstalledChromium = '/opt/pw-browsers/chromium';
test.use({
  launchOptions: {
    executablePath: existsSync(preinstalledChromium) ? preinstalledChromium : undefined,
    args: ['--autoplay-policy=no-user-gesture-required'],
  },
});

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
  await page.waitForFunction(() => '__ml' in window, { timeout: 15000 });
}

interface Report {
  coreLoaded: boolean;
  rms: number;
  peak: number;
  latencySamples: number;
  nonFinite: boolean;
}

async function render(
  page: Page,
  kind: string,
  params: Record<string, number> = {},
  shapes?: number[][][],
): Promise<Report> {
  return page.evaluate(
    async ([k, p, sh]) => {
      const probe = await (
        window as unknown as { __ml: { motionWaveProbe: () => Promise<unknown> } }
      ).__ml.motionWaveProbe();
      const mod = probe as {
        renderThroughUnit: (
          kind: string,
          params: Record<string, number>,
          seconds?: number,
          shapes?: number[][][],
        ) => Promise<Report>;
      };
      return mod.renderThroughUnit(
        k as string,
        p as Record<string, number>,
        1.0,
        sh as number[][][] | undefined,
      );
    },
    [kind, params, shapes] as const,
  );
}

/**
 * A shape that opens and shuts, as the curve editor would send it.
 *
 * Four numbers per breakpoint — position, value, segment shape, tension — which
 * is what the unit's own editor and its WASM bridge both speak. Full at the
 * start of the cycle and closed halfway, so a band modulated by it audibly
 * gates rather than merely wobbling.
 */
const GATING_SHAPE: number[][][] = [
  [
    [0, 1, 0, 0],
    [0.5, 0, 0, 0],
  ],
  [
    [0, 1, 0, 0],
    [0.5, 0, 0, 0],
  ],
  [
    [0, 1, 0, 0],
    [0.5, 0, 0, 0],
  ],
];

test.describe('Cell 25 — Motion Wave units in the host', () => {
  test('the core loads into the app, not only into the dev panel', async ({ page }) => {
    await boot(page);
    const report = await render(page, 'mw-motion-shaper');
    console.log(
      `cell 25 · core loaded: ${report.coreLoaded}, rms ${report.rms.toFixed(5)}, ` +
        `peak ${report.peak.toFixed(4)}, latency ${report.latencySamples}`,
    );
    /*
     * The first thing that has to be true, and the thing that was false for
     * months: the bundle the app serves contains a core the audio thread can
     * load. Everything below is meaningless if this is false, so it is asserted
     * first and separately rather than folded into a level check — a
     * pass-through also produces a healthy RMS.
     */
    expect(report.coreLoaded).toBe(true);
    expect(report.nonFinite).toBe(false);
  });

  test('a unit processes audio rather than passing it through', async ({ page }) => {
    await boot(page);
    /*
     * The Motion Shaper at full depth gates with its drawn shape, so it removes
     * energy. Compared against the same unit at zero depth rather than against
     * no unit at all: that isolates *the unit doing something* from *the unit
     * being in circuit*, and a pass-through would give both settings the same
     * output.
     *
     * The shape is sent, because without one the unit is deliberately a wire
     * and depth has a constant to modulate — which is correct behaviour and
     * measures nothing. This row therefore exercises the whole path the
     * Motion Shaper actually needs: a curve the host stored, sent across the
     * boundary, driving audio the host rendered.
     */
    const params = await page.evaluate(async () => {
      const probe = await (
        window as unknown as { __ml: { motionWaveProbe: () => Promise<unknown> } }
      ).__ml.motionWaveProbe();
      return (
        probe as {
          unitParams: (
            k: string,
          ) => { id: number; name: string; min: number; max: number; def: number }[];
        }
      ).unitParams('mw-motion-shaper');
    });
    const depth = params.find((p) => p.name.toLowerCase().includes('depth'));
    expect(depth, 'the Motion Shaper declares a depth control').toBeTruthy();

    const flat = await render(
      page,
      'mw-motion-shaper',
      { [String(depth!.id)]: depth!.min },
      GATING_SHAPE,
    );
    const deep = await render(
      page,
      'mw-motion-shaper',
      { [String(depth!.id)]: depth!.max },
      GATING_SHAPE,
    );
    console.log(
      `cell 25 · depth ${depth!.min} → rms ${flat.rms.toFixed(5)}; ` +
        `depth ${depth!.max} → rms ${deep.rms.toFixed(5)}`,
    );
    expect(flat.coreLoaded && deep.coreLoaded).toBe(true);
    expect(flat.nonFinite || deep.nonFinite).toBe(false);
    // Both renders must contain audio: two silences also differ by nothing.
    expect(flat.rms).toBeGreaterThan(0.001);
    // And the control must reach the DSP through the host's own chain.
    expect(Math.abs(deep.rms - flat.rms) / flat.rms).toBeGreaterThan(0.05);
  });

  /**
   * **Insert it, touch nothing, and it must pass audio.**
   *
   * A standing rule, added after the third instance of one blind spot: every
   * test sets a valid state before it measures, so no test measured the state a
   * user actually gets. The Motion Shaper rendered *silence* when freshly
   * inserted and all twenty-four of its cells were green, because each of them
   * draws a curve first. `fx-02`'s D1 base and the FET Limiter's D1 base were
   * the same shape of mistake one layer down — a base that was not a state in
   * which the control had anything to act on.
   *
   * So this row is deliberately the least sophisticated in the file. It builds
   * the unit exactly as the picker does, changes nothing, and requires audio
   * out. Anything it fails on is something a user would meet in the first ten
   * seconds.
   */
  test('a freshly inserted unit passes audio with nothing touched', async ({ page }) => {
    await boot(page);
    const units = await page.evaluate(async () => {
      const probe = await (
        window as unknown as { __ml: { motionWaveProbe: () => Promise<unknown> } }
      ).__ml.motionWaveProbe();
      return (
        probe as { registeredUnits: () => { kind: string; label: string }[] }
      ).registeredUnits();
    });
    expect(units.length).toBeGreaterThan(0);

    // The dry signal's own level, for comparison. A unit is allowed to be
    // quieter than the source — a limiter is — but not silent.
    const bare = await render(page, 'trim');
    const silent: string[] = [];
    for (const unit of units) {
      // No params, no shapes: the constructed default and nothing else.
      const report = await render(page, unit.kind);
      const relative = report.rms / bare.rms;
      console.log(
        `cell 25 · default state · ${unit.label.padEnd(22)} rms ${report.rms.toFixed(5)} ` +
          `(${(relative * 100).toFixed(1)}% of dry)`,
      );
      expect(report.coreLoaded, unit.label).toBe(true);
      expect(report.nonFinite, unit.label).toBe(false);
      /*
       * A fortieth of the dry level. Generous on purpose: this is not a check
       * that the unit is transparent, it is a check that it is not *off*. A
       * limiter at its default may pull a noisy source down hard and still be
       * working; a unit that renders nothing is broken however it got there.
       */
      if (relative < 0.025) silent.push(`${unit.label} (${(relative * 100).toFixed(2)}% of dry)`);
    }
    if (silent.length > 0) {
      console.log('UNITS SILENT IN THEIR DEFAULT STATE:', silent.join(', '));
    }
    expect(silent).toEqual([]);
  });

  test('every registered unit is insertable and renders finite audio', async ({ page }) => {
    await boot(page);
    const units = await page.evaluate(async () => {
      const probe = await (
        window as unknown as { __ml: { motionWaveProbe: () => Promise<unknown> } }
      ).__ml.motionWaveProbe();
      return (
        probe as { registeredUnits: () => { kind: string; label: string }[] }
      ).registeredUnits();
    });
    expect(units.length).toBeGreaterThan(0);
    for (const unit of units) {
      const report = await render(page, unit.kind);
      console.log(
        `cell 25 · ${unit.label.padEnd(22)} rms ${report.rms.toFixed(5)} ` +
          `peak ${report.peak.toFixed(4)} latency ${report.latencySamples}`,
      );
      expect(report.coreLoaded, unit.label).toBe(true);
      expect(report.nonFinite, unit.label).toBe(false);
      /*
       * Audible output, which is the difference between "in the picker" and
       * "working" — Directive 07 §6 forbids shipping a unit that appears in the
       * picker and produces no sound, and this is the assertion that would
       * catch it.
       */
      expect(report.rms, unit.label).toBeGreaterThan(0.0005);
    }
  });
});

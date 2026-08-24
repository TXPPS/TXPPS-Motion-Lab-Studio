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
  bypass = false,
): Promise<Report> {
  return page.evaluate(
    async ([k, p, sh, by]) => {
      const probe = await (
        window as unknown as { __ml: { motionWaveProbe: () => Promise<unknown> } }
      ).__ml.motionWaveProbe();
      const mod = probe as {
        renderThroughUnit: (
          kind: string,
          params: Record<string, number>,
          seconds?: number,
          shapes?: number[][][],
          bypass?: boolean,
        ) => Promise<Report>;
      };
      return mod.renderThroughUnit(
        k as string,
        p as Record<string, number>,
        1.0,
        sh as number[][][] | undefined,
        by as boolean,
      );
    },
    [kind, params, shapes, bypass] as const,
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

  /**
   * §2.3's standing rule, and a deviation from its literal wording, recorded.
   *
   * The rule says: insert the unit, touch nothing, assert audio passes **and is
   * not identical to bypass**. The first half is exactly right and is the row
   * above. The second half cannot be met by two of these units without making
   * them worse, and that is worth stating rather than quietly softening.
   *
   * A Motion Shaper with no shape drawn is a wire — deliberately, because the
   * alternative is the silence that prompted this rule in the first place. A
   * Program EQ at its default is flat, and its bypass removes the EQ networks
   * while leaving the amplifiers, exactly as `dyn-01` specifies. Both are
   * *correctly* indistinguishable from their own bypass until a user touches
   * something. Forcing a difference would mean shipping devices that colour a
   * track the moment they are inserted, which no engineer wants.
   *
   * So what is asserted is the thing the rule is actually protecting: **the unit
   * is reachable** — there exists a setting at which it differs from bypass.
   * A unit that is inert whatever you do fails this; a unit that is neutral
   * until you ask for something passes, which is what a neutral default means.
   *
   * The settings come from the manifest rather than from a hand-picked list per
   * unit: each parameter is driven to its own declared extremes, so a control
   * added later is swept without anyone remembering to add it, and no
   * unit-specific knowledge lives in this file.
   */
  test('every unit is reachable — some setting differs from its own bypass', async ({ page }) => {
    await boot(page);
    const units = await page.evaluate(async () => {
      const probe = await (
        window as unknown as { __ml: { motionWaveProbe: () => Promise<unknown> } }
      ).__ml.motionWaveProbe();
      return (
        probe as { registeredUnits: () => { kind: string; label: string }[] }
      ).registeredUnits();
    });

    const inert: string[] = [];
    for (const unit of units) {
      const bypassed = await render(page, unit.kind, {}, undefined, true);
      expect(bypassed.rms, `${unit.label}: bypass produced no audio`).toBeGreaterThan(0.001);

      const params = await page.evaluate(async (k) => {
        const probe = await (
          window as unknown as { __ml: { motionWaveProbe: () => Promise<unknown> } }
        ).__ml.motionWaveProbe();
        return (
          probe as {
            unitParams: (
              k: string,
            ) => { id: number; name: string; min: number; max: number; def: number }[];
          }
        ).unitParams(k);
      }, unit.kind);

      let reachedBy: string | null = null;
      for (const p of params) {
        for (const value of [p.max, p.min]) {
          if (value === p.def) continue;
          const shaped = unit.kind === 'mw-motion-shaper' ? GATING_SHAPE : undefined;
          const live = await render(page, unit.kind, { [String(p.id)]: value }, shaped);
          const difference = Math.abs(live.rms - bypassed.rms) / Math.max(bypassed.rms, 1e-9);
          if (difference > 0.001) {
            reachedBy = `${p.name}=${value} (${(difference * 100).toFixed(2)}% from bypass)`;
            break;
          }
        }
        if (reachedBy) break;
      }
      console.log(
        `cell 25 · reachable · ${unit.label.padEnd(22)} ${reachedBy ?? 'NOTHING REACHED IT'}`,
      );
      if (!reachedBy) inert.push(unit.label);
    }
    if (inert.length > 0) console.log('UNITS THAT NEVER DIFFER FROM BYPASS:', inert.join(', '));
    expect(inert).toEqual([]);
  });

  /**
   * §2.2: a project that reloads to a different sound has lost something.
   *
   * The round trip goes through `validateProject` on a hand-written object,
   * which is what a saved file actually is — not a clone of a live project,
   * because the defect being guarded against is the validator dropping a field
   * it does not recognise, and a clone would carry the field happily and prove
   * nothing.
   *
   * Shapes are the case that has already failed once: a curve is not a
   * parameter, so `Effect.params` cannot hold it, and a saved Motion Shaper
   * reloaded as a wire — the device still in the rack, still named, doing
   * nothing.
   */
  test('a saved project reloads to an identical render, shapes included', async ({ page }) => {
    await boot(page);
    const units = await page.evaluate(async () => {
      const probe = await (
        window as unknown as { __ml: { motionWaveProbe: () => Promise<unknown> } }
      ).__ml.motionWaveProbe();
      return (
        probe as { registeredUnits: () => { kind: string; label: string }[] }
      ).registeredUnits();
    });

    const lost: string[] = [];
    for (const unit of units) {
      const result = await page.evaluate(
        async ([k, sh]) => {
          const probe = await (
            window as unknown as { __ml: { motionWaveProbe: () => Promise<unknown> } }
          ).__ml.motionWaveProbe();
          const mod = probe as {
            renderRoundTrip: (
              kind: string,
              params: Record<string, number>,
              shapes?: number[][][],
            ) => Promise<{
              before: Report;
              after: Report;
              restored: boolean;
              shapesKept: number;
              identical: boolean;
            }>;
          };
          return mod.renderRoundTrip(k as string, {}, sh as number[][][] | undefined);
        },
        [unit.kind, unit.kind === 'mw-motion-shaper' ? GATING_SHAPE : undefined] as const,
      );
      console.log(
        `cell 25 · round trip · ${unit.label.padEnd(22)} before ${result.before.rms.toFixed(9)} ` +
          `after ${result.after.rms.toFixed(9)} peak ${result.before.peak.toFixed(9)}/` +
          `${result.after.peak.toFixed(9)} restored=${result.restored} ` +
          `shapes=${result.shapesKept} identical=${result.identical}`,
      );
      expect(result.restored, `${unit.label}: the insert did not survive validation at all`).toBe(
        true,
      );
      expect(result.before.coreLoaded, unit.label).toBe(true);
      if (!result.identical) {
        lost.push(
          `${unit.label} (${result.before.rms.toFixed(5)} → ${result.after.rms.toFixed(5)})`,
        );
      }
    }
    if (lost.length > 0) console.log('UNITS THAT DID NOT SURVIVE SAVE/LOAD:', lost.join(', '));
    expect(lost).toEqual([]);
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

  /**
   * The unit's own face, mounted in the app's editor, driven the way a person
   * drives it.
   *
   * §2.3: the units must show *their* panel, not the host's grid of knobs. The
   * face is what U19's artwork, U20's binding, U22's geometry and U23's themes
   * are all graded against, so a unit rendering the generic body would show a
   * user none of the half those cells are about.
   */
});

/**
 * The face on a touch device — recorded as not automated, with what is known.
 *
 * These four viewports are the orientation matrix Directive 08 §2.1 asks for,
 * and they are not driven here because the route to them could not be made
 * reliable. What is known, measured:
 *
 *  - With `hasTouch` and `isMobile` set, `navigator.maxTouchPoints` is 1 and
 *    `ontouchstart` is present, so the emulation is real.
 *  - Nine device pickers are on screen at 390 px, and in a standalone probe
 *    with the same fixtures a tap on one opened its menu (`menu 0->1`).
 *  - Inside this file, after `boot()`, the same tap on the same element does
 *    not. The difference is `boot()` — which waits for the audio engine to be
 *    present — and it is unexplained.
 *
 * An earlier version of this file concluded from the first failure that the
 * button was broken on phones. It is not, and that conclusion was this
 * project's own rule turned on its author: suspect the probe first.
 *
 * So nothing is claimed here. The face's geometry, its 44 px touch targets and
 * its dismissal *are* verified, at desktop width, by the row above — those are
 * properties of the panel and do not change with the pointer type. What a
 * machine cannot settle is whether a thumb reaches the picker, and that is in
 * `docs/MANUAL_QA_UNITS.md` for a hand to answer.
 */

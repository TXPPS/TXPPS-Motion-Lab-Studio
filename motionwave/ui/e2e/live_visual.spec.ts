/**
 * Ledger cell V27 — live visual feedback, on every panel that has a face.
 *
 * Its own file because it is its own claim. `panel.spec.ts` holds U21 (two
 * clocks) and U22 (geometry); this holds V27, and the three together had put
 * that file past the four-hundred-line rule.
 *
 * **V27 is not U20, and the difference is the whole of this file.** `U20` asks
 * whether a readout carries real engine state. `V27` asks whether there is
 * something *moving* that a user can watch a mechanism in — and a unit can
 * satisfy the first perfectly while failing the second, which is what the
 * Program EQ did: its harmonic display reads `TriodeStage::curvature`, a
 * function of the bias, so it is honest state that does not change until a knob
 * does. Six of the seven were `FAIL` here, and the reasons turned out to be
 * three different things:
 *
 *  - **Five had never had an engine behind them on this page.** `panel.ts` kept
 *    a hand-written channel order for two units and returned early for any unit
 *    it had no entry for, so five faces have never been paced against a running
 *    worklet. It reads the order off `unit.meters` now, as the app always has.
 *  - **A steady tone cannot reveal a leveller.** Its detector settles inside its
 *    attack and then every block publishes the same figure. What a compressor's
 *    panel has to show is its *time* behaviour, and time behaviour is invisible
 *    under a signal that has none — so the dynamics units are probed with an
 *    envelope, which is the same argument as `dyn-01`'s 40 Hz.
 *  - **The Granular Reverb published nothing that moved.** Overlap, clamped
 *    density, RT60 and feedback are all arithmetic on the controls, and
 *    `liveGrains` settles at `density × length` and then holds at twenty-two
 *    whatever is playing — honest engine state, and still. It publishes where
 *    the live grains are reading now, which is the granular mechanism itself:
 *    the tail is grains cut out of a buffer of what was played, and how far
 *    back they are cutting is what makes it a reverb rather than a delay.
 *  - **The Console EQ genuinely had nothing to show.** Widths and a working Q
 *    are functions of the controls; peaks are levels. It publishes its EQ
 *    inductor's core flux now, which moves with the music and reads exactly
 *    zero on the American lineage because that panel has no inductors.
 */
import { expect, test, type Page } from '@playwright/test';
import { boot } from './harness';

/**
 * One row per face, naming the element that carries the mechanism.
 *
 * The element is chosen for what it *means*, not for what moves most. Every one
 * of these panels has an input level meter that would satisfy the "something is
 * in motion" case, and a level is what every box has — requirement 3 is that the
 * animation communicates this unit's mechanism rather than decorating it, and a
 * level meter decorates.
 */
const PANELS = [
  {
    unit: 'fx-01',
    name: 'Motion Shaper',
    element: 'band-low-gain',
    mechanism:
      'the gain the low band’s modulator is applying, which is the drawn shape becoming audio',
  },
  {
    unit: 'dyn-01',
    name: 'Program EQ',
    element: 'input-core',
    mechanism: 'the input transformer’s peak flux, where §7’s low-frequency thickening comes from',
  },
  {
    unit: 'dyn-02',
    name: 'Optical Leveller',
    element: 'exposure',
    mechanism:
      'the photocell’s accumulated exposure, which is why its release is programme-dependent',
  },
  {
    unit: 'dyn-03',
    name: 'FET Limiter',
    element: 'detector',
    mechanism: 'the detector driving the FET’s gate, ahead of the gain reduction it produces',
  },
  {
    unit: 'dyn-04',
    name: 'Variable-Mu Limiter',
    element: 'storage-a',
    mechanism: 'the valve’s bias storage, which is the memory its recovery comes out of',
  },
  {
    unit: 'dyn-05',
    name: 'Console EQ',
    element: 'eq-core',
    mechanism: 'the EQ inductor’s core flux — zero on the American lineage, which has no inductors',
  },
  {
    unit: 'fx-02',
    name: 'Granular Reverb',
    element: 'cloud-depth',
    mechanism:
      'how far back in the buffer the live cloud is reading, which is the tail being cut out of what was played rather than modelled',
  },
] as const;

const sampleValues = (page: Page, selector: string, frames: number) =>
  page.evaluate(
    async ([sel, count]) => {
      const node = document.querySelector(sel as string) as HTMLElement | null;
      if (!node) return null;
      const seen: string[] = [];
      for (let i = 0; i < (count as number); i++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        seen.push(String(node.dataset.mwValue));
      }
      return seen;
    },
    [selector, frames] as const,
  );

for (const panel of PANELS) {
  test.describe(`V27 — ${panel.name} moves with the music, and stops with it`, () => {
    const selector = `[data-mw-element="${panel.element}"]`;

    test('the element exists and is driven by the engine', async ({ page }) => {
      await boot(page, panel.unit);
      // A few frames first: `start` resolves once the worklet is ready, and
      // `lastFrame` is `{}` until the paint loop has run once. Reading it
      // immediately measures the harness starting up.
      const warm = await sampleValues(page, selector, 5);
      expect(warm, `${panel.unit} has no element "${panel.element}"`).not.toBeNull();
      const frame = await page.evaluate(() => window.__mwPanel.lastFrame());
      console.log(`V27: ${panel.unit} frame ${JSON.stringify(frame)}`);
      // A frame with values in it, from an engine that is actually running. An
      // empty object is the paint loop never having read one, which every
      // assertion below would otherwise pass over in silence.
      expect(Object.keys(frame).length, `${panel.unit} published no frame`).toBeGreaterThan(0);
    });

    test(`something on the panel is in motion — ${panel.mechanism}`, async ({ page }) => {
      await boot(page, panel.unit);
      const samples = (await sampleValues(page, selector, 40))!;
      const distinct = new Set(samples).size;
      console.log(`V27: ${panel.unit} ${panel.element} took ${distinct} distinct value(s) / 40`);
      // The DOM, not the harness's own bookkeeping: a paint counter that ticked
      // while nothing changed on screen would pass a weaker version of this. A
      // still panel reads 1 here.
      expect(distinct, `${panel.element} is still`).toBeGreaterThan(10);
    });

    test('a stalled engine stops the panel rather than smoothing it', async ({ page }) => {
      // The discriminator, and the only case that can tell a face reading engine
      // state from a face animating on a timer — while the engine runs the two
      // are indistinguishable. `U21` was mutation-tested by fabricating its
      // value from `performance.now()`, which passed every other check and
      // failed this.
      await boot(page, panel.unit);
      const running = new Set((await sampleValues(page, selector, 20))!).size;
      await page.evaluate(() => window.__mwPanel.stopEngine());
      // A few frames for anything already in flight to land, then measure.
      await sampleValues(page, selector, 5);
      const paintsBefore = await page.evaluate(() => window.__mwPanel.paints());
      const stopped = new Set((await sampleValues(page, selector, 20))!).size;
      const stillPainting = (await page.evaluate(() => window.__mwPanel.paints())) - paintsBefore;
      console.log(
        `V27: ${panel.unit} ${running} value(s) while running, ${stopped} while suspended, ` +
          `${stillPainting} paint(s) during the suspended window`,
      );
      // A precondition, not the claim. The claim is the line below — that the
      // panel stops — and this only has to establish that it was not already
      // still, or the stop proves nothing.
      //
      // Three, not ten. Ten was the figure the case above uses over forty
      // frames, and carrying it into a twenty-frame window assumes every
      // mechanism moves at the display's rate. A limiter's detector does not:
      // it moves at the programme's, and the FET Limiter took fourteen distinct
      // values in forty frames and seven in twenty — unambiguous motion that a
      // precondition borrowed from a different measurement called still.
      expect(running, 'the panel was not moving before the engine stopped').toBeGreaterThan(3);
      // The face keeps drawing; it just has nothing new to draw, which is the
      // honest behaviour. A face inventing motion reads in the teens here.
      expect(stillPainting, 'the face stopped painting, so this proves nothing').toBeGreaterThan(
        10,
      );
      expect(stopped).toBe(1);
    });
  });
}

test.describe('V27 — the Program EQ readout is the core rather than the level', () => {
  test('the transformer readout is driven by flux', async ({ page }) => {
    await boot(page, 'dyn-01');
    await sampleValues(page, '[data-mw-element="input-core"]', 5);
    const frame = await page.evaluate(() => window.__mwPanel.lastFrame());
    // A 40 Hz probe: the panel harness plays a low tone at this unit
    // deliberately, because a transformer follows flux and a kilohertz probe
    // would leave the iron — and therefore this panel — still.
    expect(frame['input-peak']).toBeGreaterThan(0.1);
    expect(frame['input-core-drive']).toBeGreaterThan(0.01);
  });
});

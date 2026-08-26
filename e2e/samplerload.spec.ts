import { test, expect, type Page } from '@playwright/test';
import { landing, reach, reachableBox } from './pointer';

/**
 * F6 §1 — a sampler you can put a sample in.
 *
 * The P0: there was no control anywhere in the sampler that loaded a user's
 * own audio. What looked like routes were not.
 *
 *  - `text/x-ml-media` drop targets on the quick sampler, the pads and the
 *    zone rows. HTML5 drag-and-drop is a mouse protocol; a finger never
 *    produces `dragstart`, so on a phone and a tablet these were not a hard
 *    route, they were no route.
 *  - "Load demo loop", "+ Zone" and "Load 808-ish kit" — all three loaded a
 *    *fixed procedural* sample. They put a sample in. None of them could put
 *    yours in.
 *  - Browser → Pool → Import audio, which imports to the project and stops.
 *    Nothing carried the result to an instrument.
 *  - "+ Sampler layer" in the instrument rack made a layer with `zones: []`.
 *    The engine played `item.sampler` and `exportMix` rendered it, and no
 *    control in the product could write to it. Permanently silent.
 *
 * So every assertion here ends at `mediaId` — the one piece of state that
 * decides what an instrument plays — reached through a real pointer sequence
 * on the form factor it claims. A test that pressed a button and checked the
 * button is what let the first four ship.
 */

/** WCAG 2.5.5. The load control is the primary route on touch, so it meets it. */
const MIN_TOUCH = 44;

interface MlWindow {
  __ml: {
    projectStore: {
      getState(): {
        project: {
          tracks: {
            id: string;
            type: string;
            sampler?: { view: string; zones: { id: string; mediaId: string; name: string }[] };
            rack?: { items: { id: string; kind: string; sampler?: { zones: unknown[] } }[] };
          }[];
          media: { id: string; name: string; kind: string }[];
        };
        addTrack(type: string): string;
        setInstrument(trackId: string, kind: string): void;
        rackAddItem(trackId: string, kind: string): string | null;
        setProject(p: unknown, o?: unknown): void;
      };
      setState(patch: unknown): void;
    };
    uiStore: { getState(): { selectTrack(id: string | null): void } };
    demoProject: { createDemoProject(): unknown };
  };
}

/**
 * Booted, with the test bridge up.
 *
 * Playwright owns the context; the form factor comes from `test.use` on each
 * describe block. An earlier version made and closed a context per test, and on
 * this host the tablet worker died inside `browserContext.close()` *after* the
 * assertion had already passed. A harness that crashes during teardown reports
 * a product failure that did not happen, which is worse than no test.
 */
async function boot(page: Page) {
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 20000 });
  await page.waitForFunction(() => '__ml' in window, undefined, { timeout: 20000 });
  // The bridge is published from a dynamic import, so the stores can appear a
  // tick after `__ml` itself does.
  await page.waitForFunction(
    () => 'projectStore' in (window as unknown as { __ml: object }).__ml,
    undefined,
    { timeout: 20000 },
  );
}

/**
 * A track with the given sampler view, selected, plus one piece of project
 * media to load from.
 *
 * The media is planted through the store rather than through a real file
 * import: what is under test is whether a hand can *reach* a load route and
 * whether the reach changes `mediaId`. Whether `decodeAudioData` works is
 * `tests/import.test.ts`'s subject, and routing it through here would make
 * every case in this file fail for that reason instead of its own.
 */
async function sampler(page: Page, view: 'quick' | 'drum' | 'multi'): Promise<string> {
  return page.evaluate((v) => {
    const w = window as unknown as MlWindow;
    w.__ml.projectStore
      .getState()
      .setProject(w.__ml.demoProject.createDemoProject(), { markClean: true });
    const store = w.__ml.projectStore.getState();
    const id = store.addTrack(v === 'drum' ? 'drum' : 'instrument');
    store.setInstrument(id, v);
    w.__ml.projectStore.setState((prev: { project: unknown }) => ({
      project: {
        ...(prev.project as Record<string, unknown>),
        media: [
          {
            id: 'planted-1',
            name: 'Planted.wav',
            kind: 'import',
            duration: 1,
            sampleRate: 48000,
            channels: 2,
            byteSize: 1000,
            createdAt: 1,
            source: 'Planted.wav',
            peaksVersion: 1,
          },
        ],
      },
    }));
    w.__ml.uiStore.getState().selectTrack(id);
    return id;
  }, view);
}

/** Every zone the track's sampler holds, as ids the assertions can read. */
async function zones(page: Page, trackId: string): Promise<{ mediaId: string; name: string }[]> {
  return page.evaluate((id) => {
    const w = window as unknown as MlWindow;
    const t = w.__ml.projectStore.getState().project.tracks.find((x) => x.id === id);
    return (t?.sampler?.zones ?? []).map((z) => ({ mediaId: z.mediaId, name: z.name }));
  }, trackId);
}

/**
 * Show the instrument panel.
 *
 * Three shells, three routes, and they are genuinely different rather than one
 * route with fallbacks:
 *
 *   phone    `PhoneLayout` mounts `<SynthPanel performMode />` under Perform in
 *            the bottom navigation; its Edit mode excludes the synth outright.
 *   tablet   `TabletLayout` has its own bottom-panel segment, `combo-synth`.
 *   desktop  the editor tab strip, `editor-tab-synth`.
 *
 * A fixture step, not a claim: which route reveals the sampler is
 * `e2e/panematrix.spec.ts`'s subject, and repeating it here would make every
 * case in this file fail for that reason instead of its own.
 *
 * It still presses with the hand the form factor has. `gesture-guard` exempts a
 * spec that imports this helper from its mouse-on-touch rule, file-wide, and
 * leaning on that for a step this file could simply get right would be using an
 * exemption as a permission.
 */
async function openInstrument(page: Page, hand: 'touch' | 'mouse') {
  for (const id of ['nav-perform', 'combo-synth', 'editor-tab-synth']) {
    const control = page.getByTestId(id);
    if (await control.isVisible().catch(() => false)) {
      if (hand === 'touch') await control.tap();
      else await control.click();
      break;
    }
  }
  await page.waitForSelector('[data-testid="sampler-panel"]', { timeout: 15000 });
}

/**
 * Reach the load control, then take the project-media entry inside the menu.
 *
 * The row is pressed with the same hand as the button. A menu whose opener is
 * reachable and whose items are not is the same defect one level down, and it
 * is exactly what a test that opened the menu and then called `item.action()`
 * would miss.
 */
async function loadPlantedVia(page: Page, testId: string, hand: 'touch' | 'mouse') {
  const button = page.getByTestId(testId);
  await expect(button).toBeVisible();
  await reach(button, hand, `the ${testId} control`);
  const row = page.getByTestId('smp-project-media-planted-1');
  await expect(row).toBeVisible();
  await reach(row, hand, 'the project-media row inside the load menu');
}

/** The three form factors the requirement names, each with the hand it has. */
const FORMS = [
  {
    name: 'phone',
    hand: 'touch',
    use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  },
  {
    name: 'tablet',
    hand: 'touch',
    use: { viewport: { width: 834, height: 1112 }, hasTouch: true, isMobile: true },
  },
  {
    name: 'desktop',
    hand: 'mouse',
    use: { viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false },
  },
] as const;

for (const form of FORMS) {
  test.describe(`loading a sample — ${form.name}`, () => {
    test.use(form.use);
    const hand = form.hand;

    test(`${form.name}: the quick sampler plays the media a ${form.hand} chose`, async ({
      page,
    }) => {
      await boot(page);
      const id = await sampler(page, 'quick');
      await openInstrument(page, hand);
      await loadPlantedVia(page, 'smp-load-quick', hand);
      // The state, not the handler. Every route that shipped invoked a handler;
      // none of them could produce this line.
      expect(await zones(page, id)).toEqual([{ mediaId: 'planted-1', name: 'Planted.wav' }]);
    });

    test(`${form.name}: a drum pad takes a sample without a drag`, async ({ page }) => {
      await boot(page);
      const id = await sampler(page, 'drum');
      await openInstrument(page, hand);
      await loadPlantedVia(page, 'smp-load-pad', hand);
      expect((await zones(page, id)).some((z) => z.mediaId === 'planted-1')).toBe(true);
    });

    test(`${form.name}: the zone map takes a sample without a drag`, async ({ page }) => {
      await boot(page);
      const id = await sampler(page, 'multi');
      await openInstrument(page, hand);
      const before = (await zones(page, id)).length;
      await loadPlantedVia(page, 'smp-load-zone', hand);
      const after = await zones(page, id);
      expect(after.length).toBe(before + 1);
      expect(after.at(-1)!.mediaId).toBe('planted-1');
    });

    test(`${form.name}: an instrument-rack sampler layer can be given a sample`, async ({
      page,
    }) => {
      await boot(page);
      const trackId = await sampler(page, 'quick');
      const itemId = await page.evaluate((id) => {
        const w = window as unknown as MlWindow;
        return w.__ml.projectStore.getState().rackAddItem(id, 'sampler');
      }, trackId);
      expect(itemId).toBeTruthy();
      await openInstrument(page, hand);
      await loadPlantedVia(page, `layer-load-${itemId}`, hand);

      const layerZones = await page.evaluate(
        ({ t, i }) => {
          const w = window as unknown as MlWindow;
          const track = w.__ml.projectStore.getState().project.tracks.find((x) => x.id === t);
          return track?.rack?.items.find((x) => x.id === i)?.sampler?.zones.length ?? -1;
        },
        { t: trackId, i: itemId },
      );
      // Before this the answer was 0 and there was no gesture that could change
      // it — the layer was silent for the life of the project.
      expect(layerZones).toBe(1);
    });

    if (form.hand === 'touch') {
      test(`${form.name}: the load control meets the touch minimum where it is drawn`, async ({
        page,
      }) => {
        await boot(page);
        await sampler(page, 'quick');
        await openInstrument(page, hand);
        const button = page.getByTestId('smp-load-quick');
        await expect(button).toBeVisible();
        // Measured by pressing, not by reading the stylesheet. A declared inset
        // is the *intended* rectangle; inside a scroller it and the reachable
        // one are nowhere near each other.
        const box = await reachableBox(button);
        const found = await landing(button);
        expect(
          Math.min(box.width, box.height),
          `the load control reaches ${box.width}x${box.height}; a press at its centre ` +
            `finds ${found.found}. This is the primary route on touch, so WCAG 2.5.8's ` +
            `equivalent-alternative provision does not apply to it.`,
        ).toBeGreaterThanOrEqual(MIN_TOUCH);
      });
    }
  });
}

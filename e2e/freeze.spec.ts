import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Freeze, proven by measurement rather than by argument.
 *
 * A frozen track plays a rendered file instead of running its instrument. The
 * claim that makes freezing usable is that this is inaudible — so the test
 * renders the song, freezes the track, renders it again, and compares the two
 * results sample for sample. jsdom cannot do this: it needs a real
 * OfflineAudioContext, a real encoder and the browser's own decoder, because
 * the print makes the round trip through all three.
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
  // The print is rendered at the live context's rate, so audio has to be up
  // before anything is compared against it.
  await page.evaluate(async () => {
    const w = window as unknown as { __ml: { engine: { start(): Promise<boolean> } } };
    await w.__ml.engine.start();
  });
}

interface Comparison {
  rate: number;
  frames: number;
  /** Peak of the live render, so a silent test cannot pass. */
  livePeak: number;
  printPeak: number;
  /** Largest single-sample difference between the two renders. */
  maxDiff: number;
  rmsDiff: number;
  liveNotes: number;
  printNotes: number;
  liveClips: number;
  printClips: number;
  frozenMediaKind: string | undefined;
  restoredMaxDiff: number;
  restoredNotes: number;
}

async function freezeParity(page: Page): Promise<Comparison> {
  return page.evaluate(async () => {
    const w = window as unknown as {
      __ml: {
        exportMix: typeof import('../src/audio/exportMix');
        demoProject: typeof import('../src/model/demoProject');
        freeze: typeof import('../src/audio/freeze');
        projectStore: {
          getState(): {
            project: import('../src/model/types').ProjectData;
            setProject(p: unknown, o?: unknown): void;
          };
        };
        engine: { context: AudioContext | null };
      };
    };
    const { renderProject, preloadForRender } = w.__ml.exportMix;
    const store = w.__ml.projectStore;
    const ctx = w.__ml.engine.context!;
    const rate = ctx.sampleRate;

    const p = w.__ml.demoProject.createEmptyProject('Freeze parity');
    const track = p.tracks[0];
    track.volume = 0.8;
    p.clips = [
      {
        id: 'c1',
        trackId: track.id,
        type: 'midi',
        name: 'Part',
        start: 0,
        length: 8,
        muted: false,
        notes: [
          { id: 'n1', pitch: 57, start: 0, length: 2, velocity: 110 },
          { id: 'n2', pitch: 64, start: 2, length: 2, velocity: 90 },
          { id: 'n3', pitch: 60, start: 4, length: 3, velocity: 100 },
        ],
      },
    ];
    store.getState().setProject(p, { markClean: true });

    const renderNow = async () => {
      const project = store.getState().project;
      await preloadForRender(project, ctx);
      return renderProject(project, {
        range: { startBeat: 0, endBeat: 8 },
        // The print is made at the device rate; rendering the comparison at
        // the same rate keeps a resampler out of the measurement.
        sampleRate: rate,
        tailSeconds: 1,
      });
    };

    const compare = (a: AudioBuffer, b: AudioBuffer) => {
      const n = Math.min(a.length, b.length);
      let maxDiff = 0;
      let sum = 0;
      for (let c = 0; c < a.numberOfChannels; c++) {
        const A = a.getChannelData(c);
        const B = b.getChannelData(c);
        for (let i = 0; i < n; i++) {
          const d = Math.abs(A[i] - B[i]);
          if (d > maxDiff) maxDiff = d;
          sum += d * d;
        }
      }
      return { maxDiff, rmsDiff: Math.sqrt(sum / (n * a.numberOfChannels)), frames: n };
    };

    const live = await renderNow();
    if (!(await w.__ml.freeze.freezeTrack(track.id))) throw new Error('freeze refused');
    const printed = await renderNow();
    const frozen = compare(live.buffer, printed.buffer);

    const frozenMediaKind = store.getState().project.media?.[0]?.kind;

    w.__ml.freeze.unfreezeTrack(track.id);
    const restored = await renderNow();
    const back = compare(live.buffer, restored.buffer);

    return {
      rate,
      frames: frozen.frames,
      livePeak: live.peak,
      printPeak: printed.peak,
      maxDiff: frozen.maxDiff,
      rmsDiff: frozen.rmsDiff,
      liveNotes: live.scheduledNotes,
      printNotes: printed.scheduledNotes,
      liveClips: live.scheduledClips,
      printClips: printed.scheduledClips,
      frozenMediaKind,
      restoredMaxDiff: back.maxDiff,
      restoredNotes: restored.scheduledNotes,
    };
  });
}

test.describe('a frozen track', () => {
  test('sounds like the instrument it replaces', async ({ page }) => {
    await boot(page);
    const r = await freezeParity(page);

    expect(r.livePeak, 'the reference render is silent — the test proves nothing').toBeGreaterThan(
      0.01,
    );
    expect(r.printPeak).toBeGreaterThan(0.01);
    expect(r.frames).toBeGreaterThan(r.rate); // more than a second of audio compared

    /**
     * Tolerance. The print is stored as a 24-bit WAV and read back through the
     * browser's decoder, so the only difference either render can have is that
     * quantiser: half a step of 2^-23, about 6e-8 of full scale, or -144 dBFS.
     * 1e-5 (-100 dBFS) leaves two orders of magnitude of headroom over that
     * while staying far below anything audible — and it is nowhere near loose
     * enough to hide a real fault: one sample of misalignment, a doubled
     * insert or a pan-law change would each move a peak-0.4 render by
     * thousandths at least.
     */
    expect(r.maxDiff, 'the print diverges from the instrument').toBeLessThan(1e-5);
    expect(r.rmsDiff).toBeLessThan(1e-6);
    console.log(
      `freeze parity: ${r.frames} frames @ ${r.rate} Hz, peak ${r.livePeak.toFixed(3)}, ` +
        `max |Δ| ${r.maxDiff.toExponential(2)}, rms Δ ${r.rmsDiff.toExponential(2)}`,
    );
  });

  test('schedules no notes and builds no instrument', async ({ page }) => {
    await boot(page);
    const r = await freezeParity(page);

    expect(r.liveNotes, 'the live render should schedule the three notes').toBe(3);
    // The point of freezing: the notes are not scheduled and the instrument is
    // never built. What plays is one audio clip — the print.
    expect(r.printNotes).toBe(0);
    expect(r.printClips).toBe(1);
    expect(r.liveClips).toBe(1);
    expect(r.frozenMediaKind).toBe('freeze');
  });

  test('gives the instrument back when it is unfrozen', async ({ page }) => {
    await boot(page);
    const r = await freezeParity(page);

    expect(r.restoredNotes).toBe(3);
    /**
     * Unfreezing is not an approximation of the original — it is the original,
     * played by the instrument again. Not bit-identical, though: rendering the
     * same project twice differs by about one float32 step (3e-8 here), which
     * is the floor any comparison in this file is measured against.
     */
    expect(r.restoredMaxDiff).toBeLessThan(1e-7);
  });
  test('is reachable from the inspector, and shows in the track header', async ({ page }) => {
    await boot(page);
    // The demo project's instrument track, selected the way a user selects it.
    await page.locator('[data-testid="track-header-Keys"] .th-name').click();
    await page.click('[data-testid="freeze-track"]');

    // The print is rendered and stored before the state flips, so the header
    // badge appearing is the whole round trip having worked.
    await expect(page.locator('[data-testid="frozen-Keys"]')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-testid="freeze-state"]')).toHaveText('Frozen');

    await page.click('[data-testid="unfreeze-track"]');
    await expect(page.locator('[data-testid="frozen-Keys"]')).toHaveCount(0);
  });
});

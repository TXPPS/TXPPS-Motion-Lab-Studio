import { test, expect, type Page } from '@playwright/test';

/**
 * Milestone 7 — sampler, drum rack, multisample and instrument rack, driven
 * through the UI. Audio claims are proved with the engine's read-only probes
 * (meters, source counts) and offline renders, not assumed from the DOM.
 *
 * Timing budgets are calibrated for this CI's software rasterizer, not a
 * statement about real hardware.
 */

interface MlWindow {
  __ml: {
    projectStore: {
      getState(): {
        project: {
          clips: { id: string; trackId: string; type: string; name: string; notes?: unknown[] }[];
          tracks: {
            id: string;
            name: string;
            sampler?: {
              view: string;
              zones: {
                id: string;
                name: string;
                mediaId: string;
                keyLo: number;
                keyHi: number;
                muted?: boolean;
                startSec: number;
                slices?: number[];
              }[];
            };
            rack?: { items: { id: string; name: string }[] };
            synth?: unknown;
          }[];
        };
      };
    };
    uiStore: { getState(): { selectTrack(id: string | null): void } };
    engine: { start(): Promise<boolean> };
    exportMix: typeof import('../src/audio/exportMix');
    activeSources: () => number;
    isRunning: () => boolean;
    getMeter: (id: string) => { peak: number; rms: number } | null;
    automationValueAt: (
      trackId: string,
      paramId: string,
    ) => { norm: number; value: number } | null;
  };
}

async function boot(page: Page, hash: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(hash);
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
  await page.waitForTimeout(1000);
}

const trackByName = (page: Page, name: string) =>
  page.evaluate((n) => {
    const w = window as unknown as MlWindow;
    return w.__ml.projectStore.getState().project.tracks.find((t) => t.name === n) ?? null;
  }, name);

async function openSamplerFor(page: Page, trackName: string) {
  await page.click('[data-testid="editor-tab-synth"]');
  await page.evaluate((n) => {
    const w = window as unknown as MlWindow;
    const t = w.__ml.projectStore.getState().project.tracks.find((x) => x.name === n);
    if (t) w.__ml.uiStore.getState().selectTrack(t.id);
  }, trackName);
  await page.waitForSelector('[data-testid="sampler-panel"]', { timeout: 10000 });
}

test.describe('quick sampler', () => {
  test('renders the sliced loop and trims with zero-crossing assist', async ({ page }) => {
    await boot(page, '/#/qa-sampler');
    await openSamplerFor(page, 'Quick Slice');

    await expect(page.locator('[data-testid="smp-wave"]')).toBeVisible();
    await expect(page.locator('[data-testid="instrument-kind"]')).toHaveValue('quick');
    await expect(page.locator('.smp-slice')).toHaveCount(8);

    // Drag the start trim handle right; the zone start must move off zero.
    // Audio must run first so the decoded buffer exists for snapping.
    await page.evaluate(async () => {
      const w = window as unknown as MlWindow;
      await w.__ml.engine.start();
    });
    const handle = page.locator('[data-testid="smp-trim-start"]');
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const t = await trackByName(page, 'Quick Slice');
    expect(t!.sampler!.zones[0].startSec).toBeGreaterThan(0.05);
  });

  test('slices convert to a MIDI clip and to drum pads', async ({ page }) => {
    await boot(page, '/#/qa-sampler');
    await openSamplerFor(page, 'Quick Slice');

    const clipsBefore = await page.evaluate(
      () =>
        (window as unknown as MlWindow).__ml.projectStore.getState().project.clips.length,
    );
    await page.getByRole('button', { name: 'Slices → MIDI' }).click();
    await page.waitForTimeout(200);
    const clips = await page.evaluate(() =>
      (window as unknown as MlWindow).__ml.projectStore
        .getState()
        .project.clips.map((c) => ({ type: c.type, notes: c.notes?.length ?? 0 })),
    );
    expect(clips.length).toBe(clipsBefore + 1);
    expect(clips[clips.length - 1]).toEqual({ type: 'midi', notes: 8 });

    await page.click('[data-testid="smp-to-pads"]');
    await page.waitForSelector('[data-testid="pad-grid"]', { timeout: 5000 });
    const t = await trackByName(page, 'Quick Slice');
    expect(t!.sampler!.view).toBe('drum');
    expect(t!.sampler!.zones.length).toBe(8);
    for (const z of t!.sampler!.zones) expect(z.keyLo).toBe(z.keyHi);
  });
});

test.describe('drum rack', () => {
  test('pads select, preview and edit; mute reaches the zone model', async ({ page }) => {
    await boot(page, '/#/qa-sampler');
    await openSamplerFor(page, 'Drum Rack');

    await expect(page.locator('[data-testid="pad-grid"]')).toBeVisible();
    await expect(page.locator('[data-testid="pad-0"]')).toContainText('Kick');

    await page.click('[data-testid="pad-0"]');
    await expect(page.locator('[data-testid="pad-detail"]')).toBeVisible();
    // Clicking a pad previews it — the audio engine must actually start.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as MlWindow).__ml.isRunning()))
      .toBe(true);

    await page.locator('[data-testid="pad-detail"] button', { hasText: 'M' }).first().click();
    const t = await trackByName(page, 'Drum Rack');
    const kick = t!.sampler!.zones.find((z) => z.name === 'Kick')!;
    expect(kick.muted).toBe(true);
  });

  test('a sample dropped on a pad assigns that pad', async ({ page }) => {
    await boot(page, '/#/qa-sampler');
    await openSamplerFor(page, 'Drum Rack');

    // Native HTML5 drop with the internal media mime, straight onto pad 10.
    await page.evaluate(() => {
      const pad = document.querySelector('[data-testid="pad-10"]')!;
      const dt = new DataTransfer();
      dt.setData('text/x-ml-media', 'hit-clap');
      pad.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
      pad.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    });
    await page.waitForTimeout(200);

    const t = await trackByName(page, 'Drum Rack');
    const pad10 = t!.sampler!.zones.find((z) => z.keyLo === z.keyHi && z.mediaId === 'hit-clap');
    expect(pad10).toBeTruthy();
    await expect(page.locator('[data-testid="pad-10"]')).toContainText('clap');
  });
});

test.describe('instrument kinds and racks', () => {
  test('a synth track switches to a drum rack and back', async ({ page }) => {
    await boot(page, '/');
    await page.click('[data-testid="editor-tab-synth"]');
    await page.waitForSelector('[data-testid="synth-panel"]', { timeout: 10000 });

    await page.locator('[data-testid="instrument-kind"]').selectOption('drum');
    await page.waitForSelector('[data-testid="pad-grid"]', { timeout: 5000 });
    await page.click('[data-testid="load-kit"]');
    await expect(page.locator('[data-testid="pad-0"]')).toContainText('Kick');

    await page.locator('[data-testid="instrument-kind"]').selectOption('synth');
    await page.waitForSelector('[data-testid="synth-panel"]', { timeout: 5000 });
  });

  test('rack layers list, add and reorder', async ({ page }) => {
    await boot(page, '/#/qa-sampler');
    await openSamplerFor(page, 'Layer Rack');

    await expect(page.locator('[data-testid="rack-item"]')).toHaveCount(2);
    await page.click('[data-testid="rack-add-synth"]');
    await expect(page.locator('[data-testid="rack-item"]')).toHaveCount(3);

    const t = await trackByName(page, 'Layer Rack');
    expect(t!.rack!.items.length).toBe(3);
    // The rack panel keeps the keyboard so layers can be played immediately.
    await expect(page.locator('[data-testid="keyboard"]')).toBeVisible();
  });
});

test.describe('browser samples tab', () => {
  test('search, favorites and tap-to-load reach the sampler', async ({ page }) => {
    await boot(page, '/#/qa-sampler');
    await openSamplerFor(page, 'Drum Rack');
    await page.click('[data-testid="browser-tab-samples"]');

    await expect(page.locator('[data-testid="sample-item-hit-kick"]')).toBeVisible();
    await page.fill('[data-testid="browser-search"]', 'texture');
    await expect(page.locator('[data-testid="sample-item-hit-kick"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="sample-item-texture-110-4bar"]')).toBeVisible();
    await page.fill('[data-testid="browser-search"]', '');

    await page.click('[data-testid="fav-hit-kick"]');
    await expect(page.locator('[data-testid="sample-cat-favorites"]')).toContainText('★ 1');
    await page.click('[data-testid="sample-cat-favorites"]');
    await expect(page.locator('[data-testid="sample-item-hit-kick"]')).toBeVisible();
    await expect(page.locator('[data-testid="sample-item-hit-snare"]')).toHaveCount(0);
    await page.click('[data-testid="sample-cat-all"]');

    // Tapping a row loads it into the selected drum rack's first free pad (8).
    await page.click('[data-testid="sample-item-hit-clap"]');
    await page.waitForTimeout(200);
    const t = await trackByName(page, 'Drum Rack');
    const assigned = t!.sampler!.zones.filter((z) => z.mediaId === 'hit-clap');
    expect(assigned.length).toBeGreaterThanOrEqual(2); // the kit's clap + the new pad
  });
});

test.describe('automation and audio proof', () => {
  test('smp:filterCutoff automation binds on the quick sampler track', async ({ page }) => {
    await boot(page, '/#/qa-sampler');
    // The automation index is built when the engine syncs the graph, which
    // needs a running AudioContext.
    await page.evaluate(async () => {
      const w = window as unknown as MlWindow;
      await w.__ml.engine.start();
    });
    await page.waitForTimeout(300);
    const t = await trackByName(page, 'Quick Slice');
    const v = await page.evaluate(
      (id) => (window as unknown as MlWindow).__ml.automationValueAt(id, 'smp:filterCutoff'),
      t!.id,
    );
    expect(v).not.toBeNull();
    // The fixture's lane starts at norm 0.25 → below-nominal cutoff in Hz.
    expect(v!.norm).toBeGreaterThan(0.1);
    expect(v!.norm).toBeLessThan(0.5);
    expect(v!.value).toBeGreaterThan(40);
    expect(v!.value).toBeLessThan(12000);
  });

  test('the sampler-only project renders a non-silent WAV offline', async ({ page }) => {
    await boot(page, '/#/qa-sampler');
    await page.evaluate(async () => {
      const w = window as unknown as MlWindow;
      await w.__ml.engine.start();
    });
    // Every track in this fixture is a sampler or rack — a renderer that
    // skipped samplers would produce silence here.
    const r = await page.evaluate(async () => {
      const w = window as unknown as MlWindow;
      const { renderProject, preloadForRender, audioBufferToWav, validateWav } = w.__ml.exportMix;
      const project = w.__ml.projectStore.getState().project as Parameters<
        typeof renderProject
      >[0];
      const ctx = (w.__ml.engine as unknown as { context: BaseAudioContext }).context;
      await preloadForRender(project, ctx);
      const res = await renderProject(project, {
        range: { startBeat: 0, endBeat: 8 },
        sampleRate: 44100,
        tailSeconds: 0.5,
      });
      const wav = audioBufferToWav(res.buffer);
      const info = await validateWav(wav, ctx);
      return {
        peak: res.peak,
        scheduledNotes: res.scheduledNotes,
        missing: res.missingMedia,
        wavValid: info.valid,
        wavPeak: info.peak,
      };
    });
    expect(r.wavValid).toBe(true);
    expect(r.peak, 'sampler render is silent').toBeGreaterThan(0.001);
    expect(r.wavPeak).toBeGreaterThan(0.001);
    expect(r.scheduledNotes).toBeGreaterThan(10);
    expect(r.missing).toEqual([]);
  });

  test('live playback produces signal and voices clean up after stop', async ({ page }) => {
    await boot(page, '/#/qa-drums');
    await page.click('[data-testid="btn-play"]');
    await page.waitForTimeout(2500);

    const during = await page.evaluate(() => {
      const w = window as unknown as MlWindow;
      const t = w.__ml.projectStore.getState().project.tracks[0];
      return { sources: w.__ml.activeSources(), meter: w.__ml.getMeter(t.id) };
    });
    expect(during.sources).toBeGreaterThan(0);
    expect(during.meter?.peak ?? 0).toBeGreaterThan(0.001);

    await page.click('[data-testid="btn-stop"]');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as MlWindow).__ml.activeSources()), {
        timeout: 5000,
      })
      .toBeLessThanOrEqual(2);
  });
});

test.describe('scale', () => {
  test('100 assigned pads render and stay interactive', async ({ page }) => {
    await boot(page, '/#/qa-drums');
    const t0 = Date.now();
    await page.click('[data-testid="editor-tab-synth"]');
    await page.waitForSelector('[data-testid="pad-grid"]', { timeout: 15000 });
    const openMs = Date.now() - t0;

    const pads = await page.locator('[data-testid="pad-grid"] .pad:not(.empty)').count();
    expect(pads).toBe(100);
    // Calibrated for this CI's software rasterizer.
    expect(openMs).toBeLessThan(8000);

    await page.click('[data-testid="pad-42"]');
    await expect(page.locator('[data-testid="pad-detail"]')).toBeVisible();
  });

  test('512 zones render and one edit re-renders without stalling', async ({ page }) => {
    await boot(page, '/#/qa-multisample');
    const t0 = Date.now();
    await page.click('[data-testid="editor-tab-synth"]');
    await page.waitForSelector('[data-testid="smp-multi"]', { timeout: 20000 });
    const openMs = Date.now() - t0;
    await expect(page.locator('[data-testid="zone-row"]')).toHaveCount(512);
    // Calibrated for this CI's software rasterizer.
    expect(openMs).toBeLessThan(10000);

    // Edit one zone's key-low; the memoized rows keep this cheap.
    const first = page.locator('[data-testid="zone-row"]').first().locator('input').first();
    const e0 = Date.now();
    await first.fill('3');
    await page.waitForTimeout(100);
    const editMs = Date.now() - e0;
    const t = await trackByName(page, 'Mega Multi (512 zones)');
    expect(t!.sampler!.zones[0].keyLo).toBe(3);
    expect(editMs).toBeLessThan(4000);
  });
});

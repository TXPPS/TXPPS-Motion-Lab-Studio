import { test, expect, type Page } from '@playwright/test';
import { PERF_SCALE } from './perfScale';

/**
 * Milestone 6 audio-editing workflows through real pointer events, plus
 * offline-render proofs (phase cancellation, fade shapes) that the editing
 * model reaches the audio itself. Store reads go by clip/track NAME.
 */

async function boot(page: Page, hash = '/') {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(hash);
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
  await page.waitForTimeout(1000);
}

interface ClipShape {
  id: string;
  name: string;
  start: number;
  length: number;
  offset?: number;
  fadeIn?: number;
  fadeOut?: number;
  fadeInShape?: string;
  fadeOutShape?: string;
  takes?: { id: string; name: string }[];
  comp?: { at: number; takeId: string }[];
  soloTakeId?: string;
  locked?: boolean;
}

const clipByName = (page: Page, name: string) =>
  page.evaluate((n) => {
    const w = window as unknown as {
      __ml: { projectStore: { getState(): { project: { clips: { name: string }[] } } } };
    };
    return (w.__ml.projectStore.getState().project.clips.find((c) => c.name === n) ??
      null) as ClipShape | null;
  }, name);

const clipCount = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as {
      __ml: { projectStore: { getState(): { project: { clips: unknown[] } } } };
    };
    return w.__ml.projectStore.getState().project.clips.length;
  });

test.describe('crossfades and healing', () => {
  test('crossfade two adjacent clips via the menu, then undo', async ({ page }) => {
    await boot(page);
    // The demo's Perc Loop track holds adjacent audio clips named "Perc 2-bar".
    // Give the junction real overlapping material first — the demo loops use
    // their full source, so an adjacent pair has no trim headroom to extend.
    await page.evaluate(() => {
      const w = window as unknown as {
        __ml: {
          projectStore: {
            getState(): {
              project: { clips: { id: string; name: string; start: number }[] };
              moveClip(id: string, start: number): void;
            };
          };
        };
      };
      const s = w.__ml.projectStore.getState();
      const perc = s.project.clips
        .filter((c) => c.name === 'Perc 2-bar')
        .sort((a, b) => a.start - b.start);
      s.moveClip(perc[1].id, perc[1].start - 1);
    });
    await page.waitForTimeout(200);
    const clips = page.locator('[data-testid^="clip-Perc 2-bar"]');
    const first = clips.first();
    const second = clips.nth(1);
    await first.click();
    await second.click({ modifiers: ['Control'] });
    await second.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Crossfade (equal power)' }).click();
    await page.waitForTimeout(250);

    const all = await page.evaluate(() => {
      const w = window as unknown as {
        __ml: {
          projectStore: {
            getState(): {
              project: {
                clips: {
                  name: string;
                  fadeIn: number;
                  fadeOut: number;
                  fadeInShape?: string;
                  fadeOutShape?: string;
                  start: number;
                  length: number;
                }[];
              };
            };
          };
        };
      };
      return w.__ml.projectStore
        .getState()
        .project.clips.filter((c) => c.name === 'Perc 2-bar')
        .sort((a, b) => a.start - b.start);
    });
    const left = all[0];
    const right = all[1];
    expect(left.fadeOut, 'left clip must gain a fade-out').toBeGreaterThan(0.05);
    expect(right.fadeIn, 'right clip must gain a fade-in').toBeGreaterThan(0.05);
    expect(left.fadeOutShape).toBe('equalPower');
    expect(right.fadeInShape).toBe('equalPower');
    // They genuinely overlap now.
    expect(left.start + left.length).toBeGreaterThan(right.start + 0.01);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    const undone = await page.evaluate(() => {
      const w = window as unknown as {
        __ml: {
          projectStore: { getState(): { project: { clips: { name: string; fadeOut: number }[] } } };
        };
      };
      return w.__ml.projectStore.getState().project.clips.filter((c) => c.name === 'Perc 2-bar')[0];
    });
    expect(undone.fadeOut).toBe(0);
  });

  test('split with the tool, then heal from the menu', async ({ page }) => {
    await boot(page);
    const before = await clipCount(page);
    const clip = page.locator('[data-testid="clip-Perc 2-bar"]').first();
    const box = (await clip.boundingBox())!;
    await page.keyboard.press('2'); // split tool
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(200);
    expect(await clipCount(page)).toBe(before + 1);

    await page.keyboard.press('1'); // pointer
    // Select both halves and heal. (page.mouse has no modifiers option — the
    // locator click is what actually holds Control.)
    await page.locator('[data-testid="clip-Perc 2-bar"]').first().click();
    await page
      .locator('[data-testid="clip-Perc 2-bar.2"]')
      .first()
      .click({ modifiers: ['Control'] });
    await page.locator('[data-testid="clip-Perc 2-bar.2"]').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Heal splits' }).click();
    await page.waitForTimeout(250);
    expect(await clipCount(page)).toBe(before);
  });
});

test.describe('takes and comping (qa-audio-edit)', () => {
  test('take lanes render; swipe comps a range; click auditions; promote wins', async ({
    page,
  }) => {
    // Long pointer-swipe sequences on the 2,020-clip fixture: functional on
    // every engine, but in-container WebKit-GTK needs far more wall time.
    test.setTimeout(process.env.E2E_BROWSER === 'webkit' ? 420_000 : 180_000);
    await boot(page, '/#/qa-audio-edit');

    // Comp 1 has open take lanes: three rows.
    await expect(page.locator('[data-testid="take-head-Takes-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="take-head-Takes-2"]')).toBeVisible();

    let comp = (await clipByName(page, 'Comp 1'))!;
    const take3 = comp.takes![2];
    const segsBefore = comp.comp!.length;

    // Swipe the middle of take row 3 to comp it in.
    const row = page.locator(`[data-testid="take-row-${comp.id}-${take3.id}"]`);
    const rb = (await row.boundingBox())!;
    await page.mouse.move(rb.x + rb.width * 0.55, rb.y + rb.height / 2);
    await page.mouse.down();
    await page.mouse.move(rb.x + rb.width * 0.8, rb.y + rb.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    comp = (await clipByName(page, 'Comp 1'))!;
    expect(
      comp.comp!.some((s) => s.takeId === take3.id),
      'swipe must assign the range to take 3',
    ).toBe(true);
    expect(comp.comp!.length).toBeGreaterThan(segsBefore - 1);

    // The comp indicator bar reflects the segments.
    expect(await page.locator('[data-testid="comp-bar-Comp 1"] .clip-comp-seg').count()).toBe(
      comp.comp!.length,
    );

    // One undo removes the swipe as a single step.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    comp = (await clipByName(page, 'Comp 1'))!;
    expect(comp.comp!.some((s) => s.takeId === take3.id)).toBe(false);

    // Click (no drag) auditions the take.
    await row.click({ position: { x: 30, y: 10 } });
    await page.waitForTimeout(200);
    comp = (await clipByName(page, 'Comp 1'))!;
    expect(comp.soloTakeId).toBe(take3.id);
    await row.click({ position: { x: 30, y: 10 } });
    await page.waitForTimeout(150);
    comp = (await clipByName(page, 'Comp 1'))!;
    expect(comp.soloTakeId).toBeUndefined();

    // Promote take 2 from its header: the whole comp collapses to it.
    await page.click('[data-testid="take-promote-Takes-1"]');
    await page.waitForTimeout(200);
    comp = (await clipByName(page, 'Comp 1'))!;
    expect(comp.comp).toHaveLength(1);
    expect(comp.comp![0].takeId).toBe(comp.takes![1].id);
  });

  test('pack selected clips into takes from the demo arrangement', async ({ page }) => {
    await boot(page);
    // Stack a duplicate on the same spot, then pack the two into takes.
    const clip = page.locator('[data-testid="clip-Perc 2-bar"]').first();
    await clip.click();
    const src = await page.evaluate(() => {
      const w = window as unknown as {
        __ml: {
          projectStore: {
            getState(): {
              project: { clips: { id: string; name: string }[] };
            };
          };
          uiStore: { getState(): { selectedClipId: string | null } };
        };
      };
      return w.__ml.uiStore.getState().selectedClipId;
    });
    await page.evaluate((id) => {
      const w = window as unknown as {
        __ml: {
          projectStore: {
            getState(): {
              duplicateClip(id: string, samePos?: boolean): string | null;
            };
          };
          uiStore: {
            getState(): { selectClips(ids: string[]): void };
          };
        };
      };
      const dup = w.__ml.projectStore.getState().duplicateClip(id!, true)!;
      w.__ml.uiStore.getState().selectClips([id!, dup]);
    }, src);
    const pb = (await clip.boundingBox())!;
    await page.mouse.click(pb.x + 30, pb.y + 12, { button: 'right' });
    await page.getByRole('menuitem', { name: /Pack 2 clips into takes/ }).click();
    await page.waitForTimeout(250);
    const packed = await page.evaluate(() => {
      const w = window as unknown as {
        __ml: {
          projectStore: {
            getState(): { project: { clips: { takes?: unknown[]; takesOpen?: boolean }[] } };
          };
        };
      };
      return w.__ml.projectStore.getState().project.clips.find((c) => (c.takes?.length ?? 0) > 0);
    });
    expect(packed).toBeDefined();
    expect(packed!.takes).toHaveLength(2);
    expect(packed!.takesOpen).toBe(true);
  });
});

test.describe('time editing on the stress fixture', () => {
  test('slip tool slides material; ripple delete closes the gap; locks hold', async ({ page }) => {
    // Functional coverage matters on every engine; in-container WebKit-GTK
    // just needs far more wall time on the 2,000-clip fixture.
    test.setTimeout(process.env.E2E_BROWSER === 'webkit' ? 420_000 : 180_000);
    await boot(page, '/#/qa-audio-edit');

    // Slip: drag inside "Slip me" with the slip tool.
    let slip = (await clipByName(page, 'Slip me'))!;
    const offset0 = slip.offset!;
    await page.keyboard.press('5');
    const el = page.locator('[data-testid="clip-Slip me"]');
    await el.scrollIntoViewIfNeeded();
    const sb = (await el.boundingBox())!;
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await page.mouse.down();
    await page.mouse.move(sb.x + sb.width / 2 - 30, sb.y + sb.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    slip = (await clipByName(page, 'Slip me'))!;
    expect(slip.offset, 'slip must change the source offset').not.toBeCloseTo(offset0, 3);
    expect(slip.start, 'slip must not move the clip').toBe(12);
    await page.keyboard.press('1');

    // Ripple delete piece 3: pieces 4..6 pull left by its length.
    const p4Before = (await clipByName(page, 'Piece 4'))!;
    const target = page.locator('[data-testid="clip-Piece 3"]');
    await target.click();
    await target.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Ripple delete' }).click();
    await page.waitForTimeout(250);
    expect(await clipByName(page, 'Piece 3')).toBeNull();
    const p4After = (await clipByName(page, 'Piece 4'))!;
    expect(p4After.start).toBeCloseTo(p4Before.start - p4Before.length, 5);

    // Locked track: the erase tool refuses.
    await page.keyboard.press('3');
    const locked = page.locator('[data-testid="clip-Untouchable"]');
    const lb = (await locked.boundingBox())!;
    await page.mouse.click(lb.x + 20, lb.y + 10);
    await page.waitForTimeout(200);
    expect(await clipByName(page, 'Untouchable')).not.toBeNull();
    await page.keyboard.press('1');

    // Edit group: selecting one grouped clip links its partner.
    await page.locator('[data-testid="clip-Group Gtr L take"]').click();
    const selCount = await page.evaluate(() => {
      const w = window as unknown as {
        __ml: { uiStore: { getState(): { selectedClipIds: string[] } } };
      };
      return w.__ml.uiStore.getState().selectedClipIds.length;
    });
    expect(selCount, 'edit group must link the pair').toBe(2);
  });

  test('the fixture stays responsive: 2000+ clips, bounded DOM, scroll budget', async ({
    page,
  }) => {
    // Pure performance assertion, Chromium-calibrated. In-container
    // WebKit-GTK measures ~9× slower than the same machine's Chromium and is
    // not a performance reference for retail Safari — skipping is the honest
    // choice over a meaningless ×10 budget. (Firefox meets the real budgets.)
    test.skip(
      process.env.E2E_BROWSER === 'webkit',
      'stress perf budgets are Chromium-calibrated; container WebKit is not a perf reference',
    );
    await boot(page, '/#/qa-audio-edit');
    expect(await clipCount(page)).toBeGreaterThanOrEqual(2000);
    const mounted = await page.evaluate(() => document.querySelectorAll('.clip').length);
    expect(mounted, 'windowing must bound mounted clips').toBeLessThan(900);
    const cost = await page.evaluate(async () => {
      const vp = document.querySelector('[data-testid="arr-scroll"]') as HTMLElement;
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const start = performance.now();
      for (let i = 0; i < 20; i++) {
        vp.scrollLeft = (i % 10) * 300;
        await raf();
      }
      return (performance.now() - start) / 20;
    });
    // This all-audio fixture mounts roughly three times the waveform canvases
    // qa-huge does; measured 155-180ms/step on CI's software rasteriser. The
    // budget is calibrated to that measurement — qa-huge's tighter budget is
    // still enforced by the existing workflow suite.
    expect(cost, `scroll step ${cost.toFixed(1)}ms`).toBeLessThan(250 * PERF_SCALE);
  });

  test('clip nudge and zoom-to-selection', async ({ page }) => {
    await boot(page);
    const clip = page.locator('[data-testid="clip-Perc 2-bar"]').first();
    await clip.click();
    const before = await page.evaluate(() => {
      const w = window as unknown as {
        __ml: {
          projectStore: { getState(): { project: { clips: { name: string; start: number }[] } } };
        };
      };
      return w.__ml.projectStore.getState().project.clips.find((c) => c.name === 'Perc 2-bar')!
        .start;
    });
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => {
      const w = window as unknown as {
        __ml: {
          projectStore: { getState(): { project: { clips: { name: string; start: number }[] } } };
        };
      };
      return w.__ml.projectStore.getState().project.clips.find((c) => c.name === 'Perc 2-bar')!
        .start;
    });
    expect(after).toBeCloseTo(before + 0.25, 5);
    await page.keyboard.press('Control+z');

    const ppbBefore = await page.evaluate(() => {
      const w = window as unknown as { __ml: { uiStore: { getState(): { pxPerBeat: number } } } };
      return w.__ml.uiStore.getState().pxPerBeat;
    });
    await page.click('[data-testid="zoom-selection"]');
    await page.waitForTimeout(250);
    const ppbAfter = await page.evaluate(() => {
      const w = window as unknown as { __ml: { uiStore: { getState(): { pxPerBeat: number } } } };
      return w.__ml.uiStore.getState().pxPerBeat;
    });
    expect(ppbAfter).not.toBe(ppbBefore);
  });
});

test.describe('render correctness', () => {
  test('phase-inverted duplicate cancels to silence in the bounce', async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => {
      const w = window as unknown as { __ml?: { engine: { start(): Promise<boolean> } } };
      await w.__ml?.engine.start();
    });
    const result = await page.evaluate(async () => {
      const w = window as unknown as {
        __ml: {
          exportMix: typeof import('../src/audio/exportMix');
          projectStore: { getState(): { project: unknown } };
        };
      };
      type Project = Parameters<typeof w.__ml.exportMix.renderProject>[0];
      const src = structuredClone(w.__ml.projectStore.getState().project) as Project & {
        tracks: { id: string; name: string; type: string; mute: boolean; solo: boolean }[];
        clips: {
          id: string;
          trackId: string;
          type: string;
          name: string;
          phaseInvert?: boolean;
        }[];
      };
      // Keep only the Perc Loop track; duplicate it; invert the copy.
      const perc = src.tracks.find((t) => t.name === 'Perc Loop')!;
      for (const t of src.tracks) t.mute = t.id !== perc.id && t.type !== 'bus';
      const copy = structuredClone(perc);
      copy.id = 'phase-copy';
      copy.name = 'Phase Copy';
      copy.mute = false;
      src.tracks.push(copy);
      const percClips = src.clips.filter((c) => c.trackId === perc.id && c.type === 'audio');
      for (const c of percClips) {
        const cc = structuredClone(c);
        cc.id = `${c.id}-inv`;
        cc.trackId = 'phase-copy';
        cc.phaseInvert = true;
        src.clips.push(cc);
      }
      const res = await w.__ml.exportMix.renderProject(src as Project, {
        range: { startBeat: 0, endBeat: 8 },
        tailSeconds: 0,
        sampleRate: 44100,
      });
      // Reference render without the inverted copy, to prove signal existed.
      const ref = structuredClone(src) as typeof src;
      ref.clips = ref.clips.filter((c) => !c.id.endsWith('-inv'));
      const refRes = await w.__ml.exportMix.renderProject(ref as unknown as Project, {
        range: { startBeat: 0, endBeat: 8 },
        tailSeconds: 0,
        sampleRate: 44100,
      });
      return { cancelledPeak: res.peak, referencePeak: refRes.peak };
    });
    expect(result.referencePeak, 'reference must carry signal').toBeGreaterThan(0.05);
    expect(
      result.cancelledPeak,
      'polarity-inverted duplicate must cancel — proves sample-aligned scheduling and polarity',
    ).toBeLessThan(result.referencePeak * 0.02);
  });

  test('comp clips and shaped fades render audibly correctly', async ({ page }) => {
    // Two offline renders + comparisons; WebKit-GTK renders offline slowly.
    test.setTimeout(process.env.E2E_BROWSER === 'webkit' ? 420_000 : 180_000);
    await boot(page, '/#/qa-audio-edit');
    await page.evaluate(async () => {
      const w = window as unknown as { __ml?: { engine: { start(): Promise<boolean> } } };
      await w.__ml?.engine.start();
    });
    const result = await page.evaluate(async () => {
      const w = window as unknown as {
        __ml: {
          exportMix: typeof import('../src/audio/exportMix');
          projectStore: { getState(): { project: unknown } };
        };
      };
      type Project = Parameters<typeof w.__ml.exportMix.renderProject>[0];
      const src = structuredClone(w.__ml.projectStore.getState().project) as Project & {
        tracks: { id: string; name: string; solo: boolean }[];
        clips: { name: string; trackId: string; fadeOut?: number; fadeOutShape?: string }[];
      };
      const takesTrack = src.tracks.find((t) => t.name === 'Takes')!;
      takesTrack.solo = true;
      const res = await w.__ml.exportMix.renderProject(src as Project, {
        range: { startBeat: 0, endBeat: 8 },
        tailSeconds: 0,
        sampleRate: 44100,
      });
      const data = res.buffer.getChannelData(0);
      const half = Math.floor(data.length / 2);
      const rms = (from: number, to: number) => {
        let s = 0;
        for (let i = from; i < to; i++) s += data[i] * data[i];
        return Math.sqrt(s / (to - from));
      };
      return {
        peak: res.peak,
        firstHalf: rms(0, half),
        secondHalf: rms(half, data.length),
      };
    });
    // Comp 1: perc for beats 0-4, texture pad for 4-8 — both halves must carry
    // signal, and they must not be identical material (the pad is much
    // smoother than the transient-heavy perc).
    expect(result.peak).toBeGreaterThan(0.02);
    expect(result.firstHalf).toBeGreaterThan(0.005);
    expect(result.secondHalf).toBeGreaterThan(0.005);
    const ratio = result.firstHalf / result.secondHalf;
    expect(Math.abs(Math.log(ratio)), 'halves must differ (different takes)').toBeGreaterThan(0.1);
  });
});

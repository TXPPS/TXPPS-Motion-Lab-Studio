/**
 * A bypassed insert renders exactly what no insert renders.
 *
 * Directive 11 §1. Found by the soak's property layer as one number —
 * 1.6478e-2 RMS across a render — which is the shape of finding that cannot be
 * acted on: an RMS over a whole render collapses a startup transient, a filter
 * difference and a level change into the same figure. Two hypotheses were tried
 * against it and both were reverted for moving it by nothing.
 *
 * Localising it settled it in one run (`scripts/bypass-probe.mjs`). The
 * difference was spread perfectly evenly — the same ratio in every window of
 * the render that had signal in it — equal on both channels, and exactly
 * ×1.414214. That is √2, and √2 is the step between the two pan laws a
 * `StereoPannerNode` chooses between: the mono one, which scales a single
 * channel by cos/sin, and the stereo one, which passes two channels through
 * untouched at centre.
 *
 * So the insert was changing the *channel count* of the track. Fifteen of the
 * thirty-four contain a node that emits two channels whatever arrives — a
 * `StereoPannerNode`, a `ChannelMergerNode`, a `makeStereoTap`, or the
 * `AudioWorkletNode` the Motion Wave units run in, declared `outputChannelCount:
 * [2]`. A leg at gain zero still contributes its channel count to the node it
 * sums into. A mono track with a bypassed reverb arrived at its panner as
 * stereo, took the stereo pan law, and came out 3 dB louder at centre and 6 dB
 * louder panned hard over.
 *
 * The fix routes a bypassed insert *around* itself rather than trusting it to be
 * transparent (`InsertChain`'s `BypassSlot`). This spec is what says so, and the
 * second test is what stops the fix from being the wrong one: an *active*
 * stereo insert must still widen a mono track, because that is what a stereo
 * insert is for.
 */
import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

const preinstalledChromium = '/opt/pw-browsers/chromium';
test.use({
  ...(existsSync(preinstalledChromium)
    ? { launchOptions: { executablePath: preinstalledChromium } }
    : {}),
});

interface MlWindow {
  __ml: {
    exportMix: typeof import('../src/audio/exportMix');
    effectKinds: string[];
    engine: { context: BaseAudioContext | null };
    projectStore: {
      getState(): Record<string, (...args: never[]) => unknown> & {
        project: { tracks: { id: string; type: string; effects?: { id: string }[] }[] };
      };
    };
  };
}

async function boot(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 25000 });
  await page.waitForFunction(
    () => Boolean((window as unknown as { __ml?: { effectKinds?: unknown } }).__ml?.effectKinds),
    null,
    { timeout: 25000 },
  );
}

/**
 * Render the instrument track alone, optionally with one insert on it.
 *
 * Alone, because a ratio measured across a mix is diluted by every track that
 * did not change — the first measurement of this read 1.0331 for what is
 * actually √2, and no clean hypothesis has 1.0331 in it.
 */
interface Rendered {
  L: number[];
  rmsL: number;
  rmsR: number;
  /** RMS of L - R: zero for a mono source, non-zero once something widens it. */
  side: number;
}

async function renderOne(page: Page, kind: string | null, bypass: boolean): Promise<Rendered> {
  return page.evaluate(
    async (arg: { kind: string | null; bypass: boolean }) => {
      const w = window as unknown as MlWindow & { __bypassBase: unknown };
      const { renderProject, preloadForRender } = w.__ml.exportMix;
      const st = () => w.__ml.projectStore.getState();
      (st().setProject as unknown as (p: unknown) => void)(structuredClone(w.__bypassBase));
      const track = st().project.tracks.find((t) => t.type === 'instrument')!;
      for (const t of st().project.tracks.slice()) {
        if (t.id !== track.id) (st().deleteTrack as unknown as (id: string) => void)(t.id);
      }
      if (arg.kind) {
        (st().addEffect as unknown as (t: string, k: string) => void)(track.id, arg.kind);
        const fx = st()
          .project.tracks.find((x) => x.id === track.id)!
          .effects!.at(-1)!;
        if (arg.bypass) {
          (st().setEffectBypass as unknown as (t: string, f: string, b: boolean) => void)(
            track.id,
            fx.id,
            true,
          );
        }
      }
      const project = st().project as unknown as Parameters<typeof renderProject>[0];
      await preloadForRender(
        project,
        w.__ml.engine.context ?? new OfflineAudioContext(1, 1, 44100),
      );
      const res = await renderProject(project, {
        range: { startBeat: 0, endBeat: 4 },
        sampleRate: 44100,
        tailSeconds: 0,
      });
      const L = res.buffer.getChannelData(0);
      const R = res.buffer.numberOfChannels > 1 ? res.buffer.getChannelData(1) : L;
      const rms = (a: Float32Array) => {
        let s = 0;
        for (let i = 0; i < a.length; i++) s += a[i] * a[i];
        return Math.sqrt(s / a.length);
      };
      let sideSum = 0;
      for (let i = 0; i < L.length; i++) sideSum += (L[i] - R[i]) ** 2;
      return {
        L: Array.from(L),
        rmsL: rms(L),
        rmsR: rms(R),
        side: Math.sqrt(sideSum / L.length),
      };
    },
    { kind, bypass },
  );
}

test.describe('a bypassed insert is a wire', () => {
  test('every kind renders what no insert renders, and the level does not move', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await boot(page);
    await page.evaluate(() => {
      const w = window as unknown as MlWindow & { __bypassBase: unknown };
      w.__bypassBase = structuredClone(w.__ml.projectStore.getState().project);
    });

    const dry = await renderOne(page, null, true);
    const dryTwice = await renderOne(page, null, true);

    // The floor is measured, not assumed. Two identical renders are not
    // bit-identical, and a threshold below their own disagreement would fail on
    // every kind and say nothing about any of them.
    const distance = (a: number[], b: number[]) => {
      let s = 0;
      for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
      return Math.sqrt(s / a.length);
    };
    const floor = Math.max(distance(dry.L, dryTwice.L) * 8, 1e-6);
    expect(dry.rmsL, 'the dry render is silent, so nothing below could fail').toBeGreaterThan(1e-3);

    const kinds = await page.evaluate(
      () => (window as unknown as MlWindow).__ml.effectKinds as string[],
    );
    expect(kinds.length, 'no insert kinds were published').toBeGreaterThan(20);

    const leaks: string[] = [];
    for (const kind of kinds) {
      const got = await renderOne(page, kind, true);
      const d = distance(dry.L, got.L);
      const level = got.rmsL / dry.rmsL;
      if (d > floor) leaks.push(`${kind} ${d.toExponential(3)} (level x${level.toFixed(6)})`);
    }
    console.log(`§1 · ${kinds.length} kinds bypassed, floor ${floor.toExponential(2)}`);
    expect(leaks, `bypassed inserts that change the render: ${leaks.join('; ')}`).toEqual([]);
  });

  test('an active stereo insert still widens a mono track', async ({ page }) => {
    // The other half, and the reason this file has two tests. Pinning the
    // bypassed leg to one channel would pass the test above and take away the
    // thing a stereo insert is for. A ping-pong delay on a mono source must
    // produce a difference between the channels; the dry render cannot.
    test.setTimeout(120_000);
    await boot(page);
    await page.evaluate(() => {
      const w = window as unknown as MlWindow & { __bypassBase: unknown };
      w.__bypassBase = structuredClone(w.__ml.projectStore.getState().project);
    });

    const dry = await renderOne(page, null, true);
    const active = await renderOne(page, 'pingpong', false);

    console.log(
      `§1 · side energy: dry ${dry.side.toExponential(2)}, ping-pong ${active.side.toExponential(2)}`,
    );
    expect(dry.side, 'the dry render is not mono, so widening proves nothing').toBeLessThan(1e-6);
    expect(active.side, 'an active ping-pong delay left the track mono').toBeGreaterThan(
      dry.rmsL * 0.05,
    );
  });
});

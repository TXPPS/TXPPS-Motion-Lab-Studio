/**
 * PA-010 in the export path — the bounce has to be in time with the timeline.
 *
 * The live engine has compensated declared insert latency since Directive 03:
 * every channel is held back to match the deepest, so a limiter on the vocal
 * does not put the vocal 7 ms behind the drums. `exportMix` builds the same
 * channels out of the same `InsertChain` and had no compensating node at all,
 * which meant the defect the declaration exists to fix was fixed on the path
 * you monitor and intact on the path you deliver. Nothing said so, because
 * monitoring is exactly where you would have caught it.
 *
 * Measured as a lag rather than as a level, because a lag is what the defect
 * is. An RMS over a render collapses a shift and a level change into one
 * number, which is the class of error every probe finding in this repo has
 * been; a normalised cross-correlation reports the shift in samples and does
 * not care what the amplitude did.
 *
 * The probe insert is a saturator at `mix: 0`. That is not an arbitrary choice:
 * its dry leg is delayed by the same `SHAPER_OVERSAMPLE_LATENCY` as its wet
 * one, so at zero mix it is a pure 192-sample delay and nothing else — the
 * output is the input, moved. A limiter would work too and would also compress,
 * and then a failure could be argued to be the compression.
 */
import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

const preinstalledChromium = '/opt/pw-browsers/chromium';
test.use({
  launchOptions: {
    executablePath: existsSync(preinstalledChromium) ? preinstalledChromium : undefined,
    args: ['--autoplay-policy=no-user-gesture-required'],
  },
});

/** Where the correlation window sits, and how wide the lag search is. */
const WINDOW = { from: 4410, length: 22050, span: 600 } as const;

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
  await page.waitForFunction(() => '__ml' in window, { timeout: 15000 });
}

/**
 * Two instrument tracks holding the same note, panned hard apart.
 *
 * Hard-panned so one rendered channel is one track: the two have to be measured
 * separately, and a mix of both would show their *sum* moving, which is a
 * different and much weaker claim. The left track carries the effects.
 */
const twoTracks = (leftEffects: string) => `(mod) => {
  const p = mod.createEmptyProject('Bounce alignment');
  const a = p.tracks[0];
  a.type = 'instrument';
  a.volume = 0.8;
  a.pan = -1;
  a.effects = ${leftEffects};
  const b = JSON.parse(JSON.stringify(a));
  b.id = 'track-right';
  b.name = 'right';
  b.pan = 1;
  b.effects = [];
  p.tracks = [a, b];
  p.clips = [
    { id: 'cl', trackId: a.id, type: 'midi', name: 'n', start: 0, length: 4, muted: false,
      notes: [{ id: 'nl', pitch: 45, start: 0, length: 4, velocity: 110 }] },
    { id: 'cr', trackId: b.id, type: 'midi', name: 'n', start: 0, length: 4, muted: false,
      notes: [{ id: 'nr', pitch: 45, start: 0, length: 4, velocity: 110 }] },
  ];
  return p;
}`;

/** A pure 192-sample delay: the shaper's cost with none of its shaping. */
const PURE_DELAY =
  "[{ id: 'f1', kind: 'saturator', bypass: false, params: { drive: 0, output: 0, mix: 0 } }]";

interface Rendered {
  left: number[];
  right: number[];
  peak: number;
}

/** Render a project in the page and hand back the two channels, decimated to
 *  nothing — the arrays cross the driver boundary whole, which is what lets the
 *  correlation itself live here in the spec rather than in a page string. */
async function renderStereo(page: Page, build: string): Promise<Rendered> {
  return page.evaluate(
    async ({ src, window: win }) => {
      const w = window as unknown as {
        __ml: {
          exportMix: typeof import('../src/audio/exportMix');
          demoProject: typeof import('../src/model/demoProject');
          engine: { context: BaseAudioContext | null };
        };
      };
      const { renderProject, preloadForRender } = w.__ml.exportMix;
      const fn = new Function('mod', `return (${src})(mod);`) as (
        m: unknown,
      ) => Parameters<typeof renderProject>[0];
      const project = fn(w.__ml.demoProject);
      const ctx = w.__ml.engine.context ?? new OfflineAudioContext(1, 1, 44100);
      await preloadForRender(project, ctx);
      const res = await renderProject(project, {
        range: { startBeat: 0, endBeat: 4 },
        sampleRate: 44100,
        tailSeconds: 0,
      });
      // Only the correlation window plus the search span either side of it
      // leaves the page. The whole buffer is 176 400 samples a channel and
      // serialising both of them costs more than the render did.
      const slice = (c: number) =>
        Array.from(
          res.buffer
            .getChannelData(c)
            .subarray(win.from - win.span, win.from + win.length + win.span),
        );
      return { left: slice(0), right: slice(1), peak: res.peak };
    },
    { src: build, window: WINDOW },
  );
}

/**
 * Normalised cross-correlation, argmax over integer lags. Positive means `test`
 * arrives later than `ref`.
 *
 * Normalised because an insert may legitimately change the level — which pan
 * law a track lands on depends on its channel count — and a raw correlation
 * would then report the louder alignment rather than the right one.
 */
function lagOf(ref: number[], test: number[]): number {
  const base = WINDOW.span;
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = -WINDOW.span; lag <= WINDOW.span; lag += 1) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < WINDOW.length; i += 1) {
      const x = ref[base + i] ?? 0;
      const y = test[base + i + lag] ?? 0;
      dot += x * y;
      na += x * x;
      nb += y * y;
    }
    const score = dot / (Math.sqrt(na * nb) + 1e-12);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return -best;
}

test.describe('a bounce is in time with what was monitored', () => {
  test('a latency-declaring insert moves neither its own track nor the others', async ({
    page,
  }) => {
    await boot(page);
    const ref = await renderStereo(page, twoTracks('[]'));
    const got = await renderStereo(page, twoTracks(PURE_DELAY));
    const left = lagOf(ref.left, got.left);
    const right = lagOf(ref.right, got.right);
    console.log(
      `alignment: left ${left} sample(s), right ${right}, ` +
        `peaks ${ref.peak.toFixed(4)} / ${got.peak.toFixed(4)}`,
    );
    // A silent render correlates with anything, so the lag would come back zero
    // and the test would pass having measured nothing at all.
    expect(ref.peak, 'the reference render is silent').toBeGreaterThan(0.01);
    expect(got.peak, 'the render under test is silent').toBeGreaterThan(0.01);
    // The track carrying the insert. Uncompensated this is +192: the shaper's
    // delay, straight through into the file.
    expect(Math.abs(left), `the insert's own track moved ${left} samples`).toBeLessThan(4);
    // And the track that has no insert at all, which is the half of the defect
    // a compensating node alone would leave behind: it holds this one back 192
    // samples to meet a track that is no longer late.
    expect(Math.abs(right), `an unrelated track moved ${right} samples`).toBeLessThan(4);
  });

  test('the two tracks stay in phase with each other', async ({ page }) => {
    // The relative claim, stated apart from the absolute one. A bounce that is
    // uniformly late is still a usable mix; one whose vocal sits 192 samples
    // off its drums is not, and that is the half PA-010 is actually about.
    await boot(page);
    const got = await renderStereo(page, twoTracks(PURE_DELAY));
    const apart = lagOf(got.right, got.left);
    console.log(`alignment: the two tracks are ${apart} sample(s) apart`);
    expect(got.peak, 'the render is silent').toBeGreaterThan(0.01);
    expect(
      Math.abs(apart),
      `the insert put its track ${apart} samples away from an untouched one`,
    ).toBeLessThan(4);
  });

  test('the measurement can see a delay when there is one', async ({ page }) => {
    // The discriminator. Every assertion above passes if `lagOf` returns zero
    // for everything — a correlation over a window of near-silence, a slice
    // that came back empty, an argmax that never moves off its initial value.
    // A delay the compensator is documented as *not* removing proves the
    // instrument reads: the Rotary's Doppler line declares nothing, because
    // compensating it would be undoing the effect.
    await boot(page);
    const ref = await renderStereo(page, twoTracks('[]'));
    const got = await renderStereo(
      page,
      twoTracks(
        "[{ id: 'f1', kind: 'delay', bypass: false, params: { time: 0.05, feedback: 0, mix: 1 } }]",
      ),
    );
    const left = lagOf(ref.left, got.left);
    console.log(`alignment: an undeclared 50 ms delay reads as ${left} sample(s)`);
    // 50 ms is 2205 samples, past the search span, so what this asserts is that
    // the correlator does not report zero — not the figure itself.
    expect(Math.abs(left), 'a wet delay line read as no shift at all').toBeGreaterThan(4);
  });
});

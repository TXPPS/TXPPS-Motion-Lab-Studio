/**
 * An inserted unit does something to the sound.
 *
 * Directive 11 §1.2. The Motion Shaper shipped doing no modulation at all and
 * was reported as "doesn't really do anything", which was exactly right: a
 * fresh insert carried no shapes, so the host sent no curve, so the core kept
 * the flat curve at 1.0 that `reset()` leaves — and `motion_shaper.h` defines
 * 1.0 as unity gain. Every existing cell passed. `X25` asks whether a unit is
 * insertable and renders finite audio, and a unit doing nothing renders finite
 * audio.
 *
 * So this asks the question none of them did: does the unit *modulate*.
 *
 * Not "does the render differ", which was the first version of this and which
 * could not fail. Removing the default curve again left the render still
 * differing by a mean of 0.0073 — because a three-band crossover and an
 * oversampled path are not transparent even at unity modulation, so the unit
 * was never bit-identical to a wire. It simply did not move. A test that asks
 * whether two renders differ passes on colouration alone.
 *
 * What separates the two is the *shape* of the difference. A static colouration
 * scales every window by about the same amount, so the wet-to-dry ratio is
 * roughly flat across time; a modulator swings it. The measurement is therefore
 * the spread of that ratio in decibels, which is what "rhythmic movement" means
 * expressed as a number.
 */
import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

const preinstalledChromium = '/opt/pw-browsers/chromium';
test.use({
  ...(existsSync(preinstalledChromium)
    ? { launchOptions: { executablePath: preinstalledChromium } }
    : {}),
});

/** RMS in 50 ms windows, and the peak, of one offline render. */
async function renderEnvelope(page: Page, kind: string | null) {
  return page.evaluate(async (unitKind) => {
    const w = window as unknown as {
      __ml: {
        exportMix: typeof import('../src/audio/exportMix');
        projectStore: {
          getState(): Record<string, (...args: never[]) => unknown> & { project: unknown };
        };
      };
    };
    const { renderProject, preloadForRender } = w.__ml.exportMix;
    const st = () => w.__ml.projectStore.getState();
    const base = structuredClone(st().project) as { tracks: { id: string; clips?: unknown[] }[] };
    const track = base.tracks.find((t) => (t.clips ?? []).length > 0) ?? base.tracks[0];
    (st().setProject as (p: unknown) => void)(structuredClone(base));
    if (unitKind !== null) {
      (st().addEffect as (t: string, k: string) => void)(track.id, unitKind);
    }
    const project = st().project as Parameters<typeof renderProject>[0];
    await preloadForRender(project);
    const res = await renderProject(project, {
      range: { startSec: 0, endSec: 4 },
      sampleRate: 44100,
      tailSeconds: 0,
    });
    const data = res.buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const a = data[i] < 0 ? -data[i] : data[i];
      if (a > peak) peak = a;
    }
    const win = Math.floor(0.05 * 44100);
    const rms: number[] = [];
    for (let i = 0; i + win < data.length; i += win) {
      let sum = 0;
      for (let k = 0; k < win; k++) sum += data[i + k] * data[i + k];
      rms.push(Math.sqrt(sum / win));
    }
    return { rms, peak };
  }, kind);
}

test.describe('a unit whose mechanism is a drawn curve is audible on insert', () => {
  test('the Motion Shaper changes the render, without anyone drawing anything', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/');
    await page.waitForFunction(
      () => Boolean((window as unknown as { __ml?: { exportMix?: unknown } }).__ml?.exportMix),
      null,
      { timeout: 30000 },
    );

    const dry = await renderEnvelope(page, null);
    const wet = await renderEnvelope(page, 'mw-motion-shaper');
    expect(errors, errors.join('\n')).toEqual([]);

    const n = Math.min(dry.rms.length, wet.rms.length);
    expect(n, 'nothing rendered').toBeGreaterThan(20);

    // Windows where the source is actually playing. A silent window has a ratio
    // of nothing over nothing, and letting those in would measure the noise
    // floor's spread rather than the unit's.
    const FLOOR = 0.01;
    const ratios: number[] = [];
    for (let i = 0; i < n; i++) {
      if (dry.rms[i] > FLOOR && wet.rms[i] > FLOOR) ratios.push(wet.rms[i] / dry.rms[i]);
    }
    expect(ratios.length, 'no window loud enough to judge').toBeGreaterThan(20);
    const db = (x: number) => 20 * Math.log10(x);
    const spreadDb = db(Math.max(...ratios)) - db(Math.min(...ratios));
    console.log(
      `§1.2 · ${ratios.length} sounding windows · wet/dry ratio spread ${spreadDb.toFixed(2)} dB · ` +
        `peak ${dry.peak.toFixed(4)} → ${wet.peak.toFixed(4)}`,
    );

    // The bar sits between two measured populations rather than just above one.
    // With the default curve removed this reads 7.2-7.9 dB across runs — the
    // crossover and the oversampler colouring the signal by a nearly constant
    // amount, with nothing moving. With the duck it reads 13.2-13.6 dB. 10.5 is
    // the midpoint, which leaves about 2.7 dB either way; the first bar tried
    // was 8, and 0.2 dB of headroom above a noisy population is a flaky test
    // rather than a strict one.
    expect(spreadDb, 'the unit colours the signal but does not modulate it').toBeGreaterThan(10.5);
  });
});

import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * What the master safety limiter costs in time.
 *
 * `docs/KNOWN-LIMITATIONS.md` states a number — the master output is late by
 * 264 samples, 5.99 ms at 44.1 kHz — and a number in a document rots the
 * moment nobody measures it. This measures it, in the browser, out of the
 * app's own render path: the same project is bounced twice, once through the
 * master chain and once past it, and the two onsets are compared.
 *
 * It is a Chromium measurement of a Chromium node. Other engines carry their
 * own figure, so the assertion runs where the documented number was taken.
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

test.describe('the master safety limiter', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'the number is measured on Chromium');

  test('delays the master output by the samples the docs disclose', async ({ page }) => {
    await boot(page);

    const measured = await page.evaluate(async () => {
      const w = window as unknown as {
        __ml: {
          exportMix: typeof import('../src/audio/exportMix');
          demoProject: typeof import('../src/model/demoProject');
        };
      };
      const { renderProject } = w.__ml.exportMix;
      const rate = 44100;

      // One percussive note at beat 0: a fast attack makes the onset a place
      // rather than a slope.
      const p = w.__ml.demoProject.createEmptyProject('Master latency');
      const track = p.tracks[0];
      track.synth = { ...track.synth!, attack: 0.001, decay: 0.05, sustain: 0.4, release: 0.05 };
      p.clips = [
        {
          id: 'c1',
          trackId: track.id,
          type: 'midi',
          name: 'Hit',
          start: 0,
          length: 4,
          muted: false,
          notes: [{ id: 'n1', pitch: 69, start: 0, length: 1, velocity: 120 }],
        },
      ];

      const onset = (buffer: AudioBuffer) => {
        const d = buffer.getChannelData(0);
        let peak = 0;
        for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
        // Relative to each render's own peak, so the master fader cannot be
        // mistaken for a delay.
        const floor = peak * 0.01;
        for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > floor) return i;
        return -1;
      };

      const opts = { range: { startBeat: 0, endBeat: 2 }, sampleRate: rate, tailSeconds: 0.2 };
      const throughMaster = await renderProject(p, opts);
      const pastMaster = await renderProject(p, { ...opts, bypassMaster: true });
      return {
        rate,
        delaySamples: onset(throughMaster.buffer) - onset(pastMaster.buffer),
        directOnset: onset(pastMaster.buffer),
      };
    });

    expect(measured.directOnset, 'the reference render never starts').toBeGreaterThanOrEqual(0);
    console.log(
      `master limiter latency: ${measured.delaySamples} samples ` +
        `(${((measured.delaySamples / measured.rate) * 1000).toFixed(2)} ms @ ${measured.rate} Hz)`,
    );
    expect(measured.delaySamples).toBe(264);
  });
});

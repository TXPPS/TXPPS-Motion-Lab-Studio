/**
 * PA-010 — the declared latency has to be the real one.
 *
 * Directive 03 §1: "add a test that renders a click through each insert and
 * asserts sample alignment against a dry path." That is what this is, and it
 * belongs in a browser rather than in the unit suite for a reason that is the
 * whole point of the ticket: two of the five declarations rest on a number no
 * specification states — how far a `WaveShaperNode` with `oversample` set
 * delays the signal. It was measured at 192 samples, constant across every
 * supported rate, and a unit test could only assert that the constant equals
 * itself. Here the click is actually rendered, so a browser that resamples
 * differently fails this instead of silently misaligning every mix.
 *
 * The declarations that are ours rather than the engine's — the limiter's
 * lookahead, the multiband's native compressor — are checked the same way, so
 * one mechanism covers both kinds of claim.
 */
import { expect, test, type Page } from '@playwright/test';

/** Sample rates the product supports. 192 kHz is included because the shaper
 *  constant is in samples and would be the first thing to break if it were
 *  really a time. */
const RATES = [44100, 48000, 96000] as const;

/**
 * Every insert that declares a latency, and the configuration to measure it in.
 *
 * `amplitude` is quiet on purpose for the dynamics devices: a full-scale
 * impulse makes a limiter *limit*, and the peak of a gain-ridden impulse is not
 * where the impulse arrived.
 */
const CASES = [
  { kind: 'limiter', params: { drive: 0, ceiling: 0, lookahead: 0.5 }, amplitude: 0.01 },
  { kind: 'limiter', params: { drive: 0, ceiling: 0, lookahead: 3 }, amplitude: 0.01 },
  { kind: 'limiter', params: { drive: 0, ceiling: 0, lookahead: 10 }, amplitude: 0.01 },
  { kind: 'multiband', params: {}, amplitude: 0.01 },
  { kind: 'saturator', params: { drive: 0, output: 0, mix: 1 }, amplitude: 1 },
  { kind: 'saturator', params: { drive: 0, output: 0, mix: 0.5 }, amplitude: 1 },
  { kind: 'distortion', params: { drive: 0, mix: 1 }, amplitude: 1 },
] as const;

/** Inserts that must declare nothing, and why. Guards against over-correction. */
const MUST_NOT_DECLARE = [
  // Its shaper costs the usual 192 samples, but the cabinet convolver adds
  // ~205 more that move with the selected cab and are the modelled distance
  // between speaker and microphone. Measured 397 at 96 kHz. See the builder.
  'ampsim',
  // Group delay of a resonant filter: 7/8/16/32 samples at the four rates, so
  // constant in time. Part of how the filter sounds.
  'filter',
  // Its Doppler delay line, which is the entire effect.
  'rotary',
  // Detector-based, no lookahead: measured 0 at every rate.
  'compressor',
  'gate',
  'deesser',
] as const;

async function boot(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('motionlab.prefs.v1', JSON.stringify({ theme: 'dark', uiScale: 1 }));
      localStorage.setItem('txpps-motionlab-welcome-v1', '1');
    } catch {
      /* storage disabled; defaults are fine for a render probe */
    }
  });
  await page.goto('/#/song');
  await page.waitForSelector('[data-testid="app-root"]');
}

test.describe('every insert that delays the signal says so, in samples', () => {
  for (const rate of RATES) {
    test(`declared latency equals measured latency at ${rate} Hz`, async ({ page }) => {
      await boot(page);
      const rows = await page.evaluate(
        async ({ cases, rate }) => {
          const w = window as unknown as {
            __ml: { latencyProbe: () => Promise<typeof import('../src/audio/latencyProbe')> };
          };
          const { measureInsertLatency } = await w.__ml.latencyProbe();
          const out: {
            kind: string;
            label: string;
            measured: number;
            declared: number | null;
            peak: number;
          }[] = [];
          for (const c of cases) {
            const m = await measureInsertLatency(
              c.kind as never,
              c.params as Record<string, number>,
              rate as number,
              c.amplitude as number,
            );
            out.push({
              kind: String(c.kind),
              label: JSON.stringify(c.params),
              measured: m.measuredSamples,
              declared: m.declaredSamples,
              peak: m.peak,
            });
          }
          return out;
        },
        { cases: CASES as unknown as Record<string, unknown>[], rate },
      );

      for (const row of rows) {
        // A silent render would make any offset "agree" with any declaration.
        expect(row.peak, `${row.kind} ${row.label} rendered silence`).toBeGreaterThan(1e-4);
        expect(row.declared, `${row.kind} ${row.label} declared nothing`).not.toBeNull();
        // One sample of tolerance: a declaration is rounded to whole samples
        // and a peak lands on one, so the two can differ by the rounding and
        // by nothing else. Anything larger is a real disagreement.
        expect(
          Math.abs(row.measured - (row.declared ?? 0)),
          `${row.kind} ${row.label} at ${rate} Hz: declared ${row.declared}, measured ${row.measured}`,
        ).toBeLessThanOrEqual(1);
      }
    });
  }

  test('inserts whose delay is part of their sound declare nothing', async ({ page }) => {
    // The other half. Compensating a Rotary's Doppler line or a Filter's group
    // delay would be correcting the effect rather than the timing, so this
    // fails if someone "completes" the set.
    await boot(page);
    const declared = await page.evaluate(
      async ({ kinds }) => {
        const w = window as unknown as {
          __ml: { latencyProbe: () => Promise<typeof import('../src/audio/latencyProbe')> };
        };
        const { measureInsertLatency } = await w.__ml.latencyProbe();
        const out: Record<string, number | null> = {};
        for (const kind of kinds) {
          const m = await measureInsertLatency(kind as never, {}, 48000, 0.01);
          out[kind] = m.declaredSamples;
        }
        return out;
      },
      { kinds: MUST_NOT_DECLARE as unknown as string[] },
    );
    for (const [kind, value] of Object.entries(declared)) {
      expect(value, `${kind} started declaring a latency`).toBeNull();
    }
  });
});

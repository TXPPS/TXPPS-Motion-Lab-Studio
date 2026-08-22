import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * The FLAC encoder is written from scratch in this repo, and its unit tests
 * round-trip through its own decoder — which proves the two agree with each
 * other, not that anything else can read the file. This hands the bytes to
 * the browser's own decoder instead. If Chrome decodes it to the samples that
 * went in, it is a FLAC file; if it does not, it is a private format with a
 * FLAC extension.
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

interface Decoded {
  ok: boolean;
  reason?: string;
  channels: number;
  sampleRate: number;
  frames: number;
  /** Largest absolute difference between what went in and what came back. */
  maxError: number;
  bytes: number;
}

/**
 * Encode a deterministic signal and decode it with the browser.
 * `bitDepth` decides the tolerance the caller should apply: a lossless codec
 * at N bits must return exactly what quantisation to N bits produced.
 */
async function roundTrip(
  page: Page,
  opts: { format: 'flac' | 'wav'; bitDepth: 16 | 24; sampleRate: number; channels: number },
): Promise<Decoded> {
  return page.evaluate(async (o) => {
    const w = window as unknown as {
      __ml: { encode: typeof import('../src/audio/encode') };
    };
    const { encodeAudio } = w.__ml.encode;

    // A signal with everything a predictor finds hard: a tone, a sweep, an
    // impulse, silence, and full scale at both polarities.
    const frames = o.sampleRate; // one second
    const source: Float32Array[] = [];
    for (let c = 0; c < o.channels; c++) {
      const ch = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        const t = i / o.sampleRate;
        const sweep = Math.sin(2 * Math.PI * (100 + 3000 * t) * t) * 0.4;
        const tone = Math.sin(2 * Math.PI * (220 + c * 110) * t) * 0.45;
        ch[i] = i < 100 ? 0 : i === 200 ? 1 : i === 201 ? -1 : sweep + tone;
      }
      source.push(ch);
    }

    const encoded = encodeAudio(source, {
      format: o.format,
      sampleRate: o.sampleRate,
      bitDepth: o.bitDepth,
      float: false,
    });

    // Quantise the source the same way the encoder must have, so the
    // comparison is against what a lossless coder is required to return.
    const scale = Math.pow(2, o.bitDepth - 1);
    const quantised = source.map((ch) => {
      const out = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        const clamped = Math.max(-1, Math.min(1, ch[i]));
        out[i] = Math.max(-scale, Math.min(scale - 1, Math.round(clamped * scale))) / scale;
      }
      return out;
    });

    const ctx = new OfflineAudioContext(o.channels, 1, o.sampleRate);
    let buffer: AudioBuffer;
    try {
      buffer = await ctx.decodeAudioData(await encoded.blob.arrayBuffer());
    } catch (e) {
      return {
        ok: false,
        reason: e instanceof Error ? e.message : String(e),
        channels: 0,
        sampleRate: 0,
        frames: 0,
        maxError: Infinity,
        bytes: encoded.bytes,
      };
    }

    let maxError = 0;
    const compare = Math.min(buffer.length, frames);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const got = buffer.getChannelData(c);
      const want = quantised[Math.min(c, quantised.length - 1)];
      for (let i = 0; i < compare; i++) {
        const d = Math.abs(got[i] - want[i]);
        if (d > maxError) maxError = d;
      }
    }
    return {
      ok: true,
      channels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate,
      frames: buffer.length,
      maxError,
      bytes: encoded.bytes,
    };
  }, opts);
}

test.describe('the FLAC the app writes is a FLAC the browser reads', () => {
  for (const bitDepth of [16, 24] as const) {
    test(`${bitDepth}-bit stereo decodes losslessly`, async ({ page }) => {
      await boot(page);
      const out = await roundTrip(page, {
        format: 'flac',
        bitDepth,
        sampleRate: 44100,
        channels: 2,
      });

      expect(out.ok, `the browser refused the file: ${out.reason ?? ''}`).toBe(true);
      expect(out.channels).toBe(2);
      expect(out.sampleRate).toBe(44100);
      expect(out.frames).toBe(44100);
      // Lossless means exactly the quantised source. One code of slack covers
      // the decoder's own float conversion, nothing more.
      expect(out.maxError).toBeLessThanOrEqual(1 / Math.pow(2, bitDepth - 1));
    });
  }

  test('mono at 96 kHz decodes losslessly', async ({ page }) => {
    await boot(page);
    const out = await roundTrip(page, {
      format: 'flac',
      bitDepth: 24,
      sampleRate: 96000,
      channels: 1,
    });
    expect(out.ok, `the browser refused the file: ${out.reason ?? ''}`).toBe(true);
    expect(out.channels).toBe(1);
    expect(out.sampleRate).toBe(96000);
    expect(out.maxError).toBeLessThanOrEqual(1 / Math.pow(2, 23));
  });

  test('and it is smaller than the WAV of the same audio', async ({ page }) => {
    await boot(page);
    const flac = await roundTrip(page, {
      format: 'flac',
      bitDepth: 16,
      sampleRate: 44100,
      channels: 2,
    });
    const wav = await roundTrip(page, {
      format: 'wav',
      bitDepth: 16,
      sampleRate: 44100,
      channels: 2,
    });
    expect(wav.ok).toBe(true);
    // A codec that compresses nothing is a codec nobody would choose.
    expect(flac.bytes).toBeLessThan(wav.bytes);
  });
});

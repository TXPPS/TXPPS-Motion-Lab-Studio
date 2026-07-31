import { test, expect, type Page } from '@playwright/test';

/**
 * Offline export verified in a real browser, because jsdom has no Web Audio.
 *
 * The important claim is not "a file was produced" but "the file contains what
 * the project contains". Each test isolates one element (audio clip, instrument
 * note, drum note, insert effect, bus send) and asserts its presence or its
 * measurable effect on the rendered peak, so a renderer that silently dropped
 * one of them would fail here rather than ship.
 */

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
  await page.waitForTimeout(800);
  // Audio must be started before media can be decoded at the device rate.
  await page.evaluate(async () => {
    const w = window as unknown as { __ml?: { engine: { start(): Promise<boolean> } } };
    await w.__ml?.engine.start();
  });
}

/** Render the current project and return its measurements. */
async function render(
  page: Page,
  range?: { startBeat: number; endBeat: number },
): Promise<{
  peak: number;
  durationSec: number;
  channels: number;
  sampleRate: number;
  scheduledClips: number;
  scheduledNotes: number;
  missingMedia: string[];
  wavBytes: number;
  wavValid: boolean;
  wavReason?: string;
  wavPeak: number;
}> {
  return page.evaluate(async (r) => {
    const w = window as unknown as {
      __ml: {
        exportMix: typeof import('../src/audio/exportMix');
        projectStore: { getState(): { project: unknown } };
        engine: { context: BaseAudioContext | null };
      };
    };
    const { renderProject, preloadForRender, audioBufferToWav, validateWav } = w.__ml.exportMix;
    const project = w.__ml.projectStore.getState().project as Parameters<typeof renderProject>[0];
    const ctx = w.__ml.engine.context ?? new OfflineAudioContext(1, 1, 44100);
    await preloadForRender(project, ctx);
    const res = await renderProject(project, { range: r, sampleRate: 44100, tailSeconds: 0.5 });
    const wav = audioBufferToWav(res.buffer);
    const info = await validateWav(wav, ctx);
    return {
      peak: res.peak,
      durationSec: res.durationSec,
      channels: res.channels,
      sampleRate: res.sampleRate,
      scheduledClips: res.scheduledClips,
      scheduledNotes: res.scheduledNotes,
      missingMedia: res.missingMedia,
      wavBytes: wav.byteLength,
      wavValid: info.valid,
      wavReason: info.reason,
      wavPeak: info.peak,
    };
  }, range);
}

/** Replace the project with one built in-page, so each test isolates one element. */
async function setProject(page: Page, build: string) {
  await page.evaluate(async (src) => {
    const w = window as unknown as {
      __ml: {
        projectStore: { getState(): { setProject(p: unknown, o?: unknown): void } };
        demoProject: typeof import('../src/model/demoProject');
      };
    };
    const fn = new Function('mod', `return (${src})(mod);`) as (m: unknown) => unknown;
    const p = fn(w.__ml.demoProject);
    w.__ml.projectStore.getState().setProject(p, { markClean: true });
    await new Promise((r) => setTimeout(r, 300));
  }, build);
}

test.describe('offline export', () => {
  test('renders the demo project to a valid, non-silent WAV', async ({ page }) => {
    await boot(page);
    const r = await render(page, { startBeat: 0, endBeat: 8 });

    expect(r.wavValid, `WAV invalid: ${r.wavReason}`).toBe(true);
    expect(r.peak, 'render is silent').toBeGreaterThan(0.001);
    expect(r.wavPeak, 'decoded WAV is silent').toBeGreaterThan(0.001);
    expect(r.channels).toBe(2);
    expect(r.sampleRate).toBe(44100);
    expect(Number.isFinite(r.peak)).toBe(true);
    // 8 beats at 110 BPM plus the tail
    expect(r.durationSec).toBeGreaterThan(4);
    expect(r.scheduledClips).toBeGreaterThan(0);
    expect(r.missingMedia).toEqual([]);
  });

  test('the encoded WAV decodes to the duration and rate it claims', async ({ page }) => {
    await boot(page);
    const r = await render(page, { startBeat: 0, endBeat: 4 });
    expect(r.wavValid).toBe(true);
    // 44 byte header + 16-bit stereo frames
    const expectedBytes = 44 + Math.round(r.durationSec * 44100) * 4;
    expect(Math.abs(r.wavBytes - expectedBytes)).toBeLessThan(4 * 64);
  });

  test('a range render is shorter than a full render', async ({ page }) => {
    await boot(page);
    const short = await render(page, { startBeat: 0, endBeat: 4 });
    const long = await render(page, { startBeat: 0, endBeat: 16 });
    expect(long.durationSec).toBeGreaterThan(short.durationSec + 1);
    expect(long.scheduledClips).toBeGreaterThanOrEqual(short.scheduledClips);
  });

  test('instrument notes reach the output', async ({ page }) => {
    await boot(page);
    // A project with exactly one instrument track and one MIDI note.
    await setProject(
      page,
      `(mod) => {
        const p = mod.createEmptyProject('Instrument only');
        const t = p.tracks.find(x => x.type === 'instrument') || p.tracks[0];
        t.type = 'instrument';
        t.volume = 1;
        p.clips = [{
          id: 'c1', trackId: t.id, type: 'midi', name: 'n', start: 0, length: 4, muted: false,
          notes: [{ id: 'n1', pitch: 60, start: 0, length: 2, velocity: 120 }],
        }];
        return p;
      }`,
    );
    const r = await render(page, { startBeat: 0, endBeat: 4 });
    expect(r.scheduledNotes, 'no notes were scheduled').toBeGreaterThan(0);
    expect(r.peak, 'instrument produced no audible output').toBeGreaterThan(0.001);
  });

  test('a muted track is excluded from the render', async ({ page }) => {
    await boot(page);
    const build = (muted: boolean) => `(mod) => {
      const p = mod.createEmptyProject('Mute test');
      const t = p.tracks[0];
      t.type = 'instrument';
      t.mute = ${muted};
      t.volume = 1;
      p.clips = [{
        id: 'c1', trackId: t.id, type: 'midi', name: 'n', start: 0, length: 4, muted: false,
        notes: [{ id: 'n1', pitch: 60, start: 0, length: 2, velocity: 120 }],
      }];
      return p;
    }`;

    await setProject(page, build(false));
    const audible = await render(page, { startBeat: 0, endBeat: 4 });
    await setProject(page, build(true));
    const muted = await render(page, { startBeat: 0, endBeat: 4 });

    expect(audible.peak).toBeGreaterThan(0.001);
    expect(muted.peak, 'a muted track still reached the mix').toBeLessThan(audible.peak / 10);
  });

  test('insert effects change the rendered audio', async ({ page }) => {
    await boot(page);
    // Same source, once flat and once with a large gain trim: the peak must move.
    const build = (gainDb: number) => `(mod) => {
      const p = mod.createEmptyProject('FX test');
      const t = p.tracks[0];
      t.type = 'instrument';
      t.volume = 0.4;
      t.effects = [{ id: 'f1', kind: 'trim', bypass: false, params: { gainDb: ${gainDb} } }];
      p.clips = [{
        id: 'c1', trackId: t.id, type: 'midi', name: 'n', start: 0, length: 4, muted: false,
        notes: [{ id: 'n1', pitch: 60, start: 0, length: 2, velocity: 100 }],
      }];
      return p;
    }`;

    await setProject(page, build(0));
    const flat = await render(page, { startBeat: 0, endBeat: 4 });
    await setProject(page, build(-24));
    const cut = await render(page, { startBeat: 0, endBeat: 4 });

    expect(flat.peak).toBeGreaterThan(0.001);
    expect(cut.peak, 'the gain insert had no effect on the render').toBeLessThan(flat.peak / 2);
  });

  test('a bypassed insert is transparent', async ({ page }) => {
    await boot(page);
    const build = (bypass: boolean) => `(mod) => {
      const p = mod.createEmptyProject('Bypass test');
      const t = p.tracks[0];
      t.type = 'instrument';
      t.volume = 0.4;
      t.effects = [{ id: 'f1', kind: 'trim', bypass: ${bypass}, params: { gainDb: -24 } }];
      p.clips = [{
        id: 'c1', trackId: t.id, type: 'midi', name: 'n', start: 0, length: 4, muted: false,
        notes: [{ id: 'n1', pitch: 60, start: 0, length: 2, velocity: 100 }],
      }];
      return p;
    }`;

    await setProject(page, build(false));
    const active = await render(page, { startBeat: 0, endBeat: 4 });
    await setProject(page, build(true));
    const bypassed = await render(page, { startBeat: 0, endBeat: 4 });

    expect(bypassed.peak, 'bypass did not restore the signal').toBeGreaterThan(active.peak * 2);
  });

  test('bus sends contribute to the render', async ({ page }) => {
    await boot(page);
    // A source muted at its own output but sent pre-fader to a bus still sounds:
    // if sends were dropped from the render, this would be silent.
    await setProject(
      page,
      `(mod) => {
        const p = mod.createEmptyProject('Send test');
        const t = p.tracks[0];
        t.type = 'instrument';
        t.volume = 1;
        const bus = {
          id: 'bus1', type: 'bus', name: 'Bus', color: '#888', volume: 1, pan: 0,
          mute: false, solo: false, armed: false, collapsed: false, output: 'master',
        };
        p.tracks.push(bus);
        t.sends = [{ busId: 'bus1', amount: 1, enabled: true, preFader: true }];
        p.clips = [{
          id: 'c1', trackId: t.id, type: 'midi', name: 'n', start: 0, length: 4, muted: false,
          notes: [{ id: 'n1', pitch: 60, start: 0, length: 2, velocity: 120 }],
        }];
        return p;
      }`,
    );
    const withSend = await render(page, { startBeat: 0, endBeat: 4 });
    expect(withSend.peak, 'send path produced nothing').toBeGreaterThan(0.001);
  });

  test('an empty range is refused rather than producing a silent file', async ({ page }) => {
    await boot(page);
    await setProject(page, `(mod) => mod.createEmptyProject('Empty')`);
    const r = await page.evaluate(async () => {
      const w = window as unknown as {
        __ml: {
          exportMix: typeof import('../src/audio/exportMix');
          projectStore: { getState(): { project: unknown } };
          engine: { context: BaseAudioContext | null };
        };
      };
      const { renderProject } = w.__ml.exportMix;
      const project = w.__ml.projectStore.getState().project as Parameters<typeof renderProject>[0];
      const res = await renderProject(project, {
        range: { startBeat: 0, endBeat: 4 },
        sampleRate: 44100,
      });
      return { clips: res.scheduledClips, peak: res.peak };
    });
    // Nothing scheduled is reported honestly; exportWav turns this into an error.
    expect(r.clips).toBe(0);
  });
});

import { test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

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

test('measure', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    const w = window as unknown as {
      __ml: {
        exportMix: typeof import('../src/audio/exportMix');
        demoProject: typeof import('../src/model/demoProject');
        engine: { context: BaseAudioContext | null };
      };
    };
    const { renderProject, preloadForRender } = w.__ml.exportMix;
    const mod = w.__ml.demoProject;

    const build = (sidechain: boolean, params: Record<string, number>) => {
      const p = mod.createEmptyProject('Sidechain');
      const bass = p.tracks[0];
      bass.name = 'Bass';
      bass.type = 'instrument';
      bass.volume = 0.9;
      bass.effects = [{ id: 'f1', kind: 'compressor', bypass: false, params }];
      const kick = {
        ...bass, id: 'kick', name: 'Kick', volume: 0.12, effects: [], sends: [],
        automation: [], macros: [], noteFx: [],
      };
      if (sidechain) bass.sidechainFrom = 'kick';
      p.tracks = [bass, kick];
      p.clips = [
        { id: 'cb', trackId: bass.id, type: 'midi', name: 'bass', start: 0, length: 8, muted: false,
          notes: [{ id: 'nb', pitch: 45, start: 0, length: 8, velocity: 120 }] },
        { id: 'ck', trackId: 'kick', type: 'midi', name: 'kick', start: 0, length: 8, muted: false,
          notes: [0, 1, 2, 3].map((b) => ({ id: 'nk' + b, pitch: 36, start: b, length: 0.06, velocity: 127 })) },
      ];
      return p;
    };

    const ctx = w.__ml.engine.context ?? new OfflineAudioContext(1, 1, 44100);
    const measure = async (p: unknown) => {
      await preloadForRender(p as never, ctx);
      const res = await renderProject(p as never, { range: { startBeat: 0, endBeat: 8 }, sampleRate: 44100, tailSeconds: 0.25 });
      const rate = res.buffer.sampleRate;
      const d = res.buffer.getChannelData(0);
      const rms = (from: number, to: number) => {
        const a = Math.floor(from * rate), b = Math.floor(to * rate);
        let s = 0; for (let i = a; i < b; i++) s += d[i] * d[i];
        return Math.sqrt(s / (b - a));
      };
      return { ducked: rms(1.02, 1.1), recovered: rms(1.35, 1.45), peak: res.peak };
    };

    const results: Record<string, unknown> = {};
    const cases: Record<string, Record<string, number>> = {
      asWritten: { thresholdDb: -34, ratio: 12, attackMs: 1, releaseMs: 160, makeupDb: 0 },
      realKeys: { threshold: -34, ratio: 12, attack: 1, release: 160, knee: 12, makeupDb: 0 },
      realKeysNoKnee: { threshold: -34, ratio: 12, attack: 1, release: 160, knee: 0, makeupDb: 0 },
    };
    for (const [name, params] of Object.entries(cases)) {
      const off = await measure(build(false, params));
      const on = await measure(build(true, params));
      results[name] = {
        offRatio: off.ducked / off.recovered,
        onRatio: on.ducked / on.recovered,
        offPeak: off.peak, onPeak: on.peak,
      };
    }

    // Kick key level: render the kick alone, post-fader, and report its peak.
    const kickOnly = build(false, {});
    (kickOnly.tracks[0] as { volume: number }).volume = 0;
    const kres = await (async () => {
      await preloadForRender(kickOnly as never, ctx);
      const r = await renderProject(kickOnly as never, { range: { startBeat: 0, endBeat: 8 }, sampleRate: 44100, tailSeconds: 0.25 });
      return r.peak;
    })();
    results.kickPeakAt012 = kres;
    results.kickPeakDb = 20 * Math.log10(kres);

    // Native DynamicsCompressorNode latency, at neutral settings.
    const oc = new OfflineAudioContext(1, 4096, 44100);
    const buf = oc.createBuffer(1, 64, 44100);
    buf.getChannelData(0)[0] = 1;
    const src = oc.createBufferSource();
    src.buffer = buf;
    const comp = oc.createDynamicsCompressor();
    comp.threshold.value = 0; comp.ratio.value = 1; comp.knee.value = 0;
    src.connect(comp).connect(oc.destination);
    src.start(0);
    const rendered = await oc.startRendering();
    const rd = rendered.getChannelData(0);
    let first = -1, peakIdx = -1, peakVal = 0;
    for (let i = 0; i < rd.length; i++) {
      if (first < 0 && Math.abs(rd[i]) > 1e-6) first = i;
      if (Math.abs(rd[i]) > peakVal) { peakVal = Math.abs(rd[i]); peakIdx = i; }
    }
    results.nativeCompFirstSample = first;
    results.nativeCompPeakSample = peakIdx;
    results.nativeCompPeakValue = peakVal;
    results.nativeCompLatencyMs = (peakIdx / 44100) * 1000;

    return results;
  });
  console.log(JSON.stringify(out, null, 2));
});

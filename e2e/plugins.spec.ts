import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Third-party plugins, proved in a real browser.
 *
 * Nothing here can be a unit test. jsdom has no `AudioWorklet` and no
 * `OfflineAudioContext`, and a Web Audio Module is an `AudioWorkletProcessor`
 * rendered through an offline context — so the only place the claims in
 * docs/THIRD-PARTY-PLUGINS.md can actually be checked is here.
 *
 * The claims under test:
 *
 * 1. A real WAM loads from our own shelf, goes into an insert chain, and is
 *    audible in an offline render — the bounce path, not a live capture.
 * 2. `crossOriginIsolated === false` and audio works anyway. This is §2.4 of
 *    the plan, and it is the reason we do not set COOP/COEP: the SDK's
 *    SharedArrayBuffer transport is opt-in *and* feature-gated, browsers hide
 *    the constructor unless the page is isolated, so every plugin falls back to
 *    the MessagePort path. Asserting it here turns a reading of the SDK source
 *    into a measured fact about the browser we ship to.
 * 3. The async-resource seam holds: the graph build stays synchronous and the
 *    plugin still reaches the render, because it was resolved before the build.
 * 4. A plugin that cannot be loaded is a tombstone. The project renders, the
 *    render says which plugin was missing, and nothing is destroyed.
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

interface Bridge {
  __ml: {
    exportMix: typeof import('../src/audio/exportMix');
    demoProject: typeof import('../src/model/demoProject');
    engine: { context: BaseAudioContext | null; start: () => Promise<boolean> };
    wamParity: () => Promise<typeof import('../src/audio/wam/parityProbe')>;
    wamPool: () => Promise<typeof import('../src/audio/wam/pluginPool')>;
    projectStore: {
      getState: () => {
        project: import('../src/model/types').ProjectData;
        update: (m: (d: import('../src/model/types').ProjectData) => void) => void;
      };
    };
  };
}

/**
 * An audio-free tone source with a given insert chain, rendered offline.
 *
 * A synth note rather than a media clip, so the render needs no decoded audio
 * and the only thing between the source and the output is the chain under test.
 */
const toneWith = (effects: string) => `(mod) => {
  const p = mod.createEmptyProject('Plugin render');
  const t = p.tracks[0];
  t.type = 'instrument';
  t.volume = 0.8;
  t.effects = ${effects};
  p.clips = [{
    id: 'c1', trackId: t.id, type: 'midi', name: 'n', start: 0, length: 8, muted: false,
    notes: [{ id: 'n1', pitch: 45, start: 0, length: 8, velocity: 120 }],
  }];
  return p;
}`;

interface Rendered {
  peak: number;
  rms: number;
  missingPlugins: string[];
  /** First 2048 samples of the render, for comparing two renders sample by sample. */
  head: number[];
}

async function renderChain(page: Page, build: string): Promise<Rendered> {
  return page.evaluate(async (src) => {
    const w = window as unknown as Bridge;
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
      tailSeconds: 0.25,
    });
    const data = res.buffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return {
      peak: res.peak,
      rms: Math.sqrt(sum / data.length),
      missingPlugins: res.missingPlugins,
      head: Array.from(data.slice(20000, 22048)),
    };
  }, build);
}

test.describe('a Web Audio Modules plugin in the bounce', () => {
  test('loads from the shelf and is audible in an offline render', async ({ page }) => {
    // Scoped to errors about *this*, not to an empty console. This sandbox
    // resets outbound connections the app makes at boot, so `console.spec.ts`
    // already fails here on every page with no plugin in sight; inheriting that
    // noise would make this test say nothing about plugins. A page error is
    // never excused, though — a plugin whose module throws must not reach the
    // React tree, and that is exactly what this would catch.
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (/net::ERR_CONNECTION_RESET|favicon/i.test(text)) return;
      problems.push(`console: ${text.slice(0, 200)}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

    await boot(page);

    const dry = await renderChain(page, toneWith('[]'));
    expect(dry.rms, 'the reference render is silent — the test proves nothing').toBeGreaterThan(
      0.001,
    );

    // Simple Distortion, driven hard. `overdrive` and `level` are the plugin's
    // own parameter ids, discovered from the plugin at runtime — no spec in
    // this codebase declares them, which is the point.
    const wet = await renderChain(
      page,
      toneWith(`[{
        id: 'fx-wam', kind: 'wam', bypass: false,
        params: { overdrive: 8, level: 1.4, flavor: 0.6, offset: 0 },
        plugin: {
          identifier: 'com.sequencerParty.simpleDistortion',
          source: 'shelf:distortion',
          name: 'Simple Distortion',
          vendor: 'Sequencer Party',
          version: '1.0.0',
        },
      }]`),
    );

    expect(wet.missingPlugins, 'the plugin failed to load').toEqual([]);
    expect(wet.rms, 'the plugin rendered silence').toBeGreaterThan(0.001);

    // The plugin actually processed. A waveshaper driven eight times over
    // changes the waveform, so a sample-by-sample comparison against the dry
    // render is the honest test — a level check alone could be satisfied by a
    // pass-through with a gain on it, which is exactly what a failed load
    // would produce.
    let maxDelta = 0;
    for (let i = 0; i < wet.head.length; i++) {
      maxDelta = Math.max(maxDelta, Math.abs(wet.head[i] - dry.head[i]));
    }
    expect(maxDelta, 'the render is identical to the dry signal').toBeGreaterThan(0.01);

    expect(problems, `loading a plugin logged errors: ${problems.join(' | ')}`).toEqual([]);
  });

  test('renders without cross-origin isolation, on the MessagePort transport', async ({ page }) => {
    await boot(page);

    // This is §2.4 of the plan, checked rather than argued. If any of these
    // three flip, plugin behaviour has changed underneath us: the SDK would
    // take its SharedArrayBuffer path, which we have never tested and which
    // would arrive with COOP/COEP that break cross-origin assets and the PWA.
    const isolation = await page.evaluate(() => ({
      crossOriginIsolated: globalThis.crossOriginIsolated,
      windowSab: typeof globalThis.SharedArrayBuffer,
    }));
    expect(isolation.crossOriginIsolated).toBe(false);
    expect(isolation.windowSab).toBe('undefined');

    // And inside the AudioWorkletGlobalScope, which is where the SDK's
    // `_useSab` gate actually reads it.
    const inWorklet = await page.evaluate(async () => {
      const ctx = new OfflineAudioContext(1, 128, 44100);
      const src = `registerProcessor('sab-probe', class extends AudioWorkletProcessor {
        constructor(o) { super(o); this.port.postMessage(typeof globalThis.SharedArrayBuffer); }
        process() { return false; }
      });`;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      return new Promise<string>((resolve) => {
        const n = new AudioWorkletNode(ctx, 'sab-probe');
        n.port.onmessage = (e: MessageEvent) => resolve(e.data as string);
        void ctx.startRendering();
      });
    });
    expect(inWorklet).toBe('undefined');

    // Not isolated, and audio works anyway — which is the whole claim.
    const wet = await renderChain(
      page,
      toneWith(`[{
        id: 'fx-wam', kind: 'wam', bypass: false,
        params: { overdrive: 6, level: 1.2 },
        plugin: {
          identifier: 'com.sequencerParty.simpleDistortion',
          source: 'shelf:distortion',
          name: 'Simple Distortion', vendor: 'Sequencer Party', version: '1.0.0',
        },
      }]`),
    );
    expect(wet.missingPlugins).toEqual([]);
    expect(wet.rms).toBeGreaterThan(0.001);
  });

  test('a bypassed plugin passes the signal through unchanged', async ({ page }) => {
    await boot(page);
    // WAM 2.0 has no bypass concept, so the host carries a dry path around the
    // plugin. The gains are set rather than ramped at construction, because an
    // offline render starts at the same instant its graph does — a crossfade
    // climbing from zero would fade in the head of every bounce.
    const dry = await renderChain(page, toneWith('[]'));
    const bypassed = await renderChain(
      page,
      toneWith(`[{
        id: 'fx-wam', kind: 'wam', bypass: true,
        params: { overdrive: 10, level: 2 },
        plugin: {
          identifier: 'com.sequencerParty.simpleDistortion',
          source: 'shelf:distortion',
          name: 'Simple Distortion', vendor: 'Sequencer Party', version: '1.0.0',
        },
      }]`),
    );
    expect(bypassed.missingPlugins).toEqual([]);
    let maxDelta = 0;
    for (let i = 0; i < dry.head.length; i++) {
      maxDelta = Math.max(maxDelta, Math.abs(bypassed.head[i] - dry.head[i]));
    }
    expect(maxDelta, 'a bypassed plugin coloured the signal').toBeLessThan(1e-4);
  });

  test('a plugin that cannot be loaded is a tombstone: the bounce still happens, and says so', async ({
    page,
  }) => {
    await boot(page);
    const out = await renderChain(
      page,
      toneWith(`[{
        id: 'fx-gone', kind: 'wam', bypass: false,
        params: { size: 0.7, mode: 2 },
        plugin: {
          identifier: 'com.example.notHere',
          source: 'https://plugins.example.invalid/thing/index.js',
          name: 'Missing Plugin', vendor: 'Nobody', version: '1.0.0',
          state: { preset: 'Cathedral' },
        },
      }]`),
    );
    // The project rendered rather than throwing, the insert passed audio
    // through, and the result names what was missing so the caller can say so.
    expect(out.rms).toBeGreaterThan(0.001);
    expect(out.missingPlugins).toEqual(['Missing Plugin']);
  });

  test('the parity probe measures a real plugin against a real playback capture', async ({
    page,
  }) => {
    await boot(page);
    // The probe needs a running context for its realtime half.
    const started = await page.evaluate(async () => {
      const w = window as unknown as Bridge;
      return w.__ml.engine.start();
    });
    test.skip(!started, 'no running AudioContext in this environment');

    const result = await page.evaluate(async () => {
      const w = window as unknown as Bridge;
      const probe = await w.__ml.wamParity();
      probe.clearParityCache();
      return probe.runParityProbe(
        {
          identifier: 'com.sequencerParty.simpleDistortion',
          version: '1.0.0',
          name: 'Simple Distortion',
          source: 'shelf:distortion',
        },
        w.__ml.engine.context,
      );
    });

    // The verdict itself is the finding, and either decided answer is a real
    // result: a pass means this plugin bounces through the normal offline
    // path, a fail means it would be routed through a freeze instead. What
    // must not happen is the probe throwing or hanging.
    expect(['pass', 'fail', 'inconclusive']).toContain(result.verdict);
    // Simple Distortion is a stateless waveshaper with no main-thread
    // modulation at all, so it should not be measured as diverging.
    expect(result.verdict, `probe said: ${result.note}`).not.toBe('fail');
  });

  /**
   * The live half of the async-resource seam.
   *
   * `AudioEngine.syncGraph` is synchronous and runs on every project-store
   * change; instantiating a plugin is `await`. The seam is that the graph
   * builds *now* with a unity pass-through where the plugin will go, the
   * plugin resolves beside it, and `onPluginsResolved` brings the engine back
   * for a second sync that picks it up. `InsertChain`'s shape signature carries
   * the pool's token so that second sync counts as a change of shape — without
   * that the placeholder would never be replaced, and this is the test that
   * would notice.
   */
  test('a plugin added to a live project resolves and reaches the running graph', async ({
    page,
  }) => {
    await boot(page);
    const started = await page.evaluate(async () => {
      const w = window as unknown as Bridge;
      return w.__ml.engine.start();
    });
    test.skip(!started, 'no running AudioContext in this environment');

    const seam = await page.evaluate(async () => {
      const w = window as unknown as Bridge;
      const pool = await w.__ml.wamPool();
      const ctx = w.__ml.engine.context!;
      const store = w.__ml.projectStore.getState();
      const trackId = store.project.tracks[0].id;
      const effect = {
        id: 'fx-live-wam',
        kind: 'wam' as const,
        bypass: false,
        params: { overdrive: 5, level: 1 },
        plugin: {
          identifier: 'com.sequencerParty.simpleDistortion',
          source: 'shelf:distortion',
          name: 'Simple Distortion',
          vendor: 'Sequencer Party',
          version: '1.0.0',
        },
      };

      // Before the edit there is no such plugin anywhere.
      const before = pool.getPluginSync(ctx, effect.id);

      w.__ml.projectStore.getState().update((d) => {
        const t = d.tracks.find((x) => x.id === trackId)!;
        t.effects = [...(t.effects ?? []), effect];
      });

      // Immediately after the (synchronous) store update the graph has already
      // been rebuilt — it did not wait — and the plugin is still resolving.
      const tokenDuring = pool.pluginToken(ctx, effect);

      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && !pool.getPluginSync(ctx, effect.id)) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const after = pool.getPluginSync(ctx, effect.id);
      // Read the token *before* tearing the effect back out: removing it
      // releases the instance synchronously, inside the store subscription,
      // which would put the token back to 'pending' under the assertion.
      const tokenAfter = pool.pluginToken(ctx, effect);

      // Put the project back the way it was found.
      w.__ml.projectStore.getState().update((d) => {
        const t = d.tracks.find((x) => x.id === trackId)!;
        t.effects = (t.effects ?? []).filter((e) => e.id !== effect.id);
      });
      // And releasing it really does release it: an unreferenced plugin is an
      // AudioWorklet processor still running on the audio thread.
      const releasedAfterRemoval = pool.getPluginSync(ctx, effect.id) === null;

      return {
        beforeWasNull: before === null,
        tokenDuring,
        resolved: !!after,
        tokenAfter,
        releasedAfterRemoval,
        paramsApplied: after?.appliedParams ?? null,
        contextIsLive: ctx === w.__ml.engine.context,
      };
    });

    expect(seam.beforeWasNull).toBe(true);
    expect(seam.contextIsLive).toBe(true);
    // The graph did not block on the plugin.
    expect(seam.tokenDuring).toBe('pending');
    // And the plugin arrived on the live context, off the project subscription.
    expect(seam.resolved, 'the plugin never resolved on the live context').toBe(true);
    // The token changed, which is what makes the chain rebuild and swap the
    // placeholder for the real thing.
    expect(seam.tokenAfter).not.toBe('pending');
    expect(seam.tokenAfter).toContain('com.sequencerParty.simpleDistortion');
    // Parameters were applied and awaited during the resolve, not during the
    // synchronous build — which is what makes an offline render correct.
    expect(seam.paramsApplied).toEqual({ overdrive: 5, level: 1 });
    // Deleting the insert gives the audio thread back.
    expect(seam.releasedAfterRemoval).toBe(true);
  });

  /**
   * The probe has to be able to say no, or a pass means nothing.
   *
   * The failure it exists to catch is a plugin driving its own parameters from
   * a main-thread tick: offline the render finishes faster than wall clock and
   * those ticks never fire in step, so the bounce differs from what was heard,
   * silently. This reproduces that shape without needing a misbehaving plugin
   * — a gain moved from a `setInterval` is exactly the same mechanism — and
   * checks both halves of the discrimination in one run.
   */
  test('the probe catches a signal driven from the main thread, and passes one that is not', async ({
    page,
  }) => {
    await boot(page);
    const started = await page.evaluate(async () => {
      const w = window as unknown as Bridge;
      return w.__ml.engine.start();
    });
    test.skip(!started, 'no running AudioContext in this environment');

    const verdicts = await page.evaluate(async () => {
      const w = window as unknown as Bridge;
      const probe = await w.__ml.wamParity();
      const live = w.__ml.engine.context!;

      // The offline reference: a plain gain of 1, rendered deterministically.
      const frames = Math.floor(probe.PROBE_SECONDS * probe.PROBE_SAMPLE_RATE);
      const off = new OfflineAudioContext(1, frames, probe.PROBE_SAMPLE_RATE);
      const src = off.createBufferSource();
      src.buffer = probe.probeStimulus(off);
      const g = off.createGain();
      src.connect(g);
      g.connect(off.destination);
      src.start();
      const offlineEnv = probe.rmsEnvelope((await off.startRendering()).getChannelData(0));

      // Realtime, same graph, gain left alone: this must agree.
      const steady = await probe.captureRealtime(live, (s) => {
        const gain = live.createGain();
        s.connect(gain);
        return gain;
      });

      // Realtime, same graph, gain chopped from a main-thread timer: this is
      // the divergence, and it must not be waved through.
      let timer = 0;
      const chopped = await probe.captureRealtime(live, (s) => {
        const gain = live.createGain();
        s.connect(gain);
        let on = false;
        timer = window.setInterval(() => {
          on = !on;
          gain.gain.setValueAtTime(on ? 1 : 0.1, live.currentTime);
        }, 40);
        return gain;
      });
      clearInterval(timer);

      return {
        steady: probe.compareParity(offlineEnv, probe.rmsEnvelope(steady)),
        chopped: probe.compareParity(offlineEnv, probe.rmsEnvelope(chopped)),
        steadyRms: probe.rmsEnvelope(steady),
      };
    });

    // The realtime half is genuinely capturing audio off the audio thread —
    // otherwise neither verdict below would mean anything.
    expect(Math.max(...verdicts.steadyRms)).toBeGreaterThan(0.01);
    expect(verdicts.steady.verdict, `steady said: ${verdicts.steady.note}`).toBe('pass');
    expect(verdicts.chopped.verdict, `chopped said: ${verdicts.chopped.note}`).toBe('fail');
  });
});

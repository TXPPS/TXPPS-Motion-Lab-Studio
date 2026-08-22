import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Two audit findings could only be argued from the code, because both need a
 * real OfflineAudioContext: a bounce that starts silent because the dynamics
 * ballistics have not settled, and a sidechain that keys in playback and not
 * in the render. This proves both in a browser, by measuring the rendered
 * audio rather than by reading the graph.
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

interface Windows {
  peak: number;
  /** RMS over [from, to) seconds of the rendered buffer, by label. */
  rms: Record<string, number>;
}

/**
 * Build a project in the page, render it offline, and report RMS over the
 * named windows. Windows are in seconds from the start of the render.
 */
async function renderWindows(
  page: Page,
  build: string,
  windows: Record<string, [number, number]>,
  endBeat: number,
): Promise<Windows> {
  return page.evaluate(
    async ({ src, windows, endBeat }) => {
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
        range: { startBeat: 0, endBeat },
        sampleRate: 44100,
        tailSeconds: 0.25,
      });

      const rate = res.buffer.sampleRate;
      const data = res.buffer.getChannelData(0);
      const rms: Record<string, number> = {};
      for (const [name, [from, to]] of Object.entries(windows)) {
        const a = Math.max(0, Math.floor(from * rate));
        const b = Math.min(data.length, Math.floor(to * rate));
        let sum = 0;
        for (let i = a; i < b; i++) sum += data[i] * data[i];
        rms[name] = b > a ? Math.sqrt(sum / (b - a)) : 0;
      }
      return { peak: res.peak, rms };
    },
    { src: build, windows, endBeat },
  );
}

/** One instrument track holding a long note from beat 0, with a given insert chain. */
const holdingNote = (effects: string) => `(mod) => {
  const p = mod.createEmptyProject('Bounce parity');
  const t = p.tracks[0];
  t.type = 'instrument';
  t.volume = 0.8;
  t.effects = ${effects};
  p.clips = [{
    id: 'c1', trackId: t.id, type: 'midi', name: 'n', start: 0, length: 8, muted: false,
    notes: [{ id: 'n1', pitch: 57, start: 0, length: 8, velocity: 110 }],
  }];
  return p;
}`;

test.describe('the bounce settles before the music starts', () => {
  test('a bypassed compressor does not mute the head of the render', async ({ page }) => {
    await boot(page);
    const windows = {
      head: [0.0, 0.06] as [number, number],
      later: [0.9, 1.1] as [number, number],
    };

    const flat = await renderWindows(page, holdingNote('[]'), windows, 4);
    const bypassed = await renderWindows(
      page,
      holdingNote(
        `[{ id: 'f1', kind: 'compressor', bypass: true, params: { thresholdDb: -24, ratio: 8, attackMs: 5, releaseMs: 1000 } }]`,
      ),
      windows,
      4,
    );

    expect(
      flat.rms.head,
      'the reference render is silent — the test proves nothing',
    ).toBeGreaterThan(0.001);
    // A bypass is documented as exactly unity gain. Before the pre-roll landed,
    // this window was near zero while the reference was not.
    expect(bypassed.rms.head).toBeGreaterThan(flat.rms.head * 0.9);
    expect(bypassed.rms.later).toBeGreaterThan(flat.rms.later * 0.9);
  });

  test('an active compressor renders the first bar at the level it holds later', async ({
    page,
  }) => {
    await boot(page);
    const windows = {
      head: [0.0, 0.05] as [number, number],
      settled: [1.5, 1.7] as [number, number],
    };
    // A one-second release is the worst case: it took over three seconds to
    // reach unity from a cold start, so the whole first bar was ramping.
    const out = await renderWindows(
      page,
      holdingNote(
        `[{ id: 'f1', kind: 'compressor', bypass: false, params: { thresholdDb: -30, ratio: 6, attackMs: 5, releaseMs: 1000, makeupDb: 0 } }]`,
      ),
      windows,
      8,
    );

    expect(out.rms.settled, 'nothing was rendered').toBeGreaterThan(0.001);
    // Real compression still moves the level; what must not happen is the head
    // arriving from silence. Half the settled level is far above the ~0 the
    // un-pre-rolled render produced and far below anything compression does.
    expect(out.rms.head).toBeGreaterThan(out.rms.settled * 0.5);
  });
});

test.describe('sidechain keying reaches the bounce', () => {
  /** A quiet clicky kick and a loud held bass, the bass keyed from the kick. */
  const keyed = (sidechain: boolean) => `(mod) => {
    const p = mod.createEmptyProject('Sidechain');
    const bass = p.tracks[0];
    bass.name = 'Bass';
    bass.type = 'instrument';
    bass.volume = 0.9;
    bass.effects = [{
      id: 'f1', kind: 'compressor', bypass: false,
      params: { thresholdDb: -34, ratio: 12, attackMs: 1, releaseMs: 160, makeupDb: 0 },
    }];
    const kick = {
      ...bass, id: 'kick', name: 'Kick', volume: 0.12, effects: [], sends: [],
      automation: [], macros: [], noteFx: [],
    };
    ${sidechain ? "bass.sidechainFrom = 'kick';" : ''}
    p.tracks = [bass, kick];
    p.clips = [
      { id: 'cb', trackId: bass.id, type: 'midi', name: 'bass', start: 0, length: 8, muted: false,
        notes: [{ id: 'nb', pitch: 45, start: 0, length: 8, velocity: 120 }] },
      { id: 'ck', trackId: 'kick', type: 'midi', name: 'kick', start: 0, length: 8, muted: false,
        notes: [0, 1, 2, 3].map((b) => ({ id: 'nk' + b, pitch: 36, start: b, length: 0.06, velocity: 127 })) },
    ];
    return p;
  }`;

  test('the bass ducks under the kick in the render, and only when it is keyed', async ({
    page,
  }) => {
    await boot(page);
    // 120 bpm: the kick on beat 2 lands at 1.0 s. Measure just after it, and
    // again once a 160 ms release has let go.
    const windows = {
      ducked: [1.02, 1.1] as [number, number],
      recovered: [1.35, 1.45] as [number, number],
    };

    const off = await renderWindows(page, keyed(false), windows, 8);
    const on = await renderWindows(page, keyed(true), windows, 8);

    expect(off.rms.recovered, 'nothing was rendered').toBeGreaterThan(0.001);

    const ratio = (w: Windows) => w.rms.ducked / w.rms.recovered;
    // Unkeyed, a held note is level across both windows.
    expect(ratio(off)).toBeGreaterThan(0.9);
    // Keyed, the window right after the kick is materially quieter — this is
    // the whole point of a sidechain, and it was absent from every bounce.
    expect(ratio(on), 'the sidechain did not reach the render').toBeLessThan(0.8);
  });
});

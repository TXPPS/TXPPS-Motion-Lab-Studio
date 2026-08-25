/**
 * Where, in time, does a bypassed insert change the render?
 *
 * The soak's ninth property reported one number — 1.6478e-2 RMS across a render
 * — and an RMS over a whole render collapses a startup transient, a filter
 * difference and a level change into the same figure. Three mechanisms, one
 * number, and nothing to tell them apart with. Two hypotheses were tried against
 * that number and both were reverted for moving it by nothing, which is what
 * guessing looks like when the measurement cannot discriminate between guesses.
 *
 * So this localises the difference before anything is hypothesised:
 *
 *  - **per window** — sixty-four windows across the render, each as its own RMS,
 *    so a difference living in the first millisecond looks nothing like one
 *    spread evenly;
 *  - **per channel** — left and right separately, because a pan-law change moves
 *    both equally and a channel-count change need not;
 *  - **at full resolution** — the property took every eighth sample, which is a
 *    decimation with no anti-alias filter in front of it;
 *  - **on the track alone** — a ratio measured across a mix is diluted by every
 *    track that did not change, and 1.0331 is what √2 looks like after that
 *    dilution. No clean hypothesis has 1.0331 in it, which is most of why the
 *    two guesses stayed guesses.
 *
 * It answered in one run: the difference was spread perfectly evenly, equal on
 * both channels, and exactly ×1.414214 — the step between a `StereoPannerNode`'s
 * mono and stereo pan laws. Fifteen inserts were up-mixing the track to stereo
 * while bypassed. `e2e/bypasstransparent.spec.ts` is the standing guard; this
 * stays because the next difference of this kind will also arrive as one number.
 *
 * `--kinds=a,b` limits the sweep, `--no-isolate` renders the whole mix,
 * `--json` writes `bypass-out.json` for `npm run probe:mutations`.
 */
import { writeFileSync } from 'node:fs';
import { launch, openApp, seedFixture, markBaseline, BASE } from './soak/session.mjs';
import { unless, mutated } from './probe-mutant.mjs';

const arg = (name, fallback) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const ONLY = arg('kinds', process.env.BYPASS_KINDS ?? '');
// The whole mix is what the property measured, and measuring the mix is the
// probe defect this flag exists to keep executable.
const ISOLATE = !process.argv.includes('--no-isolate') && !mutated('bypass/isolate-track');
const JSON_OUT = process.argv.includes('--json');

const browser = await launch();
const { page } = await openApp(browser, { name: 'desktop', width: 1440, height: 900 });
await seedFixture(page);
await markBaseline(page);

console.log(`bypass-probe: ${BASE}${ISOLATE ? ', instrument track alone' : ', full mix'}\n`);

const result = await page.evaluate(
  async ({ only, isolate, range, stride, withContext }) => {
    const w = window;
    const { renderProject, preloadForRender } = w.__ml.exportMix;
    const st = () => w.__ml.projectStore.getState();

    /** Render the fixture, optionally with one bypassed insert on the instrument track. */
    const render = async (kind) => {
      st().setProject(structuredClone(w.__soakBaseline));
      const track = st().project.tracks.find((t) => t.type === 'instrument');
      if (isolate) {
        for (const t of st().project.tracks.slice()) {
          if (t.id !== track.id) st().deleteTrack(t.id);
        }
      }
      if (kind) {
        st().addEffect(track.id, kind);
        const fx = st()
          .project.tracks.find((x) => x.id === track.id)
          .effects.at(-1);
        st().setEffectBypass(track.id, fx.id, true);
      }
      // The decode context is a required argument. Omitting it left `loadBuffer`
      // decoding into `undefined`, which is invisible for a project whose media
      // the app has already decoded and silent in a different sense for one it
      // has not.
      await preloadForRender(
        st().project,
        withContext ? (w.__ml.engine.context ?? new OfflineAudioContext(1, 1, 44100)) : undefined,
      );
      const res = await renderProject(st().project, { range, sampleRate: 44100, tailSeconds: 0 });
      const take = (ch) => {
        const src = res.buffer.getChannelData(ch);
        if (stride === 1) return Float32Array.from(src);
        const out = new Float32Array(Math.ceil(src.length / stride));
        for (let i = 0, j = 0; i < src.length; i += stride, j += 1) out[j] = src[i];
        return out;
      };
      return {
        L: take(0),
        R: take(res.buffer.numberOfChannels > 1 ? 1 : 0),
        samples: res.buffer.length,
        channels: res.buffer.numberOfChannels,
      };
    };

    const rms = (a, from = 0, to = a.length) => {
      let s = 0;
      for (let i = from; i < to; i += 1) s += a[i] * a[i];
      return Math.sqrt(s / Math.max(1, to - from));
    };
    const diffOf = (a, b) => {
      const n = Math.min(a.length, b.length);
      const d = new Float32Array(n);
      for (let i = 0; i < n; i += 1) d[i] = a[i] - b[i];
      return d;
    };
    /** First index whose magnitude clears a threshold, or -1. */
    const firstAbove = (d, t) => {
      for (let i = 0; i < d.length; i += 1) if (Math.abs(d[i]) > t) return i;
      return -1;
    };
    /** Sixty-four windows: the shape of the difference over time. */
    const windows = (d, ref, n = 64) => {
      const width = Math.floor(d.length / n);
      const out = [];
      for (let i = 0; i < n; i += 1) {
        out.push({
          ms: Math.round(((i * width * stride) / 44100) * 1000),
          d: rms(d, i * width, (i + 1) * width),
          ref: rms(ref, i * width, (i + 1) * width),
        });
      }
      return out;
    };
    /** Fraction of the difference's energy inside the first `ms` milliseconds. */
    const energyBy = (d, ms) => {
      const cut = Math.min(d.length, Math.round((ms / 1000) * (44100 / stride)));
      let head = 0;
      let all = 0;
      for (let i = 0; i < d.length; i += 1) {
        const e = d[i] * d[i];
        all += e;
        if (i < cut) head += e;
      }
      return all > 0 ? head / all : 0;
    };

    const dry = await render(null);
    const dry2 = await render(null);
    const floorL = rms(diffOf(dry.L, dry2.L));

    const kinds = only ? only.split(',') : (w.__ml.effectKinds ?? []);
    const rows = [];
    for (const kind of kinds) {
      let wet;
      try {
        wet = await render(kind);
      } catch (e) {
        rows.push({ kind, error: String(e).slice(0, 120) });
        continue;
      }
      const dL = diffOf(dry.L, wet.L);
      const dR = diffOf(dry.R, wet.R);
      const bins = windows(dL, dry.L);
      const busy = bins.filter((b) => b.ref > 1e-4);
      // The ratio of difference to signal, window by window. A startup event has
      // one big window and the rest near zero; a level change has the same ratio
      // in every window with any signal in it at all. This is the number the
      // whole-render RMS was hiding.
      const ratios = busy.map((b) => b.d / b.ref);
      const mean = ratios.reduce((a, b) => a + b, 0) / Math.max(1, ratios.length);
      const spread =
        ratios.length > 1
          ? Math.sqrt(ratios.reduce((a, r) => a + (r - mean) ** 2, 0) / ratios.length) / (mean || 1)
          : 0;
      rows.push({
        kind,
        channels: `${dry.channels}->${wet.channels}`,
        diffL: rms(dL),
        diffR: rms(dR),
        levelL: rms(wet.L) / (rms(dry.L) || 1),
        levelR: rms(wet.R) / (rms(dry.R) || 1),
        firstAt: firstAbove(dL, 1e-4),
        e1ms: energyBy(dL, 1),
        e10ms: energyBy(dL, 10),
        ratioSpread: spread,
        bins: bins.map((b) => ({ ms: b.ms, d: Number(b.d.toExponential(3)) })),
      });
    }
    return {
      floorL,
      dryRms: rms(dry.L),
      dryChannels: dry.channels,
      samples: dry.samples,
      compared: dry.L.length,
      rows,
    };
  },
  {
    only: ONLY,
    isolate: ISOLATE,
    // Beats, not seconds. `RenderRange` is `{ startBeat, endBeat }`, so
    // `{ startSec, endSec }` was accepted by the untyped call and silently
    // ignored: a probe that described itself as rendering two seconds rendered
    // the whole seventeen-second project, and the soak carried the same mistake
    // in three places. `tsconfig.e2e.json` is why the specs no longer can.
    range: unless(
      'bypass/range-in-beats',
      { startBeat: 0, endBeat: 4 },
      { startSec: 0, endSec: 2 },
    ),
    // Every sample. Taking every eighth folds anything above 2.7 kHz down to
    // somewhere it is not, and the difference this probe exists to characterise
    // could have been anywhere.
    stride: unless('bypass/full-resolution', 1, 8),
    withContext: !mutated('bypass/preload-context'),
  },
);

const f = (x) => (x === undefined ? '—' : Number(x).toExponential(3));
console.log(`floor between two identical renders: ${f(result.floorL)}`);
console.log(
  `dry render: ${f(result.dryRms)} rms, ${result.dryChannels} channel(s), ` +
    `${result.samples} samples, ${result.compared} compared\n`,
);
console.log('kind                   diff L     level L   level R   first   E<1ms   E<10ms  spread');
console.log('-'.repeat(90));
const leaks = [];
for (const r of result.rows) {
  if (r.error) {
    console.log(`${r.kind.padEnd(20)}  threw: ${r.error}`);
    continue;
  }
  const leaking = r.diffL > Math.max(result.floorL * 8, 1e-6);
  if (leaking) leaks.push(r);
  console.log(
    `${leaking ? '*' : ' '}${r.kind.padEnd(19)} ${f(r.diffL)}  ${r.levelL.toFixed(5)}  ` +
      `${r.levelR.toFixed(5)}  ${String(r.firstAt).padStart(6)}  ` +
      `${(r.e1ms * 100).toFixed(1).padStart(5)}%  ${(r.e10ms * 100).toFixed(1).padStart(6)}%  ` +
      `${r.ratioSpread.toFixed(3)}`,
  );
}
console.log(`\n${leaks.length} of ${result.rows.length} change the render while bypassed.`);
const worstLevel = result.rows.reduce((m, r) => Math.max(m, Math.abs((r.levelL ?? 1) - 1)), 0);
if (leaks.length > 0) {
  const lv = leaks.map((r) => r.levelL);
  console.log(
    `level ratio across them: ${Math.min(...lv).toFixed(6)} .. ${Math.max(...lv).toFixed(6)}`,
  );
  console.log(`sqrt(2) = ${Math.SQRT2.toFixed(6)} — the step between the two pan laws.`);
  const worst = leaks[0];
  console.log(`\nwhere ${worst.kind}'s difference lives:`);
  const peak = Math.max(...worst.bins.map((b) => b.d));
  for (const b of worst.bins.filter((_, i) => i % 2 === 0)) {
    const n = peak > 0 ? Math.round((b.d / peak) * 50) : 0;
    console.log(`  ${String(b.ms).padStart(5)} ms |${'#'.repeat(n)}`);
  }
}

if (JSON_OUT) {
  // The shape `probe:mutations` reads: named rows, so a registry entry names a
  // measurement rather than a position in an array.
  writeFileSync(
    'bypass-out.json',
    JSON.stringify(
      [
        { name: 'samples rendered', value: result.samples, unit: 'samples' },
        { name: 'samples compared', value: result.compared, unit: 'samples' },
        { name: 'dry rms', value: Number(result.dryRms.toPrecision(6)) },
        { name: 'kinds leaking', value: leaks.length, unit: 'kinds' },
        { name: 'worst level error', value: Number(worstLevel.toPrecision(6)) },
        { name: 'floor', value: Number(result.floorL.toPrecision(6)) },
        { name: 'kinds swept', value: result.rows.length, unit: 'kinds' },
      ],
      null,
      2,
    ),
  );
}
await browser.close();

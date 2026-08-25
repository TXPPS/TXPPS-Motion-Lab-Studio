/**
 * The stress matrix, measured.
 *
 * Directive 10 §5. Run at every section boundary; a regression against the
 * previous row is a P1. Every check reports a *number* — a ceiling, a
 * millisecond, a byte count — because an adjective cannot be compared against
 * last week's adjective, which is the whole point of keeping the table.
 *
 *   npm run preview &
 *   npm run stress                    # human-readable, plus a PROGRESS row
 *   node scripts/stress.mjs --json    # machine-readable
 *
 * A check that cannot run here says `BLOCKED` and names the capability it is
 * missing. `BLOCKED` and `0` look identical in a table and mean opposite
 * things.
 *
 * The first run of this file reported 284,000 transport operations per second
 * and a heap that had shrunk by 79 MB, and both were the probe rather than the
 * product: unawaited calls are not operations, and two heap samples with a
 * collection between them measure the collector. Everything below is written
 * against that — awaited work, settled state, and heap read either side of a
 * forced collection.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { unless } from './probe-mutant.mjs';

const BASE = process.env.STRESS_BASE ?? 'http://localhost:4173';
const JSON_ONLY = process.argv.includes('--json');
const preinstalled = '/opt/pw-browsers/chromium';

/** One display refresh at 60 Hz. Two of these is the "it stutters" line. */
const FRAME_MS = 16.7;

/**
 * The p90 a frame has to exceed for the ceiling to count, in milliseconds.
 *
 * Two refreshes by default, which is the number the row means. It is settable
 * because the ceiling's *confirmation* step cannot be exercised on a machine
 * fast enough to carry four hundred tracks inside the budget: the branch never
 * runs, and a mutation of it reads as a correction that stopped mattering
 * rather than one that was never tried. A tighter budget puts the branch back
 * on the path, and the mutation driver sets it for both sides of its
 * comparison.
 */
const FRAME_BUDGET_MS = Number(process.env.STRESS_FRAME_BUDGET ?? FRAME_MS * 2);

/**
 * A single section, for the probe mutation driver.
 *
 * The full matrix walks to four hundred tracks and takes minutes, which is not
 * something that can be run once per recorded probe correction. Each section
 * gates on this, so a mutation of the transport fuzz runs the transport fuzz.
 * Baseline and mutant are scoped identically, so the reduction cannot flatter
 * either of them.
 */
const SECTION_SCOPE = (process.env.STRESS_ONLY ?? '').split(',').filter(Boolean);
const section = (name) => SECTION_SCOPE.length === 0 || SECTION_SCOPE.includes(name);

const results = [];
const record = (name, value, unit, note = '') => {
  results.push({ name, value, unit, note });
  if (!JSON_ONLY) {
    const shown = typeof value === 'number' ? value.toFixed(Math.abs(value) >= 100 ? 0 : 2) : value;
    console.log(
      `  ${name.padEnd(32)} ${String(shown).padStart(9)} ${String(unit).padEnd(7)} ${note}`,
    );
  }
};
const fail = (name, why) => {
  record(name, 'FAIL', '', why);
  process.exitCode = 1;
};

const browser = await chromium.launch({
  ...(existsSync(preinstalled) ? { executablePath: preinstalled } : {}),
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    // Without these two the heap row is unreadable: usage is quantised to
    // 100 KB, and nothing can force a collection — so all two samples measure
    // is whether the collector happened to run between them.
    '--enable-precise-memory-info',
    '--js-flags=--expose-gc',
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(BASE);
await page.waitForSelector('[data-testid="app-root"]', { timeout: 20000 });
await page.waitForFunction(() => Boolean(window.__ml?.projectStore && window.__ml?.engine), null, {
  timeout: 20000,
});
// The engine is only real once its context is running; every measurement below
// is of an engine that has actually built its graph.
await page.evaluate(() => window.__ml.engine.start());

// ---------------------------------------------------------------- helpers

/**
 * Median, p90 and worst frame over `ms`.
 *
 * The median says what it feels like; the maximum says whether it stutters. A
 * mean hides the single long frame that is the only one a user notices.
 */
const frames = (ms) =>
  page.evaluate(async (duration) => {
    const gaps = [];
    let last = performance.now();
    const start = last;
    await new Promise((done) => {
      const tick = () => {
        const now = performance.now();
        gaps.push(now - last);
        last = now;
        if (now - start < duration) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    gaps.sort((a, b) => a - b);
    return {
      median: gaps[Math.floor(gaps.length / 2)] ?? 0,
      p90: gaps[Math.floor(gaps.length * 0.9)] ?? 0,
      max: gaps.at(-1) ?? 0,
    };
  }, ms);

/**
 * Heap after a forced collection, in bytes.
 *
 * Collected first and sampled second, so what is reported is what the app is
 * *holding* rather than what it has not got round to freeing. Retained growth
 * is a leak; uncollected garbage is not, and only one of those is worth a P1.
 */
const heldBytes = () =>
  page.evaluate(
    async (collections) => {
      if (!performance.memory || typeof window.gc !== 'function') return null;
      for (let i = 0; i < collections; i += 1) {
        window.gc();
        await new Promise((r) => setTimeout(r, 60));
      }
      return performance.memory.usedJSHeapSize;
    },
    unless('stress/forced-gc', 3, 0),
  );

// -------------------------------------------------------------- 1. scaling

if (section('scaling') && !JSON_ONLY) console.log('\nTrack and plugin scaling');
if (section('scaling')) {
  const ceiling = await page.evaluate(
    async ({ budget, bound, confirm }) => {
      const st = () => window.__ml.projectStore.getState();
      const kinds = ['compressor', 'eq', 'delay', 'reverb'];
      const sample = async () => {
        const gaps = [];
        let last = performance.now();
        const start = last;
        await new Promise((done) => {
          const tick = () => {
            const now = performance.now();
            gaps.push(now - last);
            last = now;
            if (now - start < 700) requestAnimationFrame(tick);
            else done();
          };
          requestAnimationFrame(tick);
        });
        gaps.sort((a, b) => a - b);
        return gaps[Math.floor(gaps.length * 0.9)] ?? 0;
      };
      const started = st().project.tracks.length;
      let added = 0;
      let inserts = 0;
      // How often the confirmation step disagreed with the first sample.
      //
      // Whether the confirmation *did* anything on a given run is a fact about
      // that run rather than about the code, so it is counted and reported. A
      // rejection count of zero means the ceiling would have been the same
      // without it, which is worth knowing before reading the ceiling as
      // evidence — and it is what tells a correction that stopped mattering
      // from one this host never gave a chance to matter.
      let rejected = 0;
      // Frame cost at two fixed loads, captured as the sweep passes them.
      //
      // The ceiling on its own is a threshold crossing, and a threshold crossing
      // measured from a noisy signal is bimodal: three runs of this reported 276,
      // 408, 276 — the same machine, the same build, flipping either side of the
      // budget. That is not a number a regression can be read off. These two are
      // fixed loads, so they are directly comparable between runs and it is these
      // that a P1 should be judged on; the ceiling stays because the directive
      // asks for it, and because a *large* move in it still means something.
      const marks = {};
      // Grown as a track plus three inserts, because an empty channel is not what
      // a session looks like and a ceiling measured on empty channels is a number
      // nobody could ever reach.
      //
      // The bound is 400 rather than 64: the first run of this stopped at its own
      // loop cap and reported that as the ceiling, which measures the harness.
      for (let i = 0; i < bound; i += 1) {
        const id = st().addTrack('audio');
        if (!id) break;
        added += 1;
        for (let k = 0; k < 3; k += 1)
          if (st().addEffect(id, kinds[k % kinds.length])) inserts += 1;
        // Sampled every fourth step: the frame probe costs 400 ms, and sampling
        // every step would put the sweep past ten minutes on its own.
        const total = started + added;
        if (total === 100 || total === 200) marks[total] = await sample();
        if (i % 4 === 3) {
          const p90 = await sample();
          // Confirmed before it counts: one over-budget sample is as likely to be
          // the machine as the app, and taking the first one is what made this
          // bimodal.
          if (p90 > budget) {
            if (!confirm) return { tracks: total, inserts, p90, marks, rejected, hitCap: false };
            if ((await sample()) > budget) {
              return { tracks: total, inserts, p90, marks, rejected, hitCap: false };
            }
            rejected += 1;
          }
        }
      }
      return {
        tracks: started + added,
        inserts,
        p90: await sample(),
        marks,
        rejected,
        hitCap: true,
      };
    },
    {
      budget: FRAME_BUDGET_MS,
      bound: unless('stress/loop-cap', 400, 64),
      confirm: unless('stress/confirmed-ceiling', true, false),
    },
  );

  record(
    'tracks at the frame ceiling',
    ceiling.tracks,
    'tracks',
    ceiling.hitCap
      ? `never exceeded ${FRAME_BUDGET_MS.toFixed(0)} ms p90 — the ceiling is above this`
      : `p90 ${ceiling.p90.toFixed(1)} ms`,
  );
  record('inserts at that point', ceiling.inserts, 'inserts', '');
  record(
    'ceiling candidates rejected',
    ceiling.rejected,
    'samples',
    ceiling.rejected === 0
      ? 'the confirmation changed nothing on this run'
      : 'first sample over budget, second not',
  );
  // The comparable pair. A regression shows here first and unambiguously.
  record('frame p90 at 100 tracks', ceiling.marks[100] ?? 0, 'ms', 'fixed load');
  record('frame p90 at 200 tracks', ceiling.marks[200] ?? 0, 'ms', 'fixed load');
  const f = await frames(1500);
  record(
    'frame median at ceiling',
    f.median,
    'ms',
    `p90 ${f.p90.toFixed(1)}, max ${f.max.toFixed(1)}`,
  );
}

// -------------------------------------------------------- 2. project scale

if (section('project-scale') && !JSON_ONLY) console.log('\nProject scale');
if (section('project-scale')) {
  const interaction = await page.evaluate(async () => {
    const worst = [];
    for (const tab of ['mixer', 'arrange', 'mixer', 'arrange']) {
      const t = performance.now();
      window.__ml.uiStore.getState().set({ editorTab: tab });
      // Two frames: one to commit React's render, one to be sure it painted.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      worst.push(performance.now() - t);
    }
    return Math.max(...worst);
  });
  record('worst tab switch to paint', interaction, 'ms', 'mixer <-> arrange at the ceiling');

  const saved = await page.evaluate(() => {
    const t = performance.now();
    const json = JSON.stringify(window.__ml.projectStore.getState().project);
    const round = JSON.parse(json);
    return { ms: performance.now() - t, bytes: json.length, tracks: round.tracks.length };
  });
  record(
    'project serialise + parse',
    saved.ms,
    'ms',
    `${(saved.bytes / 1024).toFixed(0)} KB, ${saved.tracks} tracks`,
  );
}

// ------------------------------------------------------- 3. transport fuzz

if (section('transport') && !JSON_ONLY) console.log('\nTransport fuzz');
if (section('transport')) {
  const fuzz = await page.evaluate(
    async ({ awaitOps, waitForQuiet }) => {
      const engine = window.__ml.engine;
      // A deterministic sequence: a failure nobody can replay is a rumour rather
      // than a bug. The seed is fixed and the operation is chosen from it.
      let seed = 0x5eed;
      const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      const ops = [];
      const t0 = performance.now();
      // Awaited, one per frame. The first version fired unawaited promises in a
      // tight loop and reported 284,000 operations per second — a measurement of
      // how fast a `for` loop discards promises, not of a transport.
      while (performance.now() - t0 < 6000) {
        const r = rnd();
        const at = performance.now();
        if (r < 0.28) engine.stop();
        else if (r < 0.56) {
          const started = engine.play();
          if (awaitOps) await started;
        } else if (r < 0.72) engine.togglePlay();
        else if (r < 0.86) engine.returnToStart();
        else engine.seek(rnd() * 128);
        ops.push(performance.now() - at);
        if (awaitOps) await new Promise((res) => requestAnimationFrame(res));
      }
      const elapsed = performance.now() - t0;
      engine.stop();
      // Waited for quiescence and timed, rather than slept on a fixed 500 ms.
      //
      // That fixed sleep reported "75 sources still running" and read as a leak.
      // It is not one: a voice already scheduled ahead has its stop clamped to
      // its own start time (`Math.max(at, when)` in `samplerInstrument.ts`), so a
      // transport stop cannot retire it earlier than the moment it was going to
      // begin. Under a loaded frame loop the lookahead reaches further ahead and
      // those retirements land well past half a second. The count does reach
      // zero; how long it takes is the number worth recording, and a probe that
      // sleeps for a guess reports a leak that is not there.
      const settleStart = performance.now();
      if (waitForQuiet) {
        while (window.__ml.activeSources() > 0 && performance.now() - settleStart < 20000) {
          await new Promise((r) => setTimeout(r, 50));
        }
      } else {
        // The guess this replaced. Half a second is not long enough for a voice
        // whose stop is clamped to its own start time, and what it reported was a
        // leak that is not there.
        await new Promise((r) => setTimeout(r, 500));
      }
      const settleMs = performance.now() - settleStart;
      ops.sort((a, b) => a - b);
      const voices = window.__ml.sustainingVoices ? window.__ml.sustainingVoices() : {};
      return {
        n: ops.length,
        perSec: (ops.length / elapsed) * 1000,
        p90: ops[Math.floor(ops.length * 0.9)] ?? 0,
        max: ops.at(-1) ?? 0,
        playing: engine.isPlaying(),
        sources: window.__ml.activeSources(),
        breakdown: window.__ml.activeSourceBreakdown ? window.__ml.activeSourceBreakdown() : {},
        held: Object.values(voices).reduce((a, b) => a + b, 0),
        position: window.__ml.position(),
        settleMs,
      };
    },
    {
      awaitOps: unless('stress/awaited-ops', true, false),
      waitForQuiet: unless('stress/quiescence', true, false),
    },
  );
  record('transport ops', fuzz.n, 'ops', `${fuzz.perSec.toFixed(0)}/s, one per frame`);
  record('worst op latency', fuzz.max, 'ms', `p90 ${fuzz.p90.toFixed(2)} ms`);
  // The number is recorded whether or not it passed. It was recorded only on
  // success, which meant the row vanished exactly when it was most worth
  // reading, and the mutation driver could not tell a failing run from a run
  // that had never measured.
  record(
    'time to quiescence',
    fuzz.settleMs,
    'ms',
    `${fuzz.sources} source(s) left, ${fuzz.held} voice(s) held`,
  );
  if (fuzz.playing) fail('transport settled', 'still playing after a final stop');
  else if (fuzz.sources > 0)
    fail(
      'transport settled',
      `${fuzz.sources} still running after 20 s: ${JSON.stringify(fuzz.breakdown)}`,
    );
  else if (fuzz.held > 0) fail('transport settled', `${fuzz.held} voices still held`);
  else record('transport settled', 0, 'left', '0 sources, 0 held');
}

// ------------------------------------------------------ 4. stuck-note fuzz

if (section('notes') && !JSON_ONLY) console.log('\nStuck-note fuzz');
if (section('notes')) {
  const notes = await page.evaluate(
    async (withDrumKit) => {
      const st = () => window.__ml.projectStore.getState();
      const engine = window.__ml.engine;
      // Every instrument the app can build, from the branch
      // `Engine.buildInstrument` actually takes rather than from a list: a synth
      // track, a drum track with no sampler params (a DrumKit), and a sampler.
      // `tests/stuckNotes.test.ts` proves that set is the whole set, and it is
      // the check that already caught this file listing three when there are
      // four classes.
      //
      // `setInstrument` takes the kind, and a `drum` *track* whose kind is
      // `synth` is the DrumKit — the class that has no kind string of its own and
      // that the first version of this sweep therefore never played a note to.
      const made = [];
      const build = (trackType, kind, what) => {
        const id = st().addTrack(trackType);
        if (!id) return;
        st().setInstrument(id, kind);
        made.push({ id, what });
      };
      build('instrument', 'synth', 'synth');
      if (withDrumKit) build('drum', 'synth', 'drum kit');
      build('instrument', 'quick', 'sampler/quick');
      build('drum', 'drum', 'sampler/drum');
      build('instrument', 'multi', 'sampler/multi');
      await new Promise((r) => setTimeout(r, 600));

      let seed = 0xbeef;
      const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      const down = new Map(made.map((m) => [m.id, new Set()]));
      let sent = 0;
      const t0 = performance.now();
      // Overlapping, repeated, out of order, with the pedal moving underneath. A
      // scale played politely proves nothing: a note-off matched to the wrong
      // voice still happens to land when only one note is ever down.
      while (performance.now() - t0 < 4000) {
        const target = made[Math.floor(rnd() * made.length)];
        const keys = down.get(target.id);
        if (rnd() < 0.55) {
          const pitch = 36 + Math.floor(rnd() * 48);
          engine.liveNoteOn(target.id, pitch, 40 + Math.floor(rnd() * 87));
          keys.add(pitch);
        } else if (keys.size) {
          const held = [...keys][Math.floor(rnd() * keys.size)];
          engine.liveNoteOff(target.id, held);
          keys.delete(held);
        }
        if (rnd() < 0.05) engine.setSustain(target.id, rnd() < 0.5);
        sent += 1;
        if (sent % 24 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      // Release every key still down and lift every pedal. What survives that is
      // a stuck note and nothing else.
      for (const m of made) {
        for (const p of down.get(m.id)) engine.liveNoteOff(m.id, p);
        engine.setSustain(m.id, false);
      }
      await new Promise((r) => setTimeout(r, 400));
      const held = window.__ml.sustainingVoices();
      return {
        sent,
        instruments: made.length,
        // Only the tracks this section built. `sustainingVoices()` answers for
        // every track in the project, so counting its keys reported eight
        // instruments where five were made — a number that cannot fall when an
        // instrument class is dropped, which is what it was being read for.
        covered: made.filter((m) => held[m.id] !== undefined).length,
        stuck: made.filter((m) => (held[m.id] ?? 0) > 0).map((m) => `${m.what}: ${held[m.id]}`),
      };
    },
    unless('stress/drumkit-branch', true, false),
  );
  record('note events', notes.sent, 'events', `across ${notes.instruments} instruments`);
  record('instruments driven', notes.instruments, 'classes', 'every branch buildInstrument takes');
  record('instruments answering', notes.covered, 'tracks', 'tracks with a live instrument');
  if (notes.instruments === 0) fail('stuck notes', 'no instrument tracks could be created');
  else if (notes.covered === 0) fail('stuck notes', 'no instrument reported a voice count');
  else if (notes.stuck.length) fail('stuck notes', notes.stuck.join('; '));
  else record('stuck notes', 0, 'held', 'every key released, every pedal up');
}

// ----------------------------------------------------- 5. long run / heap

if (section('sustained') && !JSON_ONLY) console.log('\nSustained run');
if (section('sustained')) {
  const before = await heldBytes();
  await page.evaluate(() => window.__ml.engine.play());
  const early = await frames(2500);
  await page.waitForTimeout(12000);
  const late = await frames(2500);
  await page.evaluate(() => window.__ml.engine.stop());
  const after = await heldBytes();
  record('frame median, first 2.5 s', early.median, 'ms', `max ${early.max.toFixed(1)}`);
  record('frame median, after 15 s', late.median, 'ms', `max ${late.max.toFixed(1)}`);
  record('frame-time drift', late.median - early.median, 'ms', 'late minus early');
  if (before === null || after === null) {
    record('retained heap growth', 'BLOCKED', '', 'no precise memory or no forced GC here');
  } else {
    record(
      'retained heap growth',
      (after - before) / 1024,
      'KB',
      `${(before / 1048576).toFixed(1)} -> ${(after / 1048576).toFixed(1)} MB, after forced GC`,
    );
  }
}

// ----------------------------------------------------------- 6. undo depth

if (section('undo') && !JSON_ONLY) console.log('\nUndo depth');
if (section('undo')) {
  const undo = await page.evaluate(() => {
    const st = () => window.__ml.projectStore.getState();
    const names = () =>
      st()
        .project.tracks.map((t) => t.name)
        .join('|');
    const pushed = 150;
    for (let i = 0; i < pushed; i += 1) st().addTrack('audio');
    const peak = st().project.tracks.length;
    let undone = 0;
    for (let i = 0; i < pushed; i += 1) {
      const n = st().project.tracks.length;
      st().undo();
      if (st().project.tracks.length !== n) undone += 1;
    }
    const floor = names();
    let redone = 0;
    for (let i = 0; i < undone; i += 1) {
      const n = st().project.tracks.length;
      st().redo();
      if (st().project.tracks.length !== n) redone += 1;
    }
    // Names and not counts: two different projects can hold the same number of
    // tracks, and a redo that restores the count while losing what was in them
    // is exactly the corruption this row exists for.
    return { pushed, peak, undone, redone, floor, end: names() };
  });
  record(
    'undo depth honoured',
    undo.undone,
    'steps',
    `of ${undo.pushed} pushed; the ring is bounded`,
  );
  record('redo steps honoured', undo.redone, 'steps', '');
  if (undo.redone !== undo.undone)
    fail('undo integrity', `${undo.undone} undone but ${undo.redone} redone`);
  else if (undo.undone > 0 && undo.end === undo.floor)
    fail('undo integrity', 'redo restored nothing');
  else record('undo integrity', 'ok', '', 'redo restored the names undo removed');
}

// ------------------------------------------------- 7. mobile interruptions

if (section('interruptions') && !JSON_ONLY) console.log('\nInterruptions');
if (section('interruptions')) {
  const survived = await page.evaluate(async () => {
    const engine = window.__ml.engine;
    await engine.play();
    // Backgrounding as a phone does it: hidden, pagehide, then back again.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    await new Promise((r) => setTimeout(r, 800));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
    engine.handleVisibilityResume?.();
    await new Promise((r) => setTimeout(r, 800));
    const running = engine.isRunning();
    engine.stop();
    await new Promise((r) => setTimeout(r, 300));
    return {
      running,
      held: Object.values(window.__ml.sustainingVoices()).reduce((a, b) => a + b, 0),
      sources: window.__ml.activeSources(),
    };
  });
  if (!survived.running) fail('survives backgrounding', 'the audio context did not come back');
  else if (survived.held > 0)
    fail('survives backgrounding', `${survived.held} voices held through it`);
  else record('survives backgrounding', 'ok', '', `context running, ${survived.sources} sources`);
}

// ------------------------------------------------------------- not run here

if (!JSON_ONLY) console.log('\nNot measurable on this host');
record(
  'audio dropout ceiling',
  'BLOCKED',
  '',
  'no audio device; xruns are not observable headless',
);
record(
  'per-device tiers',
  'BLOCKED',
  '',
  'no phone or tablet silicon — a desktop ceiling is not a tier',
);
record('force-quit mid-record', 'BLOCKED', '', 'needs a real OS kill, not a dispatched event');

if (pageErrors.length) fail('uncaught page errors', `${pageErrors.length}: ${pageErrors[0]}`);
else record('uncaught page errors', 0, 'errors', '');

await browser.close();
writeFileSync('stress-out.json', JSON.stringify(results, null, 2));

if (JSON_ONLY) {
  console.log(JSON.stringify(results, null, 2));
} else if (SECTION_SCOPE.length > 0) {
  console.log('\nScoped run: no PROGRESS row, which needs every section.');
} else {
  const v = (n) => results.find((r) => r.name === n)?.value;
  const num = (n, digits = 1) => {
    const x = v(n);
    return typeof x === 'number' ? x.toFixed(Math.abs(x) >= 100 ? 0 : digits) : String(x);
  };
  console.log('\nPROGRESS.md row:\n');
  console.log(
    `| ${process.env.STRESS_COMMIT ?? 'local'} | ` +
      `${num('frame p90 at 100 tracks')} / ${num('frame p90 at 200 tracks')} ms | ` +
      `${num('tracks at the frame ceiling')} tk / ${num('inserts at that point')} fx | ` +
      `${num('transport ops')} ops, quiet in ${num('time to quiescence')} ms | ` +
      `${num('note events')} notes, ${v('stuck notes')} stuck | ` +
      `${num('frame median, after 15 s')} ms, drift ${num('frame-time drift')} | ` +
      `${num('retained heap growth', 0)} KB | ` +
      `${num('worst tab switch to paint')} ms | ` +
      `${num('undo depth honoured')}/${num('redo steps honoured')} ${v('undo integrity')} | ` +
      `${v('survives backgrounding')} |`,
  );
}

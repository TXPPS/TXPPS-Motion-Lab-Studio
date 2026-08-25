/**
 * Transport and note fuzz — the two sections that hunt for a stuck state.
 *
 * Both had the same defect and it is worth stating once: an operation that is
 * fired and not awaited is not an operation performed. The transport fuzz
 * reported 284,000 operations per second, which is the rate at which a `for`
 * loop can discard promises, and the real figure is three hundred and sixty
 * one. Every operation here is awaited and paced to a frame.
 */
import { JSON_ONLY, section, record, fail } from './harness.mjs';
import { unless } from '../probe-mutant.mjs';

/** @param page the one page every section shares. */
export async function run(page) {
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
    record(
      'instruments driven',
      notes.instruments,
      'classes',
      'every branch buildInstrument takes',
    );
    record('instruments answering', notes.covered, 'tracks', 'tracks with a live instrument');
    if (notes.instruments === 0) fail('stuck notes', 'no instrument tracks could be created');
    else if (notes.covered === 0) fail('stuck notes', 'no instrument reported a voice count');
    else if (notes.stuck.length) fail('stuck notes', notes.stuck.join('; '));
    else record('stuck notes', 0, 'held', 'every key released, every pedal up');
  }
}

/**
 * Layer 4 — keep going, and watch what drifts.
 *
 * Directive 11 §3. The first three layers each finish in a minute or two, and
 * everything they can find is a fault that shows up quickly. This is for the
 * other kind: the heap that grows a megabyte a minute, the frame time that
 * creeps, the voice count that never quite returns to zero, the transport that
 * loses the grid after an hour. Nobody notices any of those in a two-minute
 * test, and a musician working for an afternoon notices all of them.
 *
 * Every number is sampled repeatedly and reported as a **trend**, because a
 * single reading at the end cannot tell a leak from a busy moment. What matters
 * is the slope: a heap that ends higher than it started is uninteresting; a
 * heap that rises monotonically across eight samples is a leak.
 *
 * The heap is read after forced collection, for the reason recorded in
 * `stress.mjs` — the first version of that harness reported a heap that had
 * shrunk by 79 MB, which is a measurement of the garbage collector rather than
 * of the product.
 */

/** Default run length. Long enough for a slope, short enough to run. */
export const DEFAULT_MINUTES = 10;

/**
 * Play, edit, and sample.
 *
 * Editing while playing rather than either alone, because that is the state a
 * session is actually in and because the interesting failures are in the
 * interaction: rebuilding a graph node under a running transport is where a
 * source gets orphaned.
 */
export async function runEndurance(page, { minutes = DEFAULT_MINUTES, samples = 8 } = {}) {
  const perSample = Math.max(1, Math.round((minutes * 60000) / samples));
  const readings = [];

  await page.evaluate(() => {
    window.__ml.projectStore.getState().setProject(structuredClone(window.__soakBaseline));
  });

  const sample = () =>
    page.evaluate(async () => {
      // Frame gaps over three quarters of a second. The median says how it
      // feels; the maximum says whether it stutters, and a mean hides the one
      // long frame that is the only one a user notices.
      const gaps = [];
      let last = performance.now();
      const start = last;
      await new Promise((done) => {
        const tick = () => {
          const now = performance.now();
          gaps.push(now - last);
          last = now;
          if (now - start < 750) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      });
      gaps.sort((a, b) => a - b);
      let heap = null;
      if (performance.memory && typeof window.gc === 'function') {
        for (let i = 0; i < 3; i += 1) {
          window.gc();
          await new Promise((r) => setTimeout(r, 60));
        }
        heap = performance.memory.usedJSHeapSize;
      }
      const held = window.__ml.sustainingVoices ? window.__ml.sustainingVoices() : {};
      return {
        median: gaps[Math.floor(gaps.length / 2)] ?? 0,
        p90: gaps[Math.floor(gaps.length * 0.9)] ?? 0,
        max: gaps.at(-1) ?? 0,
        heap,
        sources: window.__ml.activeSources(),
        held: Object.values(held).reduce((a, b) => a + b, 0),
        position: window.__ml.position(),
        tracks: window.__ml.projectStore.getState().project.tracks.length,
      };
    });

  await page.evaluate(() => window.__ml.engine.play());
  readings.push({ at: 0, ...(await sample()) });

  for (let i = 1; i <= samples; i += 1) {
    // A slice of editing, then a slice of just playing. The edits are the same
    // handful repeated rather than the fuzzer's vocabulary: this layer is about
    // drift under a steady load, and a random load would make every sample a
    // different experiment.
    await page.evaluate(
      async (ms) => {
        const st = () => window.__ml.projectStore.getState();
        const until = performance.now() + ms;
        let n = 0;
        while (performance.now() < until) {
          const id = st().addTrack('instrument');
          st().setInstrument(id, 'synth');
          st().addEffect(id, 'compressor');
          const clip = st().addMidiClip(id, (n % 16) * 4, 4);
          window.__ml.engine.liveNoteOn(id, 48 + (n % 24), 100);
          await new Promise((r) => setTimeout(r, 40));
          window.__ml.engine.liveNoteOff(id, 48 + (n % 24));
          st().deleteClip(clip);
          st().deleteTrack(id);
          n += 1;
          await new Promise((r) => setTimeout(r, 60));
        }
        return n;
      },
      Math.round(perSample * 0.6),
    );
    await page.waitForTimeout(Math.round(perSample * 0.4));
    readings.push({ at: i, ...(await sample()) });
  }

  await page.evaluate(() => window.__ml.engine.stop());
  // Wait for quiescence and time it, rather than sleeping on a guess. A voice
  // scheduled ahead has its stop clamped to its own start, so a fixed sleep
  // reports a leak that is not there — the same defect `stress.mjs` records.
  const settle = await page.evaluate(async () => {
    const start = performance.now();
    while (window.__ml.activeSources() > 0 && performance.now() - start < 20000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return { ms: performance.now() - start, left: window.__ml.activeSources() };
  });

  return { readings, settle, minutes, findings: verdicts(readings, settle, minutes) };
}

/**
 * The trends, judged.
 *
 * A slope rather than an endpoint. Monotone growth across every sample is a
 * leak; a higher last reading than first is a busy moment, and calling the
 * second one a leak is how a P1 gets raised against the garbage collector.
 */
function verdicts(readings, settle, minutesRun) {
  const out = [];
  const heaps = readings.map((r) => r.heap).filter((h) => typeof h === 'number');
  if (heaps.length < 3) {
    out.push({
      id: 'heap trend',
      state: 'BLOCKED',
      why: 'no precise memory or no forced collection on this host',
    });
  } else {
    // Warm-up and slope, reported separately, because the first is not a leak.
    //
    // A ten-minute run rose 15.4 MB to 21.8 MB over its first two samples and
    // then sat at 22 MB: caches filling, samples decoded, impulse responses
    // rendered. Judging on the total called that a monotone leak. What a leak
    // actually looks like is a *tail* that keeps climbing after everything is
    // warm, so the first third is reported and not judged.
    const warm = Math.max(1, Math.floor(heaps.length / 3));
    const tail = heaps.slice(warm);
    const minutes = (minutesRun * (tail.length - 1)) / (heaps.length - 1);
    const slopeKbPerMin = minutes > 0 ? (tail.at(-1) - tail[0]) / 1024 / minutes : 0;
    out.push({
      id: 'heap warm-up',
      state: 'PASS',
      why: `${((heaps[warm] - heaps[0]) / 1024).toFixed(0)} KB before the first ${warm} sample(s) settled`,
    });
    // 512 KB a minute, derived rather than fitted: eight hours is a working
    // day, 256 MB is about as much as a tab can accumulate before a phone
    // starts evicting it, and 256 MB over 480 minutes is 533 KB a minute.
    out.push({
      id: 'heap slope after warm-up',
      state: slopeKbPerMin > 512 ? 'FAIL' : 'PASS',
      why: `${slopeKbPerMin.toFixed(0)} KB/min across ${tail.length} samples — ${((slopeKbPerMin * 480) / 1024).toFixed(0)} MB over an eight-hour session`,
    });
  }
  const medians = readings.map((r) => r.median);
  const drift = medians.at(-1) - medians[0];
  out.push({
    id: 'frame time drift',
    state: drift > 8 ? 'FAIL' : 'PASS',
    why: `median ${medians[0].toFixed(1)} to ${medians.at(-1).toFixed(1)} ms`,
  });
  const worst = Math.max(...readings.map((r) => r.max));
  out.push({
    id: 'worst frame',
    state: worst > 250 ? 'FAIL' : 'PASS',
    why: `${worst.toFixed(0)} ms`,
  });
  out.push({
    id: 'voices retired',
    state: settle.left === 0 ? 'PASS' : 'FAIL',
    why: `${settle.left} source(s) left after ${settle.ms.toFixed(0)} ms`,
  });
  const held = readings.at(-1).held;
  out.push({
    id: 'no notes stuck',
    state: held === 0 ? 'PASS' : 'FAIL',
    why: `${held} voice(s) held at the end`,
  });
  const leaked = readings.at(-1).tracks - readings[0].tracks;
  out.push({
    id: 'tracks balanced',
    state: leaked === 0 ? 'PASS' : 'FAIL',
    why: `${leaked} track(s) left over from ${readings.length - 1} add/delete cycles`,
  });
  return out;
}

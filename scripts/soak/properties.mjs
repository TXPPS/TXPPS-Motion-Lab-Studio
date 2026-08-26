/**
 * Layer 3 — the things that must hold for *every* input, not for an example.
 *
 * Directive 11 §3. An example test says "undoing this add restores this state".
 * A property says "undoing any undoable action restores the state it was
 * invoked from", and the difference is the action nobody wrote an example for.
 * Each property below is checked against inputs drawn from a seed, so a failure
 * arrives with the input that caused it rather than as a mood.
 *
 * These are behavioural where layer 2's invariants are structural. The fuzzer
 * asks whether the project is still well-formed; this asks whether the product
 * still means what it says — that a saved project is the project, that undo is
 * an inverse, that automation reads back what was written, that a bypassed
 * insert is out of the path.
 *
 * **The last of those is the one that has already been wrong, twice, in
 * opposite directions.** "Bypass makes the render identical" was first assumed,
 * asserted, and false — a three-band crossover summed flat is not a wire — so
 * it was weakened to "bypass is closer to dry than the active unit is", which
 * was checkable and true and far too weak to catch what was actually there.
 *
 * What was actually there: fifteen of the thirty-four inserts made the track √2
 * louder while bypassed, by changing its channel count and so which pan law its
 * `StereoPannerNode` applied. `InsertChain` now routes a bypassed insert around
 * itself instead of trusting it to be transparent, which makes the *strong*
 * form true — so the strong form is what is asserted here, at full resolution
 * and on the track alone. A property weakened to fit an implementation has
 * stopped being a check on it; the right response to one that fails is to find
 * out why, and only then to decide which of the two was wrong.
 */

/** Every property, as a name and a body that returns null or a reason. */
export const PROPERTIES = [
  {
    id: 'save-round-trip',
    what: 'a project saved and reloaded is the same project',
    body: async ({ seed }) => {
      const st = () => window.__ml.projectStore.getState();
      const rnd = window.__soakRnd(seed);
      // Not the fixture as-is: a round trip that only ever sees the same shape
      // proves the shape, not the codec. Twelve random edits first.
      for (let i = 0; i < 12; i += 1) {
        const t = st().project.tracks[Math.floor(rnd() * st().project.tracks.length)];
        if (!t) continue;
        if (rnd() < 0.4) st().addEffect(t.id, 'delay');
        else if (rnd() < 0.7) st().addAutomationLane(t.id, 'volume');
        else st().addMidiClip(t.id, Math.floor(rnd() * 32), 2);
      }
      const before = JSON.stringify(st().project);
      st().setProject(JSON.parse(before));
      const after = JSON.stringify(st().project);
      if (before !== after) {
        for (let i = 0; i < Math.min(before.length, after.length); i += 1) {
          if (before[i] !== after[i]) {
            return `diverges at byte ${i}: ${before.slice(i - 40, i + 40)} vs ${after.slice(i - 40, i + 40)}`;
          }
        }
        return `lengths differ: ${before.length} vs ${after.length}`;
      }
      return null;
    },
  },
  {
    id: 'load-is-idempotent',
    what: 'opening a project the loader has already opened changes nothing further',
    body: async ({ seed }) => {
      const st = () => window.__ml.projectStore.getState();
      const repo = window.__ml.projectRepo;
      if (!repo) return 'the page does not publish the persistence boundary';
      const rnd = window.__soakRnd(seed);
      // `validateProject` drops what it cannot read, so a round trip is not
      // expected to be the identity — a lane naming a parameter that no longer
      // exists is *supposed* to disappear. What must hold is that it settles:
      // opening the result again drops nothing more. A loader that keeps taking
      // something away on every open is one that eats a project over a week of
      // saves, and nobody would ever catch it in one sitting.
      for (let i = 0; i < 10; i += 1) {
        const t = st().project.tracks[Math.floor(rnd() * st().project.tracks.length)];
        if (t) {
          if (rnd() < 0.5) st().addAutomationLane(t.id, rnd() < 0.5 ? 'volume' : 'pan');
          else st().addEffect(t.id, 'delay');
        }
      }
      const once = repo.validateProject(JSON.parse(JSON.stringify(st().project)));
      const twice = repo.validateProject(JSON.parse(JSON.stringify(once)));
      const a = JSON.stringify(once);
      const b = JSON.stringify(twice);
      if (a !== b)
        return `the loader is still removing things on the second open: ${a.length} then ${b.length} bytes`;
      return null;
    },
  },
  {
    id: 'load-keeps-automation',
    what: 'opening a project does not drop an automation lane it can read',
    body: async () => {
      const st = () => window.__ml.projectStore.getState();
      const repo = window.__ml.projectRepo;
      if (!repo) return 'the page does not publish the persistence boundary';
      // `paramIdExists` is deliberately wide because it is the predicate lanes
      // are *dropped* by, and narrowing it deletes a user's automation on the
      // next save. This is that comment as an assertion.
      const track = st().project.tracks[0];
      st().addAutomationLane(track.id, 'volume');
      const lane = st().project.tracks.find((t) => t.id === track.id).automation[0];
      st().addAutomationPoint(track.id, lane.id, 4, 0.75);
      const before = st().project.tracks.reduce((n, t) => n + (t.automation ?? []).length, 0);
      const loaded = repo.validateProject(JSON.parse(JSON.stringify(st().project)));
      const after = loaded.tracks.reduce((n, t) => n + (t.automation ?? []).length, 0);
      if (after < before) return `${before} lane(s) went in, ${after} came out`;
      return null;
    },
  },
  {
    id: 'undo-inverts',
    what: 'undo restores the state an undoable action was invoked from',
    body: async ({ seed }) => {
      const st = () => window.__ml.projectStore.getState();
      const rnd = window.__soakRnd(seed);
      const actions = [
        () => st().addTrack('audio'),
        () => st().addMidiClip(st().project.tracks[0].id, 4, 4),
        () => st().addEffect(st().project.tracks[0].id, 'reverb'),
        () => st().setTrack(st().project.tracks[0].id, { name: 'p' + Math.floor(rnd() * 99) }),
        () =>
          st().update((d) => {
            d.bpm = 60 + Math.floor(rnd() * 120);
          }),
      ];
      for (let i = 0; i < 24; i += 1) {
        const before = JSON.stringify(st().project);
        actions[Math.floor(rnd() * actions.length)]();
        const changed = JSON.stringify(st().project);
        if (changed === before) continue;
        st().undo();
        const back = JSON.stringify(st().project);
        if (back !== before)
          return `iteration ${i}: undo left ${back.length} bytes, was ${before.length}`;
      }
      return null;
    },
  },
  {
    id: 'redo-inverts-undo',
    what: 'redo restores what undo removed',
    body: async () => {
      const st = () => window.__ml.projectStore.getState();
      for (let i = 0; i < 12; i += 1) {
        st().addTrack('audio');
        const done = JSON.stringify(st().project);
        st().undo();
        st().redo();
        const again = JSON.stringify(st().project);
        if (again !== done) return `iteration ${i}: redo did not restore the added track`;
      }
      return null;
    },
  },
  {
    id: 'automation-reads-back',
    what: 'an automation point reads back the value it was written with',
    body: async ({ seed }) => {
      const st = () => window.__ml.projectStore.getState();
      const rnd = window.__soakRnd(seed);
      const track = st().project.tracks[0];
      st().addAutomationLane(track.id, 'volume');
      const lane = st().project.tracks.find((t) => t.id === track.id).automation[0];
      for (let i = 0; i < 16; i += 1) {
        const beat = Math.round(rnd() * 6400) / 100;
        const value = Math.round(rnd() * 10000) / 10000;
        st().addAutomationPoint(track.id, lane.id, beat, value);
        const now = st().project.tracks.find((t) => t.id === track.id).automation[0];
        const point = now.points.find((p) => Math.abs(p.beat - beat) < 1e-6);
        if (!point) return `point at beat ${beat} was written and is not there`;
        if (Math.abs(point.value - value) > 1e-6) {
          return `beat ${beat}: wrote ${value}, read ${point.value}`;
        }
      }
      return null;
    },
  },
  {
    id: 'a-bypassed-insert-is-a-wire',
    what: 'every bypassed insert renders exactly what no insert renders',
    body: async () => {
      const w = window;
      const { renderProject, preloadForRender } = w.__ml.exportMix;
      const st = () => w.__ml.projectStore.getState();
      const render = async (kind) => {
        st().setProject(structuredClone(w.__soakBaseline));
        const track = st().project.tracks.find((t) => t.type === 'instrument');
        // The track alone. Measured across the whole mix, the √2 this is
        // watching for arrives diluted to 1.0331 by every track that did not
        // change — a number that matches no clean hypothesis, and against which
        // two wrong guesses were tried and reverted before anyone localised it.
        for (const t of st().project.tracks.slice()) {
          if (t.id !== track.id) st().deleteTrack(t.id);
        }
        if (kind) {
          st().addEffect(track.id, kind);
          const fx = st()
            .project.tracks.find((x) => x.id === track.id)
            .effects.at(-1);
          st().setEffectBypass(track.id, fx.id, true);
        }
        await preloadForRender(
          st().project,
          w.__ml.engine.context ?? new OfflineAudioContext(1, 1, 44100),
        );
        const res = await renderProject(st().project, {
          range: { startBeat: 0, endBeat: 4 },
          sampleRate: 44100,
          tailSeconds: 0,
        });
        // Every sample. This took every eighth, which is a decimation with no
        // anti-alias filter in front of it: a difference above 2.7 kHz would
        // have been folded down to somewhere it is not, and the number it
        // produced was one nobody could have acted on either way.
        return Array.from(res.buffer.getChannelData(0));
      };
      const dist = (a, b) => {
        const n = Math.min(a.length, b.length);
        let s = 0;
        for (let i = 0; i < n; i += 1) s += (a[i] - b[i]) ** 2;
        return Math.sqrt(s / n);
      };
      const rms = (a) => Math.sqrt(a.reduce((t, x) => t + x * x, 0) / a.length);
      const dry = await render(null);
      // The floor two identical renders reach, measured rather than assumed.
      // It is about 2e-7 and it is what makes 1.6e-2 legible as a fault.
      const floor = Math.max(dist(dry, await render(null)) * 8, 1e-6);
      const dryLevel = rms(dry);
      const leaks = [];
      for (const kind of w.__ml.effectKinds ?? []) {
        const got = await render(kind);
        const d = dist(dry, got);
        // The level is reported beside the distance because it is the number
        // that names the mechanism: ×1.414214 is the mono/stereo pan-law step
        // and nothing else in this graph produces it.
        if (d > floor) {
          leaks.push(`${kind} ${d.toExponential(3)} at x${(rms(got) / dryLevel).toFixed(6)}`);
        }
      }
      if (leaks.length > 0) {
        return `${leaks.length} of ${(w.__ml.effectKinds ?? []).length} inserts change the render while bypassed (floor ${floor.toExponential(1)}): ${leaks.join(', ')}`;
      }
      return null;
    },
  },
  {
    id: 'gain-is-monotonic',
    what: 'raising a track fader never lowers the rendered level',
    body: async () => {
      const w = window;
      const { renderProject, preloadForRender } = w.__ml.exportMix;
      const st = () => w.__ml.projectStore.getState();
      const levels = [];
      for (const volume of [0.2, 0.4, 0.6, 0.8, 1.0]) {
        st().setProject(structuredClone(w.__soakBaseline));
        const track = st().project.tracks.find((t) => t.type === 'instrument');
        st().setTrack(track.id, { volume });
        await preloadForRender(
          st().project,
          w.__ml.engine.context ?? new OfflineAudioContext(1, 1, 44100),
        );
        const res = await renderProject(st().project, {
          range: { startBeat: 0, endBeat: 4 },
          sampleRate: 44100,
          tailSeconds: 0,
        });
        const d = res.buffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < d.length; i += 1) sum += d[i] * d[i];
        levels.push(Math.sqrt(sum / d.length));
      }
      for (let i = 1; i < levels.length; i += 1) {
        // A tolerance, not equality: the render is not bit-identical run to run
        // and a strictly-greater test on floating point noise fails on a level
        // that did not move.
        if (levels[i] < levels[i - 1] - 1e-6) {
          return `level fell from ${levels[i - 1].toExponential(3)} to ${levels[i].toExponential(3)} as the fader rose`;
        }
      }
      if (levels[levels.length - 1] <= levels[0]) {
        return `the fader did nothing: ${levels.map((l) => l.toExponential(2)).join(' ')}`;
      }
      return null;
    },
  },
  {
    id: 'a-bounce-is-in-time',
    what: 'a latency-declaring insert moves nothing in the bounce, wherever it lands',
    body: async ({ seed, active }) => {
      const w = window;
      const { renderProject, preloadForRender } = w.__ml.exportMix;
      const st = () => w.__ml.projectStore.getState();
      // PA-010 was fixed in the live engine and not in `exportMix`, so a project
      // with a limiter on one track was monitored in phase and bounced out of
      // it. `e2e/bouncealignment.spec.ts` states that as an example on two
      // tracks; this states it for whatever the fixture is, with the insert
      // wherever the seed puts it.
      //
      // The probe insert is a saturator at zero mix, and that is what lets this
      // be a property rather than an example. Its dry leg is delayed by the same
      // constant as its wet one, so at mix 0 it is a pure 192-sample delay and
      // nothing else: the render before and the render after are the same audio,
      // moved or not moved, whatever else the project contains. Every other
      // latency-declaring insert also changes the sound, and then a difference
      // could always be argued to be the sound.
      const pick = w.__soakRnd(seed)();
      // `probe-mutant.mjs`'s predicate, rebuilt: see `runProperties` for why it
      // cannot be imported. `npm run probe:mutations --check` matches on the
      // call sites below, so the name has to be this one.
      const mutated = (id) => id === active;
      const render = async (withInsert) => {
        st().setProject(structuredClone(w.__soakBaseline));
        // A track that will actually sound over the measured bars. Isolating a
        // channel whose clips all start after bar 4 renders silence, and a
        // correlation over silence has no peak to find — the guard below says
        // so rather than passing, and this is what stops it having to.
        const project = st().project;
        const sounds = !mutated('soak/bounce-target-has-content');
        const tracks = project.tracks.filter(
          (t) =>
            (t.type === 'instrument' || t.type === 'drum' || t.type === 'audio') &&
            (!sounds || project.clips.some((c) => c.trackId === t.id && c.start < 4)),
        );
        const target = tracks[Math.floor(pick * tracks.length)];
        // The track alone, for the reason the bypass property records: a shift
        // measured across the mix is diluted by every channel that did not
        // move, and the correlator then reports a peak somewhere between them.
        // Measured across the mix this read 4 samples and failed; isolated it
        // is inside tolerance on every seed tried, including that one. The
        // bypass property learned the same thing about the same graph — a mix
        // diluted its x1.414214 to 1.0331.
        if (!mutated('soak/bounce-isolate-track')) {
          for (const t of st().project.tracks.slice()) {
            if (t.id !== target?.id) st().deleteTrack(t.id);
          }
        }
        if (withInsert && target) {
          const id = st().addEffect(target.id, 'saturator');
          st().setEffectParam(target.id, id, 'mix', 0);
          st().setEffectParam(target.id, id, 'drive', 0);
          st().setEffectParam(target.id, id, 'output', 0);
        }
        await preloadForRender(
          st().project,
          w.__ml.engine.context ?? new OfflineAudioContext(1, 1, 44100),
        );
        return renderProject(st().project, {
          range: { startBeat: 0, endBeat: 4 },
          sampleRate: 44100,
          tailSeconds: 0,
        });
      };
      const before = await render(false);
      const after = await render(true);
      if (before.peak < 0.005 || after.peak < 0.005) {
        return `a render is silent (${before.peak.toExponential(2)}, ${after.peak.toExponential(2)}), so nothing was measured`;
      }
      // Not vacuous: the insert has to actually be in a chain that declares.
      // Without this the property passes when the target track was undefined,
      // which is exactly the shape a seeded draw fails in.
      if (after.pdcSamples === 0) {
        return 'the probe insert declared no latency, so this measured nothing';
      }
      // A normalised cross-correlation, argmax over integer lags. Normalised
      // because an insert may legitimately change the level, and a raw
      // correlation would then report the louder alignment rather than the
      // right one.
      const lagOf = (a, b) => {
        const from = 4410;
        const len = 22050;
        let best = 0;
        let bestScore = -Infinity;
        for (let lag = -600; lag <= 600; lag += 1) {
          let dot = 0;
          let na = 0;
          let nb = 0;
          for (let i = 0; i < len; i += 1) {
            const x = a[from + i] ?? 0;
            const y = b[from + i + lag] ?? 0;
            dot += x * y;
            na += x * x;
            nb += y * y;
          }
          const score = dot / (Math.sqrt(na * nb) + 1e-12);
          if (score > bestScore) {
            bestScore = score;
            best = lag;
          }
        }
        return -best;
      };
      const moved = [];
      for (let c = 0; c < Math.min(before.channels, after.channels); c += 1) {
        const lag = lagOf(before.buffer.getChannelData(c), after.buffer.getChannelData(c));
        if (Math.abs(lag) > 3) moved.push(`channel ${c} by ${lag} sample(s)`);
      }
      if (moved.length > 0) {
        return `the bounce moved: ${moved.join(', ')} (compensation reported ${after.pdcSamples})`;
      }
      return null;
    },
  },
  {
    id: 'delete-track-takes-its-clips',
    what: 'deleting a track leaves no clip pointing at it',
    body: async ({ seed }) => {
      const st = () => window.__ml.projectStore.getState();
      const rnd = window.__soakRnd(seed);
      for (let i = 0; i < 10; i += 1) {
        const id = st().addTrack('instrument');
        for (let k = 0; k < 3; k += 1) st().addMidiClip(id, Math.floor(rnd() * 16), 2);
        st().deleteTrack(id);
        const orphans = st().project.clips.filter((c) => c.trackId === id);
        if (orphans.length > 0) return `${orphans.length} clip(s) survived their track`;
      }
      return null;
    },
  },
];

/** Run every property against a fresh fixture, returning one row each. */
export async function runProperties(page, seed) {
  /**
   * Which recorded defect, if any, this run is asked to plant.
   *
   * The other probes call `mutated()` from `probe-mutant.mjs` directly. These
   * bodies are serialised into the page by `page.evaluate`, so nothing they
   * close over exists there — the id crosses as an argument and each body
   * rebuilds the same predicate from it.
   */
  const active = process.env.MW_PROBE_MUTATION ?? '';
  await page.evaluate(() => {
    // Shared by the property bodies so every draw comes from the run's seed.
    window.__soakRnd = (s) => {
      let state = s >>> 0;
      return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
      };
    };
  });
  const rows = [];
  for (const property of PROPERTIES) {
    await page.evaluate(() => {
      window.__ml.projectStore.getState().setProject(structuredClone(window.__soakBaseline));
    });
    let why = null;
    try {
      why = await page.evaluate(property.body, { seed, active });
    } catch (e) {
      why = `threw: ${String(e).slice(0, 200)}`;
    }
    rows.push({ id: property.id, what: property.what, state: why ? 'FAIL' : 'PASS', why });
  }
  return rows;
}

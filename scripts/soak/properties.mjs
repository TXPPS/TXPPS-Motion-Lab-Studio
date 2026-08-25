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
 * **The last of those is the one that has already been wrong.** "Bypass makes
 * the render identical" was assumed, asserted, and false: a three-band
 * crossover is not transparent at unity, so the honest property is that bypass
 * is *closer to dry than the active unit is*, which is checkable and true.
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
        if (kind) {
          st().addEffect(track.id, kind);
          const fx = st()
            .project.tracks.find((x) => x.id === track.id)
            .effects.at(-1);
          st().setEffectBypass(track.id, fx.id, true);
        }
        await preloadForRender(st().project);
        const res = await renderProject(st().project, {
          range: { startSec: 0, endSec: 2 },
          sampleRate: 44100,
          tailSeconds: 0,
        });
        const d = res.buffer.getChannelData(0);
        const o = [];
        for (let i = 0; i < d.length; i += 8) o.push(d[i]);
        return o;
      };
      const dist = (a, b) => {
        const n = Math.min(a.length, b.length);
        let s = 0;
        for (let i = 0; i < n; i += 1) s += (a[i] - b[i]) ** 2;
        return Math.sqrt(s / n);
      };
      const dry = await render(null);
      // The floor two identical renders reach, measured rather than assumed.
      // It is about 2e-7 and it is what makes 1.6e-2 legible as a fault.
      const floor = Math.max(dist(dry, await render(null)) * 8, 1e-6);
      const leaks = [];
      for (const kind of w.__ml.effectKinds ?? []) {
        const d = dist(dry, await render(kind));
        if (d > floor) leaks.push(`${kind} ${d.toExponential(3)}`);
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
        await preloadForRender(st().project);
        const res = await renderProject(st().project, {
          range: { startSec: 0, endSec: 2 },
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
      why = await page.evaluate(property.body, { seed });
    } catch (e) {
      why = `threw: ${String(e).slice(0, 200)}`;
    }
    rows.push({ id: property.id, what: property.what, state: why ? 'FAIL' : 'PASS', why });
  }
  return rows;
}

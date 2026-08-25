/**
 * Layer 2 — ten thousand steps of nonsense, and the invariants checked after
 * every one.
 *
 * Directive 11 §3. A functional sweep proves each action works when it is the
 * only thing happening. A fuzzer proves they still work in combination, which
 * is where a DAW actually breaks: delete the track a clip is on while the clip
 * is selected and the transport is running and an automation lane is open.
 *
 * **The seed is the whole product.** A failure nobody can replay is a rumour,
 * so the step sequence is a pure function of one 32-bit number and nothing in
 * it reads the clock, the pointer or `Math.random`. Given a seed, the same run
 * happens again — which is what makes shrinking possible, and shrinking is what
 * turns "it broke somewhere in ten thousand steps" into something a person can
 * read.
 *
 * The shrink is a prefix bisection followed by a delta pass:
 *
 *  - **Prefix.** Binary search for the shortest prefix that still fails. Every
 *    replay is from a fresh fixture, so a prefix means what it says.
 *  - **Delta.** Then try removing each remaining step one at a time, keeping any
 *    removal that still fails. A four-step reproduction usually falls out of a
 *    two-hundred-step prefix, and the difference between those two is whether
 *    anybody reads it.
 *
 * The invariants are structural rather than behavioural on purpose. "Does it
 * sound right" is not checkable after an arbitrary step sequence; "does every
 * clip still name a track that exists" is, and it is the class of corruption
 * that survives a save and comes back as a project that will not open.
 */

/** How many steps a full run takes. §3 asks for ten thousand. */
export const DEFAULT_STEPS = 10000;

/**
 * The whole step vocabulary, as data.
 *
 * Weighted so the destructive operations are common: a fuzzer that spends its
 * budget nudging volume sliders is a fuzzer that will not find the crash. Each
 * step is a name and a body run in the page, taking the step's own random draw
 * so the sequence stays a pure function of the seed.
 */
export const STEP_NAMES = [
  'addTrack',
  'deleteTrack',
  'duplicateTrack',
  'renameTrack',
  'setTrackGain',
  'addClip',
  'moveClip',
  'resizeClip',
  'deleteClip',
  'duplicateClip',
  'splitClip',
  'addEffect',
  'removeEffect',
  'bypassEffect',
  'setEffectParam',
  'addAutomationLane',
  'addAutomationPoint',
  'setInstrument',
  'selectTrack',
  'selectClip',
  'setEditorTab',
  'transportPlay',
  'transportStop',
  'transportSeek',
  'setBpm',
  'undo',
  'redo',
  'saveAndReload',
];

/**
 * Run `steps` steps from `seed`, stopping at the first invariant that breaks.
 *
 * Everything happens inside one `page.evaluate` rather than one round-trip per
 * step. Ten thousand round-trips is about twenty minutes of protocol overhead
 * and nothing else, which would make the layer too slow to run and therefore
 * never run — the same reason the reachability sweep checks every target in one
 * call.
 */
export async function replay(page, { seed, steps, only = null }) {
  return page.evaluate(
    async ({ seed, steps, only, names }) => {
      const st = () => window.__ml.projectStore.getState();
      const ui = () => window.__ml.uiStore.getState();
      const engine = window.__ml.engine;

      /**
       * One draw stream per step, derived from the seed and the step's index.
       *
       * A single shared stream is the obvious design and it makes the shrink a
       * lie. Every step consumes a different number of draws, so replaying a
       * *prefix* — or a subsequence with one step removed — hands every later
       * step different numbers, and the sequence being replayed is no longer
       * the sequence that failed. This harness reported a one-step reproduction
       * of "the open editor names a missing clip" from `splitClip`, and
       * `splitClip` keeps the original clip: the reproduction reproduced
       * nothing, and a seed with a prefix that does not reproduce is worse than
       * no seed at all.
       *
       * Indexing the stream fixes it. Step 7 draws the same numbers whatever
       * came before it, so a prefix means what it reads as and a removal only
       * removes what it says.
       */
      const mix32 = (a, b) => {
        let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0;
        h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
        h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
        return (h ^ (h >>> 16)) >>> 0;
      };
      const streamFor = (index, salt) => {
        let state = mix32((seed ^ salt) >>> 0, index >>> 0);
        return () => {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
          return state / 4294967296;
        };
      };
      let draw = streamFor(0, 2);
      const rnd = () => draw();
      const pick = (list) => (list.length === 0 ? null : list[Math.floor(rnd() * list.length)]);

      // The ui goes back too, not only the project.
      //
      // A run that ends with the editor pointing at a clip it deleted leaves
      // that pointer behind, so the *next* replay starts already violating the
      // invariant and every candidate prefix "fails". The shrink then reports
      // whatever one-step prefix it tried first — this file said `splitClip`
      // once and `setTrackGain` once, and neither can cause what was reported.
      st().setProject(structuredClone(window.__soakBaseline));
      if (window.__soakUiBaseline) ui().set(window.__soakUiBaseline);

      const STEPS = {
        addTrack: () => st().addTrack(pick(['audio', 'instrument', 'drum', 'bus'])),
        deleteTrack: () => {
          const t = pick(st().project.tracks);
          if (t) st().deleteTrack(t.id);
        },
        duplicateTrack: () => {
          const t = pick(st().project.tracks);
          if (t) st().duplicateTrack(t.id);
        },
        renameTrack: () => {
          const t = pick(st().project.tracks);
          if (t) st().setTrack(t.id, { name: 'fz' + Math.floor(rnd() * 1000) });
        },
        setTrackGain: () => {
          const t = pick(st().project.tracks);
          if (t) st().setTrack(t.id, { volume: rnd() });
        },
        addClip: () => {
          const t = pick(st().project.tracks.filter((x) => x.type !== 'bus'));
          if (t) st().addMidiClip(t.id, Math.floor(rnd() * 64), 1 + Math.floor(rnd() * 8));
        },
        moveClip: () => {
          const cl = pick(st().project.clips);
          if (cl) st().moveClip(cl.id, Math.floor(rnd() * 64));
        },
        resizeClip: () => {
          const cl = pick(st().project.clips);
          if (cl) st().resizeClip(cl.id, cl.start, 1 + Math.floor(rnd() * 16));
        },
        deleteClip: () => {
          const cl = pick(st().project.clips);
          if (cl) st().deleteClip(cl.id);
        },
        duplicateClip: () => {
          const cl = pick(st().project.clips);
          if (cl) st().duplicateClip(cl.id);
        },
        splitClip: () => {
          const cl = pick(st().project.clips);
          if (cl) st().splitClip(cl.id, cl.start + rnd() * cl.length);
        },
        addEffect: () => {
          const t = pick(st().project.tracks);
          const k = pick(window.__ml.effectKinds ?? ['compressor']);
          if (t && k) st().addEffect(t.id, k);
        },
        removeEffect: () => {
          const t = pick(st().project.tracks.filter((x) => (x.effects ?? []).length > 0));
          if (t) st().removeEffect(t.id, pick(t.effects).id);
        },
        bypassEffect: () => {
          const t = pick(st().project.tracks.filter((x) => (x.effects ?? []).length > 0));
          if (!t) return;
          const fx = pick(t.effects);
          if (fx) st().setEffectBypass(t.id, fx.id, !fx.bypass);
        },
        setEffectParam: () => {
          const t = pick(st().project.tracks.filter((x) => (x.effects ?? []).length > 0));
          if (!t) return;
          const fx = pick(t.effects);
          const key = pick(Object.keys(fx.params ?? {}));
          if (key && typeof fx.params[key] === 'number') {
            st().setEffectParam(t.id, fx.id, key, rnd());
          }
        },
        addAutomationLane: () => {
          const t = pick(st().project.tracks);
          if (t) st().addAutomationLane(t.id, pick(['volume', 'pan']));
        },
        addAutomationPoint: () => {
          const t = pick(st().project.tracks.filter((x) => (x.automation ?? []).length > 0));
          if (!t) return;
          const lane = pick(t.automation);
          st().addAutomationPoint(t.id, lane.id, rnd() * 64, rnd());
        },
        setInstrument: () => {
          const t = pick(st().project.tracks.filter((x) => x.type !== 'audio' && x.type !== 'bus'));
          if (t) st().setInstrument(t.id, pick(window.__ml.instrumentKinds ?? ['synth']));
        },
        selectTrack: () => {
          const t = pick(st().project.tracks);
          ui().set({ selectedTrackId: t ? t.id : null });
        },
        selectClip: () => {
          const cl = pick(st().project.clips);
          ui().set({ editClipId: cl ? cl.id : null, selectedClipIds: cl ? [cl.id] : [] });
        },
        setEditorTab: () => ui().set({ editorTab: pick(['mixer', 'piano', 'drums', 'synth']) }),
        transportPlay: () => engine.play(),
        transportStop: () => engine.stop(),
        transportSeek: () => engine.seek(rnd() * 128),
        setBpm: () =>
          st().update((d) => {
            d.bpm = 40 + Math.floor(rnd() * 200);
          }),
        undo: () => st().undo(),
        redo: () => st().redo(),
        // The one step that crosses the persistence boundary, through the code
        // that actually opens a project rather than through `JSON.parse`.
        //
        // The two are not the same function. `validateProject` *drops* what it
        // cannot read — that is its job, and `paramIdExists` is deliberately
        // wide precisely so it drops as little as possible. A shape-only round
        // trip cannot see any of that, so it would fuzz the serialiser and
        // report on the loader.
        saveAndReload: () => {
          const repo = window.__ml.projectRepo;
          const text = JSON.stringify(st().project);
          st().setProject(repo ? repo.validateProject(JSON.parse(text)) : JSON.parse(text));
        },
      };

      /**
       * What must be true after every single step.
       *
       * Structural, and each one is a corruption that survives a save: a clip
       * pointing at a deleted track, two things sharing an id, a selection
       * naming something that is gone. These are the failures that come back
       * as a project that will not open, days later, with no way to find out
       * what did it.
       */
      const invariants = () => {
        const p = st().project;
        const trackIds = new Set(p.tracks.map((t) => t.id));
        if (trackIds.size !== p.tracks.length) return 'two tracks share an id';
        const clipIds = new Set(p.clips.map((cl) => cl.id));
        if (clipIds.size !== p.clips.length) return 'two clips share an id';
        for (const cl of p.clips) {
          if (!trackIds.has(cl.trackId)) return `clip ${cl.id} is on missing track ${cl.trackId}`;
          if (!Number.isFinite(cl.start) || cl.start < 0)
            return `clip ${cl.id} starts at ${cl.start}`;
          if (!Number.isFinite(cl.length) || cl.length <= 0)
            return `clip ${cl.id} is ${cl.length} long`;
        }
        for (const t of p.tracks) {
          const fxIds = new Set((t.effects ?? []).map((f) => f.id));
          if (fxIds.size !== (t.effects ?? []).length)
            return `track ${t.id} has duplicate insert ids`;
          if (!Number.isFinite(t.volume)) return `track ${t.id} volume is ${t.volume}`;
          for (const lane of t.automation ?? []) {
            for (const pt of lane.points ?? []) {
              if (!Number.isFinite(pt.beat) || !Number.isFinite(pt.value)) {
                return `automation point on ${t.id} is ${pt.beat}/${pt.value}`;
              }
            }
          }
        }
        if (!Number.isFinite(p.bpm) || p.bpm <= 0) return `bpm is ${p.bpm}`;
        const sel = ui().selectedTrackId;
        if (sel !== null && sel !== undefined && !trackIds.has(sel)) {
          return `selection names missing track ${sel}`;
        }
        const open = ui().editClipId;
        if (open !== null && open !== undefined && !clipIds.has(open)) {
          return `open editor names missing clip ${open}`;
        }
        if (!Number.isFinite(window.__ml.position())) return 'transport position is not finite';
        // The project has to survive a round trip through its own format. This
        // is the one invariant that is about the saved artefact rather than the
        // live state, and it is the difference between "the app is fine" and
        // "the file will open tomorrow".
        try {
          JSON.parse(JSON.stringify(p));
        } catch (e) {
          return 'project will not serialise: ' + String(e);
        }
        return null;
      };

      // Each entry carries its own index, so a removal does not renumber the
      // steps that stay — which is the other half of a faithful replay.
      const chosen = [];
      const total = only ? only.length : steps;
      for (let i = 0; i < total; i += 1) {
        const index = only ? only[i].index : i;
        const name = only ? only[i].name : names[Math.floor(streamFor(index, 1)() * names.length)];
        draw = streamFor(index, 2);
        if (!only) chosen.push({ name, index });
        let threw = null;
        try {
          STEPS[name]();
        } catch (e) {
          threw = String(e).slice(0, 200);
        }
        if (threw) {
          return { failed: true, at: i, step: name, why: `threw: ${threw}`, chosen };
        }
        const broken = invariants();
        if (broken) {
          return { failed: true, at: i, step: name, why: broken, chosen };
        }
        // Yielded periodically so the page can service the audio graph. Without
        // it a long run starves the engine and the failures found are the
        // fuzzer's own starvation rather than the product's.
        if (i % 64 === 63) await new Promise((r) => setTimeout(r, 0));
      }
      return { failed: false, at: total, chosen };
    },
    { seed, steps, only, names: STEP_NAMES },
  );
}

/**
 * The shortest subsequence of `chosen` that still fails.
 *
 * A prefix bisection first, because it is cheap and usually removes most of
 * the run; then **ddmin** — remove a chunk, keep the removal if it still fails,
 * halve the chunk size when nothing can be removed. One-at-a-time removal from
 * the end was tried first and it is far too weak: it turned 480 steps into 372,
 * which is not a reproduction anybody reads, it is the same run with the last
 * hundred steps trimmed.
 *
 * Every candidate is re-run and required to fail before it is believed, and the
 * empty sequence is required to *pass* first. Both times this file was wrong it
 * was wrong silently: a shared draw stream made a subsequence replay a
 * different sequence, and a ui that was not reset made every candidate fail
 * before it started. A shrink whose result does not reproduce is worse than no
 * shrink, because it names an innocent step.
 */
export async function shrink(page, seed, chosen, budget = 400) {
  let spent = 0;
  const fails = async (steps) => {
    spent += 1;
    return (await replay(page, { seed, steps: 0, only: steps })).failed;
  };

  // Zero steps must pass, or the reset is leaking state from the failing run
  // and every candidate will "reproduce".
  if (await fails([])) {
    return [{ name: '(the fixture itself fails — the reset is leaking state)', index: -1 }];
  }

  let lo = 1;
  let hi = chosen.length;
  while (lo < hi && spent < budget) {
    const mid = Math.floor((lo + hi) / 2);
    if (await fails(chosen.slice(0, mid))) hi = mid;
    else lo = mid + 1;
  }
  let best = chosen.slice(0, hi);

  let parts = 2;
  while (best.length > 1 && spent < budget) {
    const size = Math.ceil(best.length / parts);
    let reduced = false;
    for (let start = 0; start < best.length && spent < budget; start += size) {
      const without = [...best.slice(0, start), ...best.slice(start + size)];
      if (without.length === 0 || without.length === best.length) continue;
      if (await fails(without)) {
        best = without;
        parts = Math.max(parts - 1, 2);
        reduced = true;
        break;
      }
    }
    if (!reduced) {
      if (parts >= best.length) break;
      parts = Math.min(parts * 2, best.length);
    }
  }
  return best;
}

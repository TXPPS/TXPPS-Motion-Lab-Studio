/**
 * How far the product goes before it stops keeping up.
 *
 * Two sections: the track and insert ceiling, found by adding until two
 * consecutive frame samples miss the budget, and the fixed project scales.
 *
 * The doubled confirmation is load-bearing and is the thing most likely to be
 * "simplified" away. One over-budget sample is a garbage collection; the number
 * it produced was 84 tracks where the real ceiling is above 360.
 */
import { JSON_ONLY, FRAME_BUDGET_MS, section, record, bind } from './harness.mjs';
import { unless } from '../probe-mutant.mjs';

/** @param page the one page every section shares. */
export async function run(page) {
  const { frames } = bind(page);
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
}

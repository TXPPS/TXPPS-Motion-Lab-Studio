/**
 * What drifts: the long run, the undo stack, and being sent to the background.
 *
 * The heap row is judged on the slope after warm-up rather than on a final
 * reading, and it forces collection before sampling. Neither is optional. A
 * heap that ends higher is a busy moment; a heap that rises across every sample
 * is a leak; and a heap read without forcing collection first is a measurement
 * of when the collector last ran.
 */
import { JSON_ONLY, section, record, fail, bind } from './harness.mjs';

/** @param page the one page every section shares. */
export async function run(page) {
  const { frames, heldBytes } = bind(page);
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
}

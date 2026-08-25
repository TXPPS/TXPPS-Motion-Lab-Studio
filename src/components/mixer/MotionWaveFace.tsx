/**
 * A Motion Wave unit's own panel, mounted in the app's plugin editor.
 *
 * The unit already has a face: `motionwave/ui/render/facePanel.ts` builds it
 * from the `UnitFace` declaration that U19, U20, U22 and U23 are graded
 * against. This mounts that renderer rather than reproducing it in React —
 * a second panel would be a second opinion about the artwork the IP cell
 * checks and about the geometry the responsive cell measures, and only one of
 * them would be the one under test.
 *
 * So this component is deliberately thin. It owns three things and no more:
 * where the panel is mounted, how a control reaches the project store, and how
 * a published frame reaches the panel's `paint`.
 */
import { useEffect, useRef } from 'react';
import { renderFace } from '../../../motionwave/ui/render/facePanel';
import type { PanelHandle } from '../../../motionwave/ui/render/facePanel';
import { toNormalised } from '../../../motionwave/ui/param/spec';
import { motionWaveUnitFor } from '../../audio/motionwave/registry';
import { fromNodes, toNodes } from '../../audio/motionwave/shapes';
import { engine } from '../../audio/engine';
import { useProjectStore } from '../../state/projectStore';
import type { Effect } from '../../model/types';

export function MotionWaveFace({ trackId, effect }: { trackId: string; effect: Effect }) {
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<PanelHandle | null>(null);
  const entry = motionWaveUnitFor(effect.kind);

  /*
   * Whether the pointer is a finger, read once per mount.
   *
   * Passed to the panel so the curve editor's hit radius is a thumb's rather
   * than a mouse's. It sizes targets and nothing else — a face does not look
   * different on a phone, it is grabbable there.
   */
  const coarsePointer =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false;

  /*
   * Built once per insert, not per render.
   *
   * `renderFace` builds DOM directly, so React must not be asked to reconcile
   * it: the effect below owns the subtree and empties it on unmount. The
   * dependency list is the unit and the insert, which is what actually decides
   * *which* panel this is — a re-render because a parameter moved must not
   * rebuild the panel, or every drag would recreate the control being dragged.
   */
  useEffect(() => {
    const container = host.current;
    if (!container || !entry) return;
    container.replaceChildren();
    const handle = renderFace({
      container,
      face: entry.unit.face!,
      specs: entry.unit.specs,
      title: entry.label,
      coarsePointer,
      shapes: (effect.shapes ?? []).map(toNodes),
      onParam: (id, real) => {
        const store = useProjectStore.getState();
        store.setEffectParam(trackId, effect.id, String(id), real);
      },
      onShape: (index, nodes) => {
        const store = useProjectStore.getState();
        store.setEffectShape(trackId, effect.id, index, fromNodes(nodes));
      },
    });
    panel.current = handle;

    return () => {
      panel.current = null;
      container.replaceChildren();
    };
    // `effect.shapes` is read here for the panel's initial state and is
    // deliberately not a dependency: it changes on every frame of a curve drag,
    // and rebuilding the panel would destroy the node under the finger doing
    // the dragging. Later changes arrive through the sync effect below, which
    // pushes them into the existing panel instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, trackId, effect.id, coarsePointer]);

  /*
   * The stored state, pushed into the panel — on mount and whenever it changes
   * underneath the panel.
   *
   * A control starts at its parameter's *default*, which is right for a fresh
   * insert and wrong for every reopened project: the DSP would run the saved
   * setting while the panel showed the default, and the first touch of any
   * control would snap the sound to what the picture had been claiming. Nothing
   * could see it before, because an `<input type="range">` at the wrong
   * position looks exactly like one at the right position.
   *
   * Written only where the panel disagrees. The panel reports every move to the
   * store, so writing unconditionally would echo each of a drag's frames back
   * into the control being dragged; comparing first ends that at the first
   * comparison rather than relying on the values happening to settle.
   */
  useEffect(() => {
    const handle = panel.current;
    if (!handle || !entry) return;
    for (const spec of entry.unit.specs) {
      const real = effect.params[String(spec.id)];
      if (real === undefined) continue;
      const wanted = toNormalised(spec, real);
      const shown = handle.paramValue(spec.id);
      if (shown === undefined || Math.abs(shown - wanted) > 1e-9) handle.setParam(spec.id, wanted);
    }
    (effect.shapes ?? []).forEach((rows, index) => {
      const wanted = toNodes(rows);
      const shown = handle.shapeNodes(index);
      if (JSON.stringify(shown) !== JSON.stringify(wanted)) handle.setShape(index, wanted);
    });
  }, [entry, effect.params, effect.shapes]);

  /*
   * Painted on the display's clock, from whatever the engine last published.
   *
   * A pull rather than a push, which is the same decision the seqlock makes one
   * layer down: the audio thread publishes when it has something and never
   * waits, and the panel reads when the display is ready and never blocks. A
   * push would put a repaint on the path between two audio blocks.
   *
   * The frame's doubles are named by the unit's own `meters` list, in order —
   * that ordering is the contract between `wasm/bridge.cpp` and the unit's
   * declaration, and the length check below is what catches the two drifting
   * apart rather than silently mislabelling every readout by one.
   */
  useEffect(() => {
    if (!entry) return;
    const meters = entry.unit.meters ?? [];
    let raf = 0;
    let warned = false;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const handle = panel.current;
      if (!handle) return;
      const frame = engine.motionWaveFrameOf(trackId, effect.id);
      if (!frame) return;
      if (frame.length !== meters.length && !warned) {
        warned = true;
        console.warn(
          `${entry.label}: published ${frame.length} value(s) for ${meters.length} declared ` +
            'meter(s) — the bridge and the unit declaration disagree, so readouts would be ' +
            'mislabelled. Not painting.',
        );
      }
      if (frame.length !== meters.length) return;
      const named = new Map<string, number>();
      for (let i = 0; i < meters.length; i++) named.set(meters[i].name, frame[i]);
      handle.paint(named);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [entry, trackId, effect.id]);

  if (!entry) return null;
  return <div className="mw-face-host" ref={host} data-testid={`mw-face-${effect.id}`} />;
}

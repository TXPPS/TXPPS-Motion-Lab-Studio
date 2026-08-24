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
import type { CurveNode } from '../../../motionwave/ui/render/controls/curve_model';
import { toNormalised } from '../../../motionwave/ui/param/spec';
import { motionWaveUnitFor } from '../../audio/motionwave/registry';
import { engine } from '../../audio/engine';
import { useProjectStore } from '../../state/projectStore';
import type { Effect } from '../../model/types';

/**
 * The four numbers a project stores per breakpoint, as the editor's own node.
 *
 * The shape codes are an index in the file and a name in the editor, and the
 * mapping lives here because it is the host's translation rather than either
 * side's model. Anything out of range reads as a line, which is the shape that
 * cannot be wrong: a corrupt code that fell through to `step` would make a
 * saved session play a curve nobody drew.
 */
const SHAPES: readonly CurveNode['shape'][] = ['line', 'arc', 'scurve', 'step'];

function toNodes(rows: readonly (readonly number[])[] | undefined): CurveNode[] {
  return (rows ?? []).map((row) => ({
    x: row[0] ?? 0,
    y: row[1] ?? 0,
    shape: SHAPES[row[2] ?? 0] ?? 'line',
    tension: row[3] ?? 0,
  }));
}

function fromNodes(nodes: readonly CurveNode[]): number[][] {
  return nodes.map((node) => [
    node.x,
    node.y,
    Math.max(0, SHAPES.indexOf(node.shape)),
    node.tension,
  ]);
}

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

    /*
     * The saved values, pushed into the panel it was just built with.
     *
     * A control starts at its parameter's default, which is right for a fresh
     * insert and wrong for every reopened project: the DSP would be running the
     * saved setting while the panel showed the default, and the first touch of
     * any control would snap the sound to what the picture had been claiming.
     * The old panel had this too and nothing could see it, because an
     * `<input type="range">` at the wrong position looks exactly like one at
     * the right position.
     */
    const stored = useProjectStore.getState();
    const saved = stored.project.tracks
      .find((t) => t.id === trackId)
      ?.effects?.find((e) => e.id === effect.id);
    for (const spec of entry.unit.specs) {
      const real = saved?.params[String(spec.id)];
      if (real !== undefined) handle.setParam(spec.id, toNormalised(spec, real));
    }
    return () => {
      panel.current = null;
      container.replaceChildren();
    };
  }, [entry, trackId, effect.id, coarsePointer]);

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

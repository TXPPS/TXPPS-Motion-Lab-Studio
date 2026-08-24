/**
 * Motion Wave — the drag gesture every rotary and linear primitive shares.
 *
 * Written once because the three hard parts are the same for a knob, a fader
 * and a stepped selector, and each is a place where a hand-rolled control
 * quietly stops working on a phone:
 *
 * - **Pointer capture.** A finger on a 44 px knob covers it completely and
 *   leaves its bounds within a few millimetres of travel. Without capture the
 *   element stops receiving moves the instant that happens, and the control
 *   reads as sticky rather than as broken, which is the harder bug to report.
 * - **`touch-action: none`.** A vertical drag is also a page scroll, and the
 *   browser resolves that in the page's favour. Set here rather than left to a
 *   stylesheet, because a control that scrolls the panel instead of moving is
 *   indistinguishable from a dead control and the fix lives nowhere near the
 *   symptom.
 * - **Incremental integration.** The value accumulates each move's own delta
 *   rather than mapping the total offset. Mapping absolutely looks simpler and
 *   is wrong: fine-drag scales sensitivity by how far the pointer has moved
 *   sideways, so under an absolute map a purely horizontal movement rescales
 *   travel already applied and the value jumps under a finger that has not
 *   moved up or down at all.
 */

/** What a primitive hands the gesture so it can move that primitive's value. */
export interface DragBehaviour {
  /** The normalised value the gesture starts from. */
  read(): number;
  /** Report a normalised value. `settled` is false for every move in a drag. */
  write(value: number, settled: boolean): void;
  /** Vertical pixels that sweep the whole range at full sensitivity. */
  readonly travelPx: number;
  /** Whether rotating about the control's centre is a meaningful gesture. */
  readonly circular: boolean;
  /** Degrees of rotation the full range occupies, for circular tracking. */
  readonly sweepDeg: number;
}

/**
 * Horizontal offset at which the drag reaches its finest resolution, and the
 * factor it reaches there.
 *
 * Both are design choices rather than measurements, and are named as such
 * because no published constant governs them. 120 px is roughly a thumb's
 * sideways reach on a phone held one-handed, so the whole range of sensitivity
 * is available without regripping; a factor of ten is what makes a 0.1 dB step
 * addressable on a control whose coarse travel covers 24 dB.
 */
export const FINE_SPAN_PX = 120;
export const FINE_RATIO = 10;

/**
 * How far outside the control's radius the pointer must travel before the
 * gesture tracks angle instead of vertical distance.
 *
 * Comfortably outside the body, because switching modes anywhere inside it
 * makes a small wobble during a vertical drag snap the value to wherever the
 * finger happens to sit relative to the centre.
 */
export const CIRCULAR_RADIUS_FACTOR = 1.4;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Wrap to (−180, 180], so consecutive angle samples never read as a full turn. */
function wrapDegrees(delta: number): number {
  let d = delta;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

interface DragState {
  readonly pointerId: number;
  /** Where the drag began, which is what fine-drag measures sideways from. */
  readonly originX: number;
  lastY: number;
  value: number;
  circular: boolean;
  lastAngle: number;
}

/**
 * The pointer's bearing from the control's centre, and how far out it is as a
 * multiple of the control's own radius.
 *
 * Measured from twelve o'clock, clockwise, because that is the frame a knob's
 * sweep is described in; keeping the pointer and the drawing in one frame is
 * what stops them disagreeing about which way is up.
 */
function bearing(node: HTMLElement, x: number, y: number): { deg: number; radius: number } {
  const box = node.getBoundingClientRect();
  const dx = x - (box.left + box.width / 2);
  const dy = y - (box.top + box.height / 2);
  const unit = Math.max(box.width, box.height) / 2;
  return {
    deg: (Math.atan2(dx, -dy) * 180) / Math.PI,
    radius: unit > 0 ? Math.hypot(dx, dy) / unit : 0,
  };
}

/**
 * Make `node` draggable, and return the detach function.
 *
 * Every listener goes on the node itself rather than on the document: pointer
 * capture routes moves back here anyway, and a document-level listener is a
 * second subscriber that outlives the element whenever a caller forgets to
 * detach — which in a panel that is rebuilt on every unit change is often.
 */
export function attachDrag(node: HTMLElement, behaviour: DragBehaviour): () => void {
  node.style.touchAction = 'none';
  let state: DragState | null = null;

  const onDown = (event: PointerEvent) => {
    if (state !== null) return;
    // Primary button only. A right-click that started a drag would leave the
    // control captured underneath an open context menu.
    if (event.button > 0) return;
    state = {
      pointerId: event.pointerId ?? 0,
      originX: event.clientX,
      lastY: event.clientY,
      value: behaviour.read(),
      circular: false,
      lastAngle: bearing(node, event.clientX, event.clientY).deg,
    };
    node.setPointerCapture?.(state.pointerId);
    node.dataset.mwDragging = 'true';
    event.preventDefault();
  };

  const onMove = (event: PointerEvent) => {
    if (state === null || (event.pointerId ?? 0) !== state.pointerId) return;
    const here = bearing(node, event.clientX, event.clientY);

    if (behaviour.circular && !state.circular && here.radius > CIRCULAR_RADIUS_FACTOR) {
      // Crossing into circular tracking must not move the value: only angle
      // *changes* from here on are applied, so wherever the finger is when it
      // crosses is simply where it now is.
      state.circular = true;
      state.lastAngle = here.deg;
    }

    if (state.circular) {
      state.value = clamp01(
        state.value + wrapDegrees(here.deg - state.lastAngle) / behaviour.sweepDeg,
      );
      state.lastAngle = here.deg;
    } else {
      // Up increases, which is what every fader and every meter in this product
      // already agrees on.
      const dy = state.lastY - event.clientY;
      const sideways = Math.min(FINE_SPAN_PX, Math.abs(event.clientX - state.originX));
      const fine = 1 / (1 + (sideways / FINE_SPAN_PX) * (FINE_RATIO - 1));
      state.value = clamp01(state.value + (dy / behaviour.travelPx) * fine);
    }

    state.lastY = event.clientY;
    behaviour.write(state.value, false);
    event.preventDefault();
  };

  const onUp = (event: PointerEvent) => {
    if (state === null || (event.pointerId ?? 0) !== state.pointerId) return;
    node.releasePointerCapture?.(state.pointerId);
    delete node.dataset.mwDragging;
    behaviour.write(state.value, true);
    state = null;
  };

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', onUp);

  return () => {
    node.removeEventListener('pointerdown', onDown);
    node.removeEventListener('pointermove', onMove);
    node.removeEventListener('pointerup', onUp);
    node.removeEventListener('pointercancel', onUp);
  };
}

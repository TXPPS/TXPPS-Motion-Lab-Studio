/**
 * Motion Wave — the curve editor surface.
 *
 * The geometry, hit-testing and node arithmetic have been correct and tested
 * since Directive 04; what did not exist was anywhere to put a finger. The
 * Motion Shaper's curve is the whole unit — every other control on it decides
 * how the curve is applied — and it had no surface in the application at all,
 * which is why cell 26's fourth requirement is worded as "the unit's defining
 * control is present and operable" rather than as "the panel is complete".
 *
 * Everything below is plumbing over `curve_model.ts`. Nothing here decides
 * where a node may go or which node a press grabs; those live next to their
 * tests, and this file would be the wrong place to acquire a second opinion
 * about either.
 */
import {
  TOUCH_RADIUS_PX,
  curveValueAt,
  hitTestNode,
  insertNode,
  minimumEditorHeightPx,
  moveNode,
  nodeToPixels,
  pixelsToNode,
  removeNode,
  type CurveNode,
  type EditorGeometry,
} from './curve_model';
import { svgEl } from './svg';

/** Padding inside the box, so a node at either extreme is not half off it. */
const INSET_PX = 14;

/** How many points the drawn path is sampled at. */
const PATH_SAMPLES = 160;

/**
 * How long a second press on the same node counts as a double tap.
 *
 * 320 ms rather than the platform's own double-click interval, because this
 * gesture removes a node and a user who meant to drag it twice should not lose
 * it. Erring long would be the dangerous direction here, so it errs short.
 */
const DOUBLE_TAP_MS = 320;

export interface CurveEditorOptions {
  readonly doc: Document;
  readonly accessibleName: string;
  readonly nodes: readonly CurveNode[];
  readonly coarsePointer: boolean;
  onChange(nodes: readonly CurveNode[]): void;
}

export interface CurveEditorHandle {
  readonly node: HTMLElement;
  setNodes(nodes: readonly CurveNode[]): void;
  /** Draw the playhead from a published phase. Never reads the audio path. */
  paint(phase: number): void;
  nodes(): readonly CurveNode[];
  dispose(): void;
}

function pathFor(nodes: readonly CurveNode[], geometry: EditorGeometry): string {
  const parts: string[] = [];
  for (let i = 0; i <= PATH_SAMPLES; i++) {
    const phase = i / PATH_SAMPLES;
    const at = nodeToPixels(
      { x: phase, y: curveValueAt(nodes, phase), shape: 'line', tension: 0 },
      geometry,
    );
    parts.push(`${i === 0 ? 'M' : 'L'} ${at.x.toFixed(2)} ${at.y.toFixed(2)}`);
  }
  return parts.join(' ');
}

export function buildCurveEditor(options: CurveEditorOptions): CurveEditorHandle {
  const { doc } = options;
  const host = doc.createElement('div');
  host.className = 'mw-curve';
  host.dataset.mwPrimitive = 'curve';
  host.tabIndex = 0;
  host.setAttribute('role', 'application');
  host.setAttribute('aria-label', options.accessibleName);
  // The height below which two nodes at opposite ends of the range share a
  // touch target. Set as a floor rather than a size so a wide panel can give
  // the editor more.
  host.style.minHeight = `${minimumEditorHeightPx(options.coarsePointer, INSET_PX) + TOUCH_RADIUS_PX * 2}px`;

  const svg = svgEl(doc, 'svg', {
    class: 'mw-curve-face',
    focusable: 'false',
    'aria-hidden': 'true',
  });
  const grid = svgEl(doc, 'g', { class: 'mw-curve-grid' });
  const path = svgEl(doc, 'path', { class: 'mw-curve-path', d: '' });
  const handles = svgEl(doc, 'g', { class: 'mw-curve-handles' });
  const playhead = svgEl(doc, 'line', { class: 'mw-curve-playhead', x1: 0, y1: 0, x2: 0, y2: 0 });
  svg.appendChild(grid);
  svg.appendChild(path);
  svg.appendChild(playhead);
  svg.appendChild(handles);
  host.appendChild(svg);

  let nodes: CurveNode[] = options.nodes.map((n) => ({ ...n }));
  let geometry: EditorGeometry = { width: 320, height: 160, inset: INSET_PX };
  let selected = 0;
  let dragging = -1;
  let lastTapAt = -Infinity;
  let lastTapIndex = -1;

  function measure(): void {
    const box = host.getBoundingClientRect();
    // jsdom and a display:none panel both report zero, and a zero-width
    // geometry divides by its own guard rather than crashing — but it would
    // also draw every node on top of every other. Keeping the previous
    // measurement is the honest fallback: the drawing is stale rather than
    // wrong.
    if (box.width > 0 && box.height > 0) {
      geometry = { width: box.width, height: box.height, inset: INSET_PX };
      svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    }
  }

  function drawGrid(): void {
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    for (let i = 1; i < 4; i++) {
      const at = nodeToPixels({ x: i / 4, y: 0, shape: 'line', tension: 0 }, geometry);
      grid.appendChild(
        svgEl(doc, 'line', {
          class: 'mw-curve-gridline',
          x1: at.x,
          y1: 0,
          x2: at.x,
          y2: geometry.height,
        }),
      );
    }
    const mid = nodeToPixels({ x: 0, y: 0.5, shape: 'line', tension: 0 }, geometry);
    grid.appendChild(
      svgEl(doc, 'line', {
        class: 'mw-curve-gridline',
        x1: 0,
        y1: mid.y,
        x2: geometry.width,
        y2: mid.y,
      }),
    );
  }

  function draw(): void {
    measure();
    drawGrid();
    path.setAttribute('d', pathFor(nodes, geometry));
    while (handles.firstChild) handles.removeChild(handles.firstChild);
    nodes.forEach((node, index) => {
      const at = nodeToPixels(node, geometry);
      // Two circles: one drawn small enough not to hide the curve it sits on,
      // and one invisible at the full touch radius. RA-002's lesson is that a
      // target's visual size and its touchable size are different numbers, and
      // the bug is writing them as one.
      handles.appendChild(
        svgEl(doc, 'circle', {
          class: 'mw-curve-target',
          cx: at.x,
          cy: at.y,
          r: options.coarsePointer ? TOUCH_RADIUS_PX : 12,
        }),
      );
      const dot = svgEl(doc, 'circle', {
        class: index === selected ? 'mw-curve-node mw-curve-node-selected' : 'mw-curve-node',
        cx: at.x,
        cy: at.y,
        r: 5,
      });
      dot.setAttribute('data-mw-node', String(index));
      handles.appendChild(dot);
    });
    host.dataset.mwNodes = String(nodes.length);
  }

  function commit(next: readonly CurveNode[]): void {
    nodes = next.map((n) => ({ ...n }));
    draw();
    options.onChange(nodes);
  }

  function localPoint(event: PointerEvent): { x: number; y: number } {
    const box = host.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  const onDown = (event: PointerEvent) => {
    if (event.button > 0) return;
    measure();
    const at = localPoint(event);
    const hit = hitTestNode(nodes, at.x, at.y, geometry, options.coarsePointer);
    const now = event.timeStamp;

    if (hit >= 0) {
      if (hit === lastTapIndex && now - lastTapAt < DOUBLE_TAP_MS) {
        commit(removeNode(nodes, hit));
        selected = Math.min(selected, nodes.length - 1);
        lastTapIndex = -1;
        draw();
        return;
      }
      lastTapAt = now;
      lastTapIndex = hit;
      dragging = hit;
      selected = hit;
    } else {
      // A press on empty space adds a point at the curve's own value there, so
      // the shape does not jump — see `insertNode`. Then the same press drags
      // it, which is what makes drawing a curve one gesture rather than two.
      const where = pixelsToNode(at.x, at.y, geometry);
      const grown = insertNode(nodes, where.x, (x) => curveValueAt(nodes, x));
      commit(grown);
      dragging = nodes.findIndex((n) => Math.abs(n.x - where.x) < 1e-9);
      selected = dragging;
      lastTapIndex = -1;
    }
    host.setPointerCapture?.(event.pointerId ?? 0);
    host.focus();
    draw();
    event.preventDefault();
  };

  const onMove = (event: PointerEvent) => {
    if (dragging < 0) return;
    const at = localPoint(event);
    const where = pixelsToNode(at.x, at.y, geometry);
    commit(moveNode(nodes, dragging, where.x, where.y));
    event.preventDefault();
  };

  const onUp = (event: PointerEvent) => {
    if (dragging < 0) return;
    host.releasePointerCapture?.(event.pointerId ?? 0);
    dragging = -1;
  };

  /**
   * The keyboard route, which a pointer-only editor would leave with none.
   *
   * Arrow keys move the selected node by a step; the bracket keys walk the
   * selection; Delete removes and Enter inserts beside. A curve that could only
   * be drawn with a finger would fail `U23` as squarely as an unlabelled
   * control does.
   */
  const onKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 0.01 : 0.05;
    const node = nodes[selected];
    if (node === undefined) return;
    switch (event.key) {
      case 'ArrowLeft':
        commit(moveNode(nodes, selected, node.x - step, node.y));
        break;
      case 'ArrowRight':
        commit(moveNode(nodes, selected, node.x + step, node.y));
        break;
      case 'ArrowUp':
        commit(moveNode(nodes, selected, node.x, node.y + step));
        break;
      case 'ArrowDown':
        commit(moveNode(nodes, selected, node.x, node.y - step));
        break;
      case '[':
        selected = (selected + nodes.length - 1) % nodes.length;
        draw();
        break;
      case ']':
        selected = (selected + 1) % nodes.length;
        draw();
        break;
      case 'Delete':
      case 'Backspace':
        commit(removeNode(nodes, selected));
        selected = Math.min(selected, nodes.length - 1);
        draw();
        break;
      case 'Enter': {
        const next = nodes[selected + 1];
        const x = next === undefined ? (node.x + 1) / 2 : (node.x + next.x) / 2;
        commit(insertNode(nodes, x, (at) => curveValueAt(nodes, at)));
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };

  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointercancel', onUp);
  host.addEventListener('keydown', onKey);
  host.style.touchAction = 'none';
  draw();

  return {
    node: host,
    setNodes(next) {
      nodes = next.map((n) => ({ ...n }));
      selected = Math.min(selected, Math.max(0, nodes.length - 1));
      draw();
    },
    paint(phase) {
      const at = nodeToPixels(
        { x: phase - Math.floor(phase), y: 0, shape: 'line', tension: 0 },
        geometry,
      );
      playhead.setAttribute('x1', at.x.toFixed(2));
      playhead.setAttribute('x2', at.x.toFixed(2));
      playhead.setAttribute('y2', String(geometry.height));
      host.dataset.mwValue = phase.toFixed(6);
    },
    nodes: () => nodes,
    dispose() {
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerup', onUp);
      host.removeEventListener('pointercancel', onUp);
      host.removeEventListener('keydown', onKey);
      host.remove();
    },
  };
}

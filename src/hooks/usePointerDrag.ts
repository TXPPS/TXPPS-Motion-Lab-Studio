import { useRef, useCallback } from 'react';
import type React from 'react';

export interface DragHandlers<T> {
  onStart?: (e: React.PointerEvent) => T;
  onMove: (dx: number, dy: number, e: PointerEvent, startData: T) => void;
  onEnd?: (moved: boolean, startData: T) => void;
}

/**
 * Pointer-drag helper: returns a pointerdown handler that captures the pointer
 * and reports deltas. Works for mouse, touch, and pen; cleans up listeners.
 *
 * Move/up listeners live on `window`, not on the dragged element. The
 * arrangement unmounts clips that scroll out of the view window, so a drag that
 * scrolls its own clip away would otherwise never see `pointerup` — `onEnd`
 * would never run, the undo gesture would stay open, and every later edit would
 * silently stop being undoable. Listening on window makes the end of a drag
 * independent of the life of the element that started it.
 */
export function usePointerDrag<T = void>(
  handlers: DragHandlers<T>,
): (e: React.PointerEvent) => void {
  const ref = useRef(handlers);
  ref.current = handlers;

  return useCallback((e: React.PointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const target = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    let moved = false;
    const startData = ref.current.onStart ? ref.current.onStart(e) : (undefined as T);
    try {
      target.setPointerCapture(pointerId);
    } catch {}
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > 3) moved = true;
      if (moved) ref.current.onMove(dx, dy, ev, startData);
    };
    let done = false;
    const onUp = (ev: PointerEvent) => {
      if (ev && ev.pointerId !== pointerId) return;
      if (done) return;
      done = true;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onBlur);
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        /* the element may already be gone */
      }
      ref.current.onEnd?.(moved, startData);
    };
    // Losing the window mid-drag (alt-tab, a system dialog) ends the gesture
    // rather than leaving it hanging.
    const onBlur = () => onUp(null as unknown as PointerEvent);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onBlur);
  }, []);
}

/** Long-press detector for touch context menus. */
export function longPress(cb: (x: number, y: number) => void, ms = 500) {
  return (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    const { clientX, clientY } = e;
    const target = e.currentTarget as HTMLElement;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) cb(clientX, clientY);
    }, ms);
    const cancel = () => {
      cancelled = true;
      clearTimeout(timer);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', cancel);
      target.removeEventListener('pointercancel', cancel);
    };
    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - clientX, ev.clientY - clientY) > 8) cancel();
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', cancel);
    target.addEventListener('pointercancel', cancel);
  };
}

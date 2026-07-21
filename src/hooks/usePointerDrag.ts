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
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      try {
        target.releasePointerCapture(pointerId);
      } catch {}
      ref.current.onEnd?.(moved, startData);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
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

import { useEffect, type RefObject } from 'react';

/**
 * Modal focus management.
 *
 * A dialog that does not take focus is a dialog a keyboard user cannot reach,
 * and one that does not trap it is a dialog they tab straight out of into the
 * page behind — where their next keystroke edits a project they cannot see.
 * This does the three things a modal owes: move focus in, keep it in, and give
 * it back to whatever opened the dialog when it closes.
 *
 * It deliberately does NOT close on Escape: each dialog decides that, because
 * some of them (an export mid-render) must not vanish on a stray key.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    // Focus the first control rather than the dialog itself: a screen reader
    // announces the dialog from its label either way, and a sighted keyboard
    // user gets to act immediately instead of pressing Tab first.
    const first = focusables()[0];
    (first ?? root).focus?.();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      const active2 = document.activeElement;
      if (e.shiftKey && (active2 === firstEl || !root.contains(active2))) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active2 === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // Returning focus is what makes a dialog feel like it belongs to the
      // control that opened it rather than to the page.
      previous?.focus?.();
    };
  }, [ref, active]);
}

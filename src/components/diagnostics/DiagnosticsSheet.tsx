import { useEffect, useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';
import { DiagnosticsPanel } from './DiagnosticsPanel';

/**
 * Diagnostics, used on tablet and phone and from the top bar's wrench.
 *
 * Its own comment called it modal and it was not one. It had a scrim and a
 * backdrop click, and then `role="complementary"`, no `aria-modal`, no focus
 * trap and no Escape — so a keyboard user tabbed out of it into a project they
 * could not see, and had no key that would close it. Its four sibling sheets
 * are all real modals; this one was the odd one out, and the odd one out is
 * always the one that was written last.
 */
export function DiagnosticsSheet() {
  const open = useUiStore((s) => s.diagnosticsOpen);
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Captured, so the sheet closes before the arrangement behind it reads
      // the key and clears a selection the user cannot see.
      e.stopPropagation();
      e.preventDefault();
      useUiStore.getState().set({ diagnosticsOpen: false });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="sheet-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) useUiStore.getState().set({ diagnosticsOpen: false });
      }}
    >
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Diagnostics"
        data-testid="diagnostics-sheet"
      >
        <div className="panel-title">
          Diagnostics
          <span className="spacer" style={{ flex: 1 }} />
          <button
            className="icon-btn"
            onClick={() => useUiStore.getState().set({ diagnosticsOpen: false })}
            aria-label="Close diagnostics"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <DiagnosticsPanel />
      </div>
    </div>
  );
}

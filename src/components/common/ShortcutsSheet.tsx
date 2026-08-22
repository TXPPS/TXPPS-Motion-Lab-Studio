import { useEffect, useRef } from 'react';
import { SHORTCUTS } from '../../app/shortcuts';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useUiStore } from '../../state/uiStore';

const CATEGORIES = [
  'Transport',
  'Project',
  'Selection',
  'Editing',
  'Piano roll',
  'Automation',
  'View',
] as const;

/**
 * Keyboard shortcut reference, opened with "?" or from the overflow menu.
 * Rendered from the same registry the conflict test checks, so this sheet
 * cannot describe bindings that do not exist.
 */
export function ShortcutsSheet() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const close = () => useUiStore.getState().set({ shortcutsOpen: false });
  const panelRef = useRef<HTMLDivElement>(null);

  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    // Capture phase, so the global Escape handler (panic etc.) never sees it.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="sheet-overlay sc-center"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        className="sc-sheet"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        data-testid="shortcuts-sheet"
      >
        <div className="panel-title">
          {/* A real heading, so the section headings below it are a level down
              rather than a jump from nothing to h3. */}
          <h2>Keyboard shortcuts</h2>
          <span className="spacer" style={{ flex: 1 }} />
          <button
            className="icon-btn"
            onClick={close}
            aria-label="Close"
            data-testid="shortcuts-close"
          >
            ✕
          </button>
        </div>
        <div className="sc-body">
          {CATEGORIES.map((cat) => (
            <section key={cat} className="sc-group">
              <h3>{cat}</h3>
              {SHORTCUTS.filter((s) => s.category === cat).map((s) => (
                <div className="sc-row" key={s.id}>
                  <kbd>{s.display}</kbd>
                  <span className="sc-desc">
                    {s.description}
                    {s.when && <span className="sc-when"> — {s.when}</span>}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

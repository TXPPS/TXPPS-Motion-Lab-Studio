import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';
import { DiagnosticsPanel } from './DiagnosticsPanel';

/** Modal diagnostics used on tablet/phone and via the topbar wrench everywhere. */
export function DiagnosticsSheet() {
  const open = useUiStore((s) => s.diagnosticsOpen);
  if (!open) return null;
  return (
    <div
      className="sheet-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) useUiStore.getState().set({ diagnosticsOpen: false });
      }}
    >
      <div
        className="sheet"
        role="complementary"
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

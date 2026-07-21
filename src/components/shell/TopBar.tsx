import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { renameCurrent, saveCurrent } from '../../app/projectActions';
import { Icon } from '../common/Icon';
import type { Layout } from '../../hooks/useViewport';

export function TopBar({ layout }: { layout: Layout }) {
  const name = useProjectStore((s) => s.project.name);
  const dirty = useProjectStore((s) => s.dirty);
  const canUndo = useProjectStore((s) => s.undoStack.length > 0);
  const canRedo = useProjectStore((s) => s.redoStack.length > 0);
  const store = useProjectStore.getState();
  const ui = useUiStore;
  const panelBrowser = useUiStore((s) => s.panelBrowser);
  const panelInspector = useUiStore((s) => s.panelInspector);
  const panelEditor = useUiStore((s) => s.panelEditor);

  return (
    <div className="topbar">
      <div className="brand">
        <Icon name="logo" size={22} />
        <span className="brand-name">
          MotionLab
          {layout === 'desktop' && <span className="brand-sub"> Studio</span>}
        </span>
      </div>

      <button
        className="project-name"
        title="Rename project"
        data-testid="project-name"
        onClick={() =>
          ui.getState().showDialog({
            kind: 'prompt',
            title: 'Rename project',
            initialValue: name,
            confirmLabel: 'Rename',
            onSubmit: (v) => v && void renameCurrent(v),
          })
        }
      >
        {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        {name}
      </button>

      <div className="topbar-group">
        <button
          className="icon-btn"
          onClick={() => store.undo()}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <Icon name="undo" size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() => store.redo()}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
        >
          <Icon name="redo" size={15} />
        </button>
        {layout !== 'phone' && (
          <button
            className="icon-btn"
            onClick={() => void saveCurrent()}
            title="Save (Ctrl+S)"
            aria-label="Save"
            data-testid="topbar-save"
          >
            <Icon name="save" size={15} />
          </button>
        )}
      </div>

      <span className="spacer" style={{ flex: 1 }} />

      {layout === 'desktop' && (
        <div className="topbar-group">
          <button
            className={`icon-btn${panelBrowser ? ' on' : ''}`}
            onClick={() => ui.getState().set({ panelBrowser: !panelBrowser })}
            title="Toggle browser"
            aria-label="Toggle browser panel"
          >
            <Icon name="panel-left" size={15} />
          </button>
          <button
            className={`icon-btn${panelEditor ? ' on' : ''}`}
            onClick={() => ui.getState().set({ panelEditor: !panelEditor })}
            title="Toggle bottom editor"
            aria-label="Toggle editor panel"
          >
            <Icon name="panel-bottom" size={15} />
          </button>
          <button
            className={`icon-btn${panelInspector ? ' on' : ''}`}
            onClick={() => ui.getState().set({ panelInspector: !panelInspector })}
            title="Toggle inspector"
            aria-label="Toggle inspector panel"
          >
            <Icon name="panel-right" size={15} />
          </button>
        </div>
      )}

      <button
        className="icon-btn"
        onClick={() => ui.getState().set({ diagnosticsOpen: true })}
        title="Diagnostics"
        aria-label="Open diagnostics"
        data-testid="open-diagnostics"
      >
        <Icon name="wrench" size={15} />
      </button>
    </div>
  );
}

import { useUiStore } from '../../state/uiStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { Icon } from '../common/Icon';
import { MaximizeButton } from './MaximizeButton';
import { EditorBody, EditorTabs } from './EditorSurface';

/**
 * Bottom editor. Sizing is owned entirely by the surrounding resizable panel —
 * this component only fills the height it is given, so its content can never
 * push the panel beyond its bounds.
 *
 * Which editors exist comes from `app/editors.ts`, so adding one is one entry
 * rather than an edit in six files. The tabs and the body moved to
 * `EditorSurface` when a phone and a tablet needed the same two parts without
 * the maximise and collapse buttons below, which are the desktop's alone: five
 * editors were reachable here and on no smaller screen.
 */
export function BottomEditor() {
  const tab = useUiStore((s) => s.editorTab);

  return (
    <div className="editor-panel" data-testid="bottom-editor">
      <div className="editor-tabs">
        <EditorTabs />
        <div className="tab-actions">
          <MaximizeButton pane="editor" label="editor" />
          <button
            className="icon-btn"
            onClick={() => useWorkspaceStore.getState().toggle('showEditor')}
            title="Hide editor panel"
            aria-label="Hide editor panel"
          >
            <Icon name="chevron-down" size={15} />
          </button>
        </div>
      </div>
      <EditorBody key={tab} />
    </div>
  );
}

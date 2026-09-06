import { useWorkspaceStore } from '../../state/workspaceStore';
import { Icon } from '../common/Icon';
import { MaximizeButton } from './MaximizeButton';
import { CollapseButton } from './PaneRail';
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
 *
 * Three controls, three intentions, and they are genuinely different: full
 * screen gives the editor the window, collapse gives the height back and keeps a
 * rail to come back through, and hide takes the pane out of the layout
 * altogether. The chevron was doing the middle two at once and neither well —
 * it hid the pane and forgot its size, so re-opening always landed on the
 * default however far the divider had been dragged.
 */
export function BottomEditor() {
  const tab = useWorkspaceStore((s) => s.editorTab);

  return (
    <div className="editor-panel" data-testid="bottom-editor">
      <div className="editor-tabs">
        <EditorTabs />
        <div className="tab-actions">
          <MaximizeButton pane="editor" label="editor" />
          <CollapseButton id="editor" label="editor" />
          <button
            className="icon-btn"
            onClick={() => useWorkspaceStore.getState().togglePane('editor')}
            title="Hide editor panel"
            aria-label="Hide editor panel"
            data-testid="hide-editor"
          >
            <Icon name="x" size={15} />
          </button>
        </div>
      </div>
      <EditorBody key={tab} />
    </div>
  );
}

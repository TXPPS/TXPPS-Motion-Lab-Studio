import { Suspense } from 'react';
import { EDITORS } from '../../app/editors';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { Icon } from '../common/Icon';
import { MaximizeButton } from './MaximizeButton';

/**
 * Bottom editor. Sizing is owned entirely by the surrounding resizable panel —
 * this component only fills the height it is given, so its content can never
 * push the panel beyond its bounds.
 *
 * Which editors exist comes from `app/editors.ts`, so adding one is one entry
 * rather than an edit in six files.
 */
export function BottomEditor() {
  const tab = useUiStore((s) => s.editorTab);
  const project = useProjectStore((s) => s.project);
  const trackId = useUiStore((s) => s.selectedTrackId);
  const clipId = useUiStore((s) => s.editClipId);
  const selection = { trackId, clipId };

  const active = EDITORS.find((e) => e.id === tab) ?? EDITORS[0];
  const Body = active.component;

  return (
    <div className="editor-panel" data-testid="bottom-editor">
      <div className="editor-tabs">
        {/* The tablist wraps only the tabs; display:contents keeps the flex
            row identical while the collapse button stays outside the role. */}
        <div role="tablist" aria-label="Editor" style={{ display: 'contents' }}>
          {EDITORS.map((e) => {
            const ok = e.appliesTo ? e.appliesTo(project, selection) : true;
            return (
              <button
                key={e.id}
                className={`tab${tab === e.id ? ' on' : ''}${ok ? '' : ' dim'}`}
                role="tab"
                aria-selected={tab === e.id}
                title={ok ? e.hint : (e.unavailable ?? e.hint)}
                onClick={() => useUiStore.getState().set({ editorTab: e.id })}
                data-testid={`editor-tab-${e.id}`}
              >
                <Icon name={e.icon} size={12} />
                <span>{e.label}</span>
              </button>
            );
          })}
        </div>
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
      <div className="editor-body" role="tabpanel">
        <Suspense fallback={<div className="page-loading">Loading…</div>}>
          <Body />
        </Suspense>
      </div>
    </div>
  );
}

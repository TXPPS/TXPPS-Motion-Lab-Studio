import { useUiStore, type EditorTab } from '../../state/uiStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { Mixer } from '../mixer/Mixer';
import { PianoRoll } from '../pianoroll/PianoRoll';
import { SynthPanel } from '../synth/SynthPanel';
import { DiagnosticsPanel } from '../diagnostics/DiagnosticsPanel';
import { Icon } from '../common/Icon';
import { MaximizeButton } from './MaximizeButton';

const TABS: { id: EditorTab; label: string }[] = [
  { id: 'mixer', label: 'Mixer' },
  { id: 'piano', label: 'Piano Roll' },
  { id: 'synth', label: 'Synth' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

/**
 * Bottom editor. Sizing is owned entirely by the surrounding resizable panel —
 * this component only fills the height it is given, so its content can never
 * push the panel beyond its bounds.
 */
export function BottomEditor() {
  const tab = useUiStore((s) => s.editorTab);

  return (
    <div className="editor-panel" data-testid="bottom-editor">
      <div className="editor-tabs">
        {/* The tablist wraps only the tabs; display:contents keeps the flex
            row identical while the collapse button stays outside the role. */}
        <div role="tablist" aria-label="Editor" style={{ display: 'contents' }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab${tab === t.id ? ' on' : ''}`}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => useUiStore.getState().set({ editorTab: t.id })}
              data-testid={`editor-tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
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
        {tab === 'mixer' && <Mixer />}
        {tab === 'piano' && <PianoRoll />}
        {tab === 'synth' && <SynthPanel />}
        {tab === 'diagnostics' && <DiagnosticsPanel />}
      </div>
    </div>
  );
}

import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { renameCurrent, saveCurrent } from '../../app/projectActions';
import { exportLoopRegion, exportWav } from '../../app/exportActions';
import { exportMidiFile, pickMidiFile } from '../../app/midiFileActions';
import { Icon, type IconName } from '../common/Icon';
import { useRouteStore } from '../../state/routeStore';
import type { PageId } from '../../app/router';
import type { Layout } from '../../hooks/useViewport';

const PAGES: { id: PageId; label: string; icon: IconName; hint: string }[] = [
  { id: 'start', label: 'Start', icon: 'home', hint: 'Recent work and templates' },
  { id: 'song', label: 'Song', icon: 'wave', hint: 'The workstation' },
  { id: 'mastering', label: 'Release', icon: 'meter', hint: 'Mastering and delivery' },
  { id: 'show', label: 'Live', icon: 'zap', hint: 'Setlist and stage view' },
];

export function TopBar({ layout }: { layout: Layout }) {
  const page = useRouteStore((s) => s.route.page);
  const name = useProjectStore((s) => s.project.name);
  const dirty = useProjectStore((s) => s.dirty);
  const canUndo = useProjectStore((s) => s.undoStack.length > 0);
  const canRedo = useProjectStore((s) => s.redoStack.length > 0);
  const showBrowser = useWorkspaceStore((s) => s.showBrowser);
  const showInspector = useWorkspaceStore((s) => s.showInspector);
  const showEditor = useWorkspaceStore((s) => s.showEditor);
  const store = useProjectStore.getState();
  const ui = useUiStore;

  const overflowMenu = (x: number, y: number) => {
    const ws = useWorkspaceStore.getState();
    ui.getState().showMenu({
      x,
      y,
      items: [
        { label: 'Save project', action: () => void saveCurrent() },
        ...(layout === 'desktop'
          ? [
              {
                label: `${showBrowser ? 'Hide' : 'Show'} browser`,
                action: () => ws.toggle('showBrowser'),
              },
              {
                label: `${showEditor ? 'Hide' : 'Show'} bottom editor`,
                action: () => ws.toggle('showEditor'),
              },
              {
                label: `${showInspector ? 'Hide' : 'Show'} inspector`,
                action: () => ws.toggle('showInspector'),
              },
              { label: 'Reset layout', action: () => ws.reset() },
            ]
          : []),
        { label: 'Import MIDI file…', action: () => pickMidiFile() },
        {
          label: 'Export MIDI file',
          action: () => {
            exportMidiFile();
          },
        },
        {
          label: 'Export…',
          shortcut: 'Ctrl+Shift+E',
          action: () => ui.getState().set({ exportOpen: true }),
        },
        { label: 'Quick bounce: mix as WAV', action: () => void exportWav() },
        { label: 'Quick bounce: loop as WAV', action: () => void exportLoopRegion() },
        {
          label: 'Keyboard shortcuts…',
          shortcut: '?',
          action: () => ui.getState().set({ shortcutsOpen: true }),
        },
        {
          label: 'Preferences…',
          action: () => ui.getState().set({ settingsOpen: true }),
        },
        { label: 'Welcome tour…', action: () => ui.getState().set({ welcomeOpen: true }) },
        { label: 'Diagnostics…', action: () => ui.getState().set({ diagnosticsOpen: true }) },
      ],
    });
  };

  return (
    <header className="topbar">
      <div className="brand">
        <Icon name="logo" size={22} />
        <h1 className="brand-name">
          MotionLab
          {layout === 'desktop' && <span className="brand-sub"> Studio</span>}
        </h1>
      </div>

      <button
        className="project-name"
        title={`${name} — click to rename`}
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
        <span className="pname">{name}</span>
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

      {/* The four top-level pages. On a phone this collapses to icons; the
          labels are what make the page model discoverable at all. */}
      <nav className="page-nav" aria-label="Pages">
        {PAGES.map((p) => (
          <button
            key={p.id}
            className={`page-tab${page === p.id ? ' on' : ''}`}
            aria-current={page === p.id ? 'page' : undefined}
            title={`${p.label} — ${p.hint}`}
            onClick={() => useRouteStore.getState().go(p.id)}
            data-testid={`page-${p.id}`}
          >
            <Icon name={p.icon} size={14} />
            {layout !== 'phone' && <span>{p.label}</span>}
          </button>
        ))}
      </nav>

      <span className="spacer" />

      {layout === 'desktop' && (
        <div className="topbar-group">
          <button
            className={`icon-btn${showBrowser ? ' on' : ''}`}
            onClick={() => useWorkspaceStore.getState().toggle('showBrowser')}
            title="Toggle browser panel"
            aria-label="Toggle browser panel"
            aria-pressed={showBrowser}
          >
            <Icon name="panel-left" size={15} />
          </button>
          <button
            className={`icon-btn${showEditor ? ' on' : ''}`}
            onClick={() => useWorkspaceStore.getState().toggle('showEditor')}
            title="Toggle bottom editor"
            aria-label="Toggle bottom editor"
            aria-pressed={showEditor}
          >
            <Icon name="panel-bottom" size={15} />
          </button>
          <button
            className={`icon-btn${showInspector ? ' on' : ''}`}
            onClick={() => useWorkspaceStore.getState().toggle('showInspector')}
            title="Toggle inspector panel"
            aria-label="Toggle inspector panel"
            aria-pressed={showInspector}
          >
            <Icon name="panel-right" size={15} />
          </button>
        </div>
      )}

      <button
        className="icon-btn"
        onClick={() => ui.getState().set({ settingsOpen: true })}
        title="Preferences"
        aria-label="Open preferences"
        data-testid="open-settings"
      >
        <Icon name="settings" size={15} />
      </button>
      <button
        className="icon-btn"
        onClick={() => ui.getState().set({ diagnosticsOpen: true })}
        title="Diagnostics"
        aria-label="Open diagnostics"
        data-testid="open-diagnostics"
      >
        <Icon name="wrench" size={15} />
      </button>
      <button
        className="icon-btn"
        onClick={(e) => overflowMenu(e.clientX, e.clientY)}
        title="More"
        aria-label="More actions"
        data-testid="topbar-overflow"
      >
        <Icon name="dots" size={15} />
      </button>
    </header>
  );
}

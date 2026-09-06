/**
 * Named workspaces, as a control and as a menu.
 *
 * One module rather than a control per shell, because the commands are the same
 * five everywhere — recall, save, rename, delete, reset — and a shell that grew
 * its own copy is how the tablet came to have a `useState` opinion about which
 * editor was showing. What differs per form factor is where the control sits and
 * how big it is, which is the shell's business; what the commands *are* is not.
 *
 * The menu goes through `uiStore`'s own context-menu host, so it inherits the
 * focus handling, the arrow keys, the Escape and the click-outside that every
 * other menu in the product has. Building a bespoke popover here would have been
 * the fifth sheet that was written last and quietly left out a focus trap.
 */
import { useUiStore, type MenuItem } from '../../state/uiStore';
import { PANE_IDS, useWorkspaceStore, type PaneId } from '../../state/workspaceStore';
import { Icon } from '../common/Icon';

/** What each pane is called where a person reads it. */
const PANE_LABEL: Record<PaneId, string> = {
  browser: 'browser panel',
  editor: 'bottom editor',
  inspector: 'inspector panel',
};

/**
 * Show/hide and collapse/expand, for all three panes.
 *
 * On every form factor rather than on the desktop, which is where they used to
 * be: the panes they name exist everywhere — a tablet's editor pane is the same
 * pane — and a phone can be handed a layout with one hidden by recalling a
 * workspace. A command that can put the product into a state and cannot take it
 * back out is the shape of every trap in this file's history.
 */
export function paneMenuItems(): MenuItem[] {
  const ws = useWorkspaceStore.getState();
  return [
    ...PANE_IDS.map((id) => ({
      label: `${ws.panes[id].visible ? 'Hide' : 'Show'} ${PANE_LABEL[id]}`,
      testId: `menu-toggle-${id}`,
      action: () => useWorkspaceStore.getState().togglePane(id),
    })),
    ...PANE_IDS.map((id) => ({
      label: `${ws.panes[id].collapsed ? 'Expand' : 'Collapse'} ${PANE_LABEL[id]}`,
      testId: `menu-collapse-${id}`,
      // A collapse on a pane that is hidden outright would fold a rail nobody
      // can see, so the command reveals it first — the same reasoning as
      // `reveal`, and the reason it is one action rather than two menu rows.
      action: () => {
        const store = useWorkspaceStore.getState();
        if (!store.panes[id].visible) store.togglePane(id);
        store.toggleCollapsed(id);
      },
    })),
  ];
}

/**
 * Everything about the layout, in one menu.
 *
 * What the desktop's workspace button opens, and what "Workspace…" in the
 * overflow opens on a tablet and a phone — one list rather than a copy of one.
 */
export function paneAndWorkspaceItems(): MenuItem[] {
  return [...paneMenuItems(), ...workspaceMenuItems()];
}

/**
 * The five commands, built against the store as it stands right now.
 *
 * Exported so a shell can fold them into a menu it is already opening — the
 * phone and tablet reach these through the top bar's overflow rather than
 * spending a bar slot on them, and a second list built there would be a second
 * list to keep matching.
 */
export function workspaceMenuItems(): MenuItem[] {
  const ws = useWorkspaceStore.getState();
  const ui = useUiStore.getState();
  const active = ws.activeWorkspaceId;

  const askForName = (title: string, initialValue: string, onName: (v: string) => void) =>
    ui.showDialog({
      kind: 'prompt',
      title,
      initialValue,
      confirmLabel: 'Save',
      onSubmit: (v) => {
        const name = v.trim();
        if (name) onName(name);
      },
    });

  const recallItems: MenuItem[] = ws.workspaces.map((w) => ({
    label: `${w.id === active ? '• ' : ''}${w.name}`,
    testId: `workspace-recall-${w.id}`,
    action: () => useWorkspaceStore.getState().recallWorkspace(w.id),
  }));

  /** The saved ones only: a built-in has no name of its own to change. */
  const mine = ws.workspaces.filter((w) => !w.builtIn);
  const current = ws.workspaces.find((w) => w.id === active);

  return [
    ...recallItems,
    {
      label: 'Save this layout as…',
      testId: 'workspace-save',
      action: () =>
        askForName('Name this workspace', current?.name ?? 'My workspace', (name) =>
          useWorkspaceStore.getState().saveWorkspace(name),
        ),
    },
    {
      label: 'Rename workspace…',
      testId: 'workspace-rename',
      // Disabled rather than absent when there is nothing to rename: a menu that
      // changes length between two openings is a menu whose items move under the
      // pointer, and the item is what tells somebody the command exists at all.
      disabled: !current || current.builtIn,
      action: () => {
        if (!current || current.builtIn) return;
        askForName('Rename workspace', current.name, (name) =>
          useWorkspaceStore.getState().renameWorkspace(current.id, name),
        );
      },
    },
    {
      label: 'Delete workspace…',
      testId: 'workspace-delete',
      danger: true,
      disabled: !current || current.builtIn,
      action: () => {
        if (!current || current.builtIn) return;
        ui.showDialog({
          kind: 'confirm',
          title: `Delete “${current.name}”?`,
          message:
            mine.length === 1
              ? 'This is your only saved workspace. The built-in ones stay.'
              : 'The layout itself is untouched — only the saved name goes.',
          confirmLabel: 'Delete',
          danger: true,
          onSubmit: () => useWorkspaceStore.getState().deleteWorkspace(current.id),
        });
      },
    },
    {
      label: 'Reset layout',
      testId: 'workspace-reset',
      action: () => useWorkspaceStore.getState().reset(),
    },
  ];
}

/**
 * The top bar's button. Named after the workspace showing, so the bar says which
 * layout you are in rather than only offering to change it.
 */
export function WorkspaceButton() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const active = workspaces.find((w) => w.id === activeId);
  return (
    <button
      className="btn workspace-btn"
      data-testid="workspace-menu"
      title="Workspaces — save this layout, or recall one"
      aria-label="Workspaces"
      aria-haspopup="menu"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        // Anchored to the button's own bottom-left rather than to the pointer,
        // so a keyboard activation (which reports 0,0) opens the menu under the
        // control instead of in the corner of the window.
        useUiStore.getState().showMenu({ x: r.left, y: r.bottom, items: paneAndWorkspaceItems() });
      }}
    >
      <Icon name="layers" size={13} />
      <span className="ws-name">{active ? active.name : 'Workspace'}</span>
    </button>
  );
}

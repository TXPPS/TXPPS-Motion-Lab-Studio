/**
 * The eight stores outside the project: session state and per-device settings.
 *
 * These carry no undo and no document, so the pattern collapses to two claims —
 * the call changed something, and what it changed reaches storage where the
 * store has any. The second is the one worth having: four of these stores are
 * the reason a preference survives a reload, and a setter that updates memory
 * and forgets to persist looks perfect until the next launch.
 */
import { useChainStore } from '../../../src/state/chainStore';
import { useInputStore } from '../../../src/state/inputStore';
import { useKeymapStore } from '../../../src/state/keymapStore';
import { usePrefsStore } from '../../../src/state/prefsStore';
import { useRouteStore } from '../../../src/state/routeStore';
import type { PageId, Route } from '../../../src/app/router';
import { useTransportStore } from '../../../src/state/transportStore';
import { BUILT_IN_WORKSPACES, useWorkspaceStore } from '../../../src/state/workspaceStore';
import type { ChainStepLike } from '../../../src/app/chainActions';
import type { Recipe } from '../harness';

export interface ShellStore {
  /** The store's name as the Function Ledger writes it. */
  name: string;
  read: () => Record<string, unknown>;
  /** Return it to a known baseline before each row. */
  reset: () => void;
  /** The localStorage entry it writes, where it writes one. */
  persistKey?: string;
  /**
   * How the store is made to write now, where its write is debounced.
   *
   * The workspace debounces by 400 ms and flushes on `pagehide`; firing that
   * event is the same path a closing tab takes, so the check stays a check on
   * the product rather than on a door opened for it.
   */
  flush?: () => void;
  recipes: () => Recipe[];
}

const SESSION_ONLY = 'session state: it is gone when the tab closes, by design';

const chain: ShellStore = {
  name: 'chainStore',
  read: () => useChainStore.getState() as unknown as Record<string, unknown>,
  reset: () => useChainStore.getState().reset(),
  persistKey: 'motionlab.chains.v1',
  recipes: () => {
    const s = () => useChainStore.getState();
    const step: ChainStepLike[] = [{ kind: 'eq3', params: { midDb: 3 } }];
    return [
      {
        id: 'store:chainStore.save',
        undo: 'none',
        run: () => `saved ${s().save('Sweep chain', step)}`,
      },
      {
        id: 'store:chainStore.remove',
        undo: 'none',
        arrange: () => void s().save('Doomed', step),
        run: () => {
          s().remove(s().chains[0].id);
          return `${s().chains.length} chains left`;
        },
      },
      {
        id: 'store:chainStore.reset',
        undo: 'none',
        arrange: () => void s().save('Doomed', step),
        run: () => {
          s().reset();
          return `${s().chains.length} chains left`;
        },
      },
    ];
  },
};

const keymap: ShellStore = {
  name: 'keymapStore',
  read: () => useKeymapStore.getState() as unknown as Record<string, unknown>,
  reset: () => useKeymapStore.getState().resetAll(),
  persistKey: 'motionlab.keymap.v1',
  recipes: () => {
    const s = () => useKeymapStore.getState();
    return [
      {
        id: 'store:keymapStore.setBinding',
        undo: 'none',
        run: () => {
          s().setBinding('undo', 'Ctrl+Alt+Z');
          return `undo -> ${s().overrides.undo}`;
        },
      },
      {
        id: 'store:keymapStore.clearBinding',
        undo: 'none',
        arrange: () => s().setBinding('undo', 'Ctrl+Alt+Z'),
        run: () => {
          s().clearBinding('undo');
          return `${Object.keys(s().overrides).length} overrides`;
        },
      },
      {
        id: 'store:keymapStore.resetAll',
        undo: 'none',
        arrange: () => s().setBinding('redo', 'Ctrl+Alt+Y'),
        run: () => {
          s().resetAll();
          return `${Object.keys(s().overrides).length} overrides`;
        },
      },
    ];
  },
};

const prefs: ShellStore = {
  name: 'prefsStore',
  read: () => usePrefsStore.getState() as unknown as Record<string, unknown>,
  reset: () => usePrefsStore.getState().reset(),
  persistKey: 'motionlab.prefs.v1',
  recipes: () => {
    const s = () => usePrefsStore.getState();
    return [
      {
        id: 'store:prefsStore.set',
        undo: 'none',
        run: () => {
          s().set({ theme: 'light' });
          return `theme ${s().theme}`;
        },
      },
      {
        id: 'store:prefsStore.reset',
        undo: 'none',
        arrange: () => s().set({ theme: 'light' }),
        run: () => {
          s().reset();
          return `theme ${s().theme}`;
        },
      },
    ];
  },
};

const workspace: ShellStore = {
  name: 'workspaceStore',
  read: () => useWorkspaceStore.getState() as unknown as Record<string, unknown>,
  /*
   * The layout AND the saved workspaces.
   *
   * `reset()` is the product's "Reset layout" and deliberately keeps the saved
   * names — deleting somebody's screensets because they wanted the default panes
   * back would be a command doing far more than it says. That makes it the wrong
   * baseline for a sweep: four rows here save a workspace, `uniqueName` would
   * append a "2" to the second row's, and the row asserting on a name would fail
   * for the order the rows happened to run in rather than for the product.
   */
  reset: () => {
    useWorkspaceStore.getState().reset();
    useWorkspaceStore.setState({ workspaces: [...BUILT_IN_WORKSPACES], activeWorkspaceId: null });
  },
  persistKey: 'txpps-motionlab-workspace-v2',
  flush: () => window.dispatchEvent(new Event('pagehide')),
  recipes: () => {
    const s = () => useWorkspaceStore.getState();
    return [
      {
        id: 'store:workspaceStore.setLayout',
        undo: 'none',
        run: () => {
          s().setLayout({ showTempoLane: true });
          return `showTempoLane ${s().showTempoLane}`;
        },
      },
      {
        id: 'store:workspaceStore.setPane',
        undo: 'none',
        run: () => {
          s().setPane('browser', { size: 32 });
          return `browser ${s().panes.browser.size}`;
        },
      },
      {
        id: 'store:workspaceStore.setPaneSize',
        undo: 'none',
        run: () => {
          s().setPaneSize('inspector', 25);
          return `inspector ${s().panes.inspector.size}`;
        },
      },
      {
        id: 'store:workspaceStore.toggle',
        undo: 'none',
        run: () => {
          s().toggle('showChords');
          return `showChords ${s().showChords}`;
        },
      },
      {
        id: 'store:workspaceStore.togglePane',
        undo: 'none',
        run: () => {
          s().togglePane('browser');
          return `browser visible ${s().panes.browser.visible}`;
        },
      },
      {
        id: 'store:workspaceStore.toggleCollapsed',
        undo: 'none',
        // From a size that is not the default, so the row says something about
        // the memory rather than only about the flag: a collapse that forgot
        // `lastSize` would return the same sentence with a different number.
        arrange: () => s().setPaneSize('editor', 44),
        run: () => {
          s().toggleCollapsed('editor');
          const p = s().panes.editor;
          return `editor collapsed ${p.collapsed}, back to ${p.lastSize}`;
        },
      },
      {
        id: 'store:workspaceStore.setMaximized',
        undo: 'none',
        run: () => {
          s().setMaximized('editor');
          return `maximized ${s().maximized}`;
        },
      },
      {
        id: 'store:workspaceStore.reveal',
        undo: 'none',
        arrange: () => {
          if (useWorkspaceStore.getState().panes.inspector.visible) s().togglePane('inspector');
        },
        run: () => {
          s().reveal('inspector');
          return `inspector visible ${s().panes.inspector.visible}`;
        },
      },
      {
        id: 'store:workspaceStore.showEditorTab',
        undo: 'none',
        arrange: () => {
          if (useWorkspaceStore.getState().panes.editor.visible) s().togglePane('editor');
        },
        run: () => {
          s().showEditorTab('channel');
          return `tab ${s().editorTab}, pane ${s().panes.editor.visible}`;
        },
      },
      {
        id: 'store:workspaceStore.setPhoneMode',
        undo: 'none',
        run: () => {
          s().setPhoneMode('mix');
          return `phoneMode ${s().phoneMode}`;
        },
      },
      {
        id: 'store:workspaceStore.saveWorkspace',
        undo: 'none',
        run: () => {
          const id = s().saveWorkspace('Sweep layout');
          return `saved ${s().workspaces.find((w) => w.id === id)?.name}`;
        },
      },
      {
        id: 'store:workspaceStore.recallWorkspace',
        undo: 'none',
        // Saved at one size, changed, then recalled: a recall that did nothing
        // would leave the store where `arrange` left it and phase 1 would say so.
        arrange: () => {
          s().setPaneSize('browser', 30);
          s().saveWorkspace('Recall me');
          s().setPaneSize('browser', 12);
        },
        run: () => {
          const target = s().workspaces.find((w) => w.name === 'Recall me')!;
          s().recallWorkspace(target.id);
          return `browser back to ${s().panes.browser.size}`;
        },
      },
      {
        id: 'store:workspaceStore.renameWorkspace',
        undo: 'none',
        arrange: () => void s().saveWorkspace('Before'),
        run: () => {
          const target = s().workspaces.find((w) => w.name === 'Before')!;
          s().renameWorkspace(target.id, 'After');
          return `named ${s().workspaces.find((w) => w.id === target.id)?.name}`;
        },
      },
      {
        id: 'store:workspaceStore.deleteWorkspace',
        undo: 'none',
        arrange: () => void s().saveWorkspace('Doomed'),
        run: () => {
          const target = s().workspaces.find((w) => w.name === 'Doomed')!;
          s().deleteWorkspace(target.id);
          return `${s().workspaces.filter((w) => !w.builtIn).length} saved workspace(s) left`;
        },
      },
      {
        id: 'store:workspaceStore.reset',
        undo: 'none',
        arrange: () => s().setPaneSize('browser', 32),
        run: () => {
          s().reset();
          return `browser ${s().panes.browser.size}`;
        },
      },
    ];
  },
};

/** A whole Route, since `setRoute` takes the parsed hash rather than a patch. */
const routeTo = (page: PageId): Route => ({
  page,
  fixture: null,
  reseedDemo: false,
  forcePhone: false,
  openDiagnostics: false,
  debugOverlay: false,
  raw: `#/${page}`,
});

const route: ShellStore = {
  name: 'routeStore',
  read: () => useRouteStore.getState() as unknown as Record<string, unknown>,
  reset: () => useRouteStore.getState().setRoute(routeTo('song')),
  recipes: () => {
    const s = () => useRouteStore.getState();
    return [
      {
        id: 'store:routeStore.setRoute',
        undo: 'none',
        transient: 'the URL hash is the storage; the store is a mirror of it',
        run: () => {
          s().setRoute(routeTo('mastering'));
          return `page ${s().route.page}`;
        },
      },
      {
        id: 'store:routeStore.go',
        undo: 'none',
        transient: 'the URL hash is the storage; the store is a mirror of it',
        run: () => {
          s().go('show');
          return `page ${s().route.page}, hash ${window.location.hash}`;
        },
      },
    ];
  },
};

const transport: ShellStore = {
  name: 'transportStore',
  read: () => useTransportStore.getState() as unknown as Record<string, unknown>,
  reset: () => useTransportStore.getState().set({ playState: 'stopped', positionBeats: 0 }),
  recipes: () => [
    {
      id: 'store:transportStore.set',
      undo: 'none',
      transient: 'a mirror of engine state; the engine is the only writer that matters',
      run: () => {
        useTransportStore.getState().set({ playState: 'playing', positionBeats: 12 });
        return `playState ${useTransportStore.getState().playState}`;
      },
    },
  ],
};

const input: ShellStore = {
  name: 'inputStore',
  read: () => useInputStore.getState() as unknown as Record<string, unknown>,
  reset: () => useInputStore.getState().set({ phase: 'idle', recordSeconds: 0 }),
  recipes: () => [
    {
      id: 'store:inputStore.set',
      undo: 'none',
      transient: SESSION_ONLY,
      run: () => {
        useInputStore.getState().set({ phase: 'recording', recordSeconds: 3 });
        return `phase ${useInputStore.getState().phase}`;
      },
    },
  ],
};

import { ui } from './shellUi';

export { chain, input, keymap, prefs, route, transport, ui, workspace };

export const SHELL_STORES: ShellStore[] = [
  chain,
  input,
  keymap,
  prefs,
  route,
  transport,
  ui,
  workspace,
];

export const shellRecipes = (store: ShellStore): Recipe[] => store.recipes();

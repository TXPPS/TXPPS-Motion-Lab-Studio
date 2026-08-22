import { useEffect } from 'react';
import { lazy, Suspense } from 'react';
import { useViewport } from './hooks/useViewport';
import { useGlobalKeyboard } from './hooks/useKeyboard';
import { useUiStore } from './state/uiStore';
import { PhoneNav } from './components/shell/PhoneLayout';
import { TopBar } from './components/shell/TopBar';
import { StatusBar } from './components/shell/StatusBar';
import { DiagnosticsSheet } from './components/diagnostics/DiagnosticsSheet';
import { DialogHost, ContextMenuHost, ToastHost } from './components/common/overlays';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { LayoutDebugHud } from './components/diagnostics/LayoutDebugHud';
import { dragHasFiles } from './app/importActions';
import { useProjectStore } from './state/projectStore';
import { useRouteStore, watchRoute } from './state/routeStore';
import { ShortcutsSheet } from './components/common/ShortcutsSheet';
import { WelcomeSheet, maybeShowWelcome } from './components/common/WelcomeSheet';
import { SettingsSheet } from './components/settings/SettingsSheet';

/**
 * Pages are code-split.
 *
 * Only the Song page is needed to start working, and it is what a returning
 * musician lands on; the mastering and live pages are large surfaces that most
 * sessions never open, so they are not in the boot bundle.
 */
const SongPage = lazy(() => import('./pages/SongPage'));
const StartPage = lazy(() => import('./pages/StartPage'));
const MasteringPage = lazy(() => import('./pages/MasteringPage'));
const ShowPage = lazy(() => import('./pages/ShowPage'));

function PageHost() {
  const page = useRouteStore((s) => s.route.page);
  return (
    <Suspense fallback={<div className="page-loading">Loading…</div>}>
      {page === 'start' ? (
        <StartPage />
      ) : page === 'mastering' ? (
        <MasteringPage />
      ) : page === 'show' ? (
        <ShowPage />
      ) : (
        <SongPage />
      )}
    </Suspense>
  );
}

/**
 * App shell. Exactly three grid rows: the project bar, the active layout, and
 * the bottom bar. The middle row is the only flexible one and owns all internal
 * scrolling — the document itself never scrolls.
 */
export function App() {
  const { layout } = useViewport();
  const page = useRouteStore((s) => s.route.page);
  useGlobalKeyboard();

  // One route parse drives both navigation and the QA/debug flags.
  useEffect(() => {
    const stop = watchRoute();
    maybeShowWelcome();
    const unsub = useRouteStore.subscribe((s) => {
      useUiStore.getState().set({
        forcedLayout: s.route.forcePhone ? 'phone' : null,
        debugOverlay: s.route.debugOverlay,
        ...(s.route.openDiagnostics ? { diagnosticsOpen: true } : {}),
      });
    });
    // Apply the boot route immediately as well: subscribe only fires on change.
    const r = useRouteStore.getState().route;
    useUiStore.getState().set({
      forcedLayout: r.forcePhone ? 'phone' : null,
      debugOverlay: r.debugOverlay,
      ...(r.openDiagnostics ? { diagnosticsOpen: true } : {}),
    });
    return () => {
      stop();
      unsub();
    };
  }, []);

  // Backstop for the undo system: whatever happens to the element that started
  // a drag, the gesture closes once the pointer is released. The timeout lets
  // the drag's own pointerup handler run first, so a normal drag still commits
  // through its own endGesture and this only catches the strays.
  useEffect(() => {
    const flush = () => {
      window.setTimeout(() => useProjectStore.getState().flushGestures(), 0);
    };
    window.addEventListener('pointerup', flush);
    window.addEventListener('pointercancel', flush);
    return () => {
      window.removeEventListener('pointerup', flush);
      window.removeEventListener('pointercancel', flush);
    };
  }, []);

  // A file dropped anywhere but a track lane would otherwise make the browser
  // navigate to it, discarding unsaved work. Swallow those drops instead.
  useEffect(() => {
    const swallow = (e: DragEvent) => {
      // A lane that accepted the drag already called preventDefault; leave its
      // dropEffect alone so the copy cursor survives the bubble to window.
      if (e.defaultPrevented || !dragHasFiles(e.dataTransfer)) return;
      if (e.type === 'dragover' && e.dataTransfer) e.dataTransfer.dropEffect = 'none';
      e.preventDefault();
    };
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  return (
    <div className="app" data-layout={layout} data-page={page} data-testid="app-root">
      <TopBar layout={layout} />
      <main className="app-body">
        <ErrorBoundary label="workspace">
          <PageHost />
        </ErrorBoundary>
      </main>
      {layout === 'phone' && page === 'song' ? <PhoneNav /> : <StatusBar />}
      <DiagnosticsSheet />
      <ShortcutsSheet />
      <WelcomeSheet />
      <SettingsSheet />
      <DialogHost />
      <ContextMenuHost />
      <ToastHost />
      <LayoutDebugHud />
    </div>
  );
}

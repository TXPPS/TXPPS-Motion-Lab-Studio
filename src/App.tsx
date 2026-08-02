import { useEffect } from 'react';
import { useViewport } from './hooks/useViewport';
import { useGlobalKeyboard } from './hooks/useKeyboard';
import { useUiStore } from './state/uiStore';
import { DesktopLayout } from './components/shell/DesktopLayout';
import { TabletLayout } from './components/shell/TabletLayout';
import { PhoneLayout, PhoneNav } from './components/shell/PhoneLayout';
import { TopBar } from './components/shell/TopBar';
import { StatusBar } from './components/shell/StatusBar';
import { DiagnosticsSheet } from './components/diagnostics/DiagnosticsSheet';
import { DialogHost, ContextMenuHost, ToastHost } from './components/common/overlays';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { LayoutDebugHud } from './components/diagnostics/LayoutDebugHud';
import { RecordingBanner } from './components/recording/RecordControls';
import { dragHasFiles } from './app/importActions';
import { ShortcutsSheet } from './components/common/ShortcutsSheet';

/**
 * App shell. Exactly three grid rows: the project bar, the active layout, and
 * the bottom bar. The middle row is the only flexible one and owns all internal
 * scrolling — the document itself never scrolls.
 */
export function App() {
  const { layout } = useViewport();
  useGlobalKeyboard();

  // Hash flags: #/phone forces the phone layout for QA, #/diagnostics opens the
  // panel, #/qa loads the layout stress fixture with the debug overlay.
  useEffect(() => {
    const apply = () => {
      const h = window.location.hash;
      useUiStore.getState().set({
        forcedLayout: h.includes('phone') ? 'phone' : null,
        debugOverlay: h.includes('qa') || h.includes('debug'),
        ...(h.includes('diagnostics') ? { diagnosticsOpen: true } : {}),
      });
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
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
    <div className="app" data-layout={layout} data-testid="app-root">
      <TopBar layout={layout} />
      <main className="app-body">
        {layout !== 'phone' && <RecordingBanner />}
        <ErrorBoundary label="workspace">
          {layout === 'desktop' ? (
            <DesktopLayout />
          ) : layout === 'tablet' ? (
            <TabletLayout />
          ) : (
            <PhoneLayout />
          )}
        </ErrorBoundary>
      </main>
      {layout === 'phone' ? <PhoneNav /> : <StatusBar />}
      <DiagnosticsSheet />
      <ShortcutsSheet />
      <DialogHost />
      <ContextMenuHost />
      <ToastHost />
      <LayoutDebugHud />
    </div>
  );
}

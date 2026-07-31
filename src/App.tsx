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

  return (
    <div className="app" data-layout={layout} data-testid="app-root">
      <TopBar layout={layout} />
      <div className="app-body">
        <ErrorBoundary label="workspace">
          {layout === 'desktop' ? (
            <DesktopLayout />
          ) : layout === 'tablet' ? (
            <TabletLayout />
          ) : (
            <PhoneLayout />
          )}
        </ErrorBoundary>
      </div>
      {layout === 'phone' ? <PhoneNav /> : <StatusBar />}
      <DiagnosticsSheet />
      <DialogHost />
      <ContextMenuHost />
      <ToastHost />
      <LayoutDebugHud />
    </div>
  );
}

import { useEffect } from 'react';
import { useViewport } from './hooks/useViewport';
import { useGlobalKeyboard } from './hooks/useKeyboard';
import { useUiStore } from './state/uiStore';
import { DesktopLayout } from './components/shell/DesktopLayout';
import { TabletLayout } from './components/shell/TabletLayout';
import { PhoneLayout } from './components/shell/PhoneLayout';
import { TopBar } from './components/shell/TopBar';
import { StatusBar } from './components/shell/StatusBar';
import { DiagnosticsSheet } from './components/diagnostics/DiagnosticsSheet';
import { DialogHost, ContextMenuHost, ToastHost } from './components/common/overlays';
import { ErrorBoundary } from './components/common/ErrorBoundary';

export function App() {
  const { layout } = useViewport();
  useGlobalKeyboard();

  // Route hash flags: #/phone forces the phone layout for QA; #/diagnostics opens the panel.
  useEffect(() => {
    const apply = () => {
      const h = window.location.hash;
      useUiStore.getState().set({
        forcedLayout: h.includes('phone') ? 'phone' : null,
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
      <ErrorBoundary label="workspace">
        {layout === 'desktop' ? (
          <DesktopLayout />
        ) : layout === 'tablet' ? (
          <TabletLayout />
        ) : (
          <PhoneLayout />
        )}
      </ErrorBoundary>
      {layout !== 'phone' && <StatusBar />}
      <DiagnosticsSheet />
      <DialogHost />
      <ContextMenuHost />
      <ToastHost />
    </div>
  );
}

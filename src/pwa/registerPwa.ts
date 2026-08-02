import { diagLog } from '../state/diagnostics';

/**
 * Registers the service worker (via vite-plugin-pwa's virtual module). Kept
 * isolated so tests and non-PWA builds don't pull in the virtual import.
 */
export function registerPwa(): void {
  if (typeof window === 'undefined') return;
  // Virtual module provided by vite-plugin-pwa at build/dev time.
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onOfflineReady() {
          diagLog('info', 'PWA: app shell cached — ready to work offline');
        },
        onRegisteredSW(swUrl) {
          diagLog('info', `PWA: service worker registered (${swUrl})`);
        },
        onRegisterError(err) {
          diagLog('warn', `PWA: service worker registration failed: ${String(err)}`);
        },
        onNeedRefresh() {
          // NEVER force-reload a running DAW session (it could interrupt a
          // recording or discard the autosave window). The new version is
          // cached and takes over on the next natural load.
          diagLog('info', 'PWA: new version cached — it loads next time the app opens');
          void import('../state/uiStore').then(({ useUiStore }) => {
            useUiStore
              .getState()
              .toast('info', 'Update ready — it will load next time you open the app.');
          });
        },
      });
    })
    .catch(() => {
      // Not available in dev without the plugin's dev option — non-fatal.
    });
}

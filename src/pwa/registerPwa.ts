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
      const updateSW = registerSW({
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
          diagLog('info', 'PWA: new version available — will update on next load');
          void updateSW(true);
        },
      });
    })
    .catch(() => {
      // Not available in dev without the plugin's dev option — non-fatal.
    });
}

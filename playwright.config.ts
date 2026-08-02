import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// The remote environment pre-installs Chromium at /opt/pw-browsers/chromium.
// Use it directly when present so no browser download is needed.
const preinstalledChromium = '/opt/pw-browsers/chromium';
const executablePath = existsSync(preinstalledChromium) ? preinstalledChromium : undefined;

// Set E2E_BASE_URL to run the suite against a deployed origin instead of the
// local preview build (e.g. the live Cloudflare deployment).
const externalBase = process.env.E2E_BASE_URL;

/**
 * Cross-engine runs: E2E_BROWSER=firefox|webkit runs the same suite on Gecko
 * or WebKit (when those Playwright browsers are installed). Engine-specific
 * capabilities are gated:
 * - clipboard permissions are a Chromium-only Playwright feature;
 * - Firefox gets fake-microphone prefs so recording tests still exercise the
 *   real pipeline;
 * - WebKit has no fake-capture story — capture specs skip themselves there.
 */
const engine = (process.env.E2E_BROWSER ?? 'chromium') as 'chromium' | 'firefox' | 'webkit';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    browserName: engine,
    baseURL: externalBase ?? 'http://localhost:4173',
    trace: 'retain-on-failure',
    ...(engine === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}),
    // External origins must go through the environment's egress proxy;
    // localhost runs bypass it.
    ...(externalBase && process.env.HTTPS_PROXY
      ? { proxy: { server: process.env.HTTPS_PROXY } }
      : {}),
    launchOptions:
      engine === 'chromium'
        ? {
            executablePath,
            args: ['--autoplay-policy=no-user-gesture-required'],
          }
        : engine === 'firefox'
          ? {
              firefoxUserPrefs: {
                'media.autoplay.default': 0,
                'media.autoplay.blocking_policy': 0,
                'media.navigator.streams.fake': true,
                'media.navigator.permission.disabled': true,
                'dom.events.asyncClipboard.readText': true,
                'dom.events.testing.asyncClipboard': true,
              },
            }
          : {},
  },
  webServer: externalBase
    ? undefined
    : {
        command: 'npm run preview',
        url: 'http://localhost:4173',
        reuseExistingServer: true,
        timeout: 30_000,
      },
});

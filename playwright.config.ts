import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// The remote environment pre-installs Chromium at /opt/pw-browsers/chromium.
// Use it directly when present so no browser download is needed.
const preinstalledChromium = '/opt/pw-browsers/chromium';
const executablePath = existsSync(preinstalledChromium) ? preinstalledChromium : undefined;

// Set E2E_BASE_URL to run the suite against a deployed origin instead of the
// local preview build (e.g. the live Cloudflare deployment).
const externalBase = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: externalBase ?? 'http://localhost:4173',
    trace: 'retain-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
    launchOptions: {
      executablePath,
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
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

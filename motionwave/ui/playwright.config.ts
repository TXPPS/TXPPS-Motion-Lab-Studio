/**
 * Motion Wave's browser suite.
 *
 * Separate from MotionLab's config because they are separate products with
 * separate servers, and because this one needs cross-origin isolation headers
 * that MotionLab's preview does not set. Sharing a config would mean one
 * product's server deciding the other product's security context.
 *
 * What runs here is only what genuinely needs a browser: Ledger cells U21 and
 * U22, which are claims about frame pacing and geometry. Everything a headless
 * runtime can judge stays in the vitest suite, because a browser test is slower
 * and flakier and buys nothing for a check that does not need one.
 */
import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const preinstalledChromium = '/opt/pw-browsers/chromium';
const executablePath = existsSync(preinstalledChromium) ? preinstalledChromium : undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4183',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath,
      // Autoplay policy: an AudioContext that never starts is an engine that
      // never runs, and the pacing measured against it would be a face drawing
      // silence at whatever rate it liked.
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'npx vite preview --config motionwave/ui/dev/vite.config.ts',
    url: 'http://localhost:4183/',
    reuseExistingServer: !process.env.CI,
    cwd: '../..',
    timeout: 60_000,
  },
});

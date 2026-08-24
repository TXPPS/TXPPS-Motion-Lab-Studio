/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

function gitCommit(): string {
  try {
    return execSync('git rev-parse --short=10 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'uncommitted';
  }
}

/**
 * The commit's own date, not the clock.
 *
 * `new Date()` made every build of the same source produce a different bundle,
 * because the timestamp is compiled in and the asset filename is a hash of the
 * content. So the deployed bundle's name could never be compared against a
 * local build of the deployed commit — the one check that tells you a push
 * actually became a deploy, and the check the directives ask for on every
 * release. Two builds of one commit now produce byte-identical output, and a
 * mismatch means something real.
 *
 * A working tree with uncommitted changes still gets the wall clock: there is
 * no commit to be reproducible *against*, and a dev build that pretended
 * otherwise would report a build time hours old.
 */
function buildTime(): string {
  try {
    // `--untracked-files=no`, and the reason is not tidiness.
    //
    // Vite writes a `vite.config.ts.timestamp-*.mjs` beside this file while it
    // loads it, so an untracked-aware status is *never* empty during a build:
    // the check below always saw a dirty tree and always fell back to the wall
    // clock, and the reproducibility this function exists for silently never
    // happened. The file is gitignored as well, but the flag is what makes this
    // independent of anyone remembering to keep that list current.
    //
    // Tracked modifications are the ones that matter here anyway: an untracked
    // file that changed the build would be a build nobody could reproduce from
    // the repository at all, which is a different and larger problem.
    const dirty = execSync('git status --porcelain --untracked-files=no', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (dirty) return new Date().toISOString();
    return new Date(
      execSync('git log -1 --format=%cI', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim(),
    ).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'TXPPS MotionLab Studio',
        short_name: 'MotionLab',
        description: 'Professional Music Production. Anywhere.',
        theme_color: '#11161c',
        background_color: '#0b0e12',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // The type is fetched from Google after first paint, so the precache
        // glob — which only sees built assets — never covers it. Without
        // these two rules the second visit offline falls back to the system
        // face, which works but is not what the first visit looked like.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/css2/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    __GIT_COMMIT__: JSON.stringify(gitCommit()),
    __BUILD_TIME__: JSON.stringify(buildTime()),
  },
  build: {
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        /**
         * Three long-lived chunks so a UI change does not invalidate the parts
         * that rarely move: the framework, the DSP maths, and the audio graph.
         * Everything else stays route- and editor-split.
         */
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
            return 'react';
          }
          if (
            id.includes('/src/audio/dsp/') ||
            id.includes('/src/model/fft') ||
            id.includes('/src/model/loudness') ||
            id.includes('/src/model/pitch') ||
            id.includes('/src/model/transients') ||
            id.includes('/src/audio/timestretch') ||
            id.includes('/src/audio/encode/')
          ) {
            return 'dsp';
          }
          if (id.includes('/src/audio/')) return 'engine';
          return undefined;
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts', 'tests/setup.tsx'],
    restoreMocks: true,
  },
});

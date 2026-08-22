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
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    __GIT_COMMIT__: JSON.stringify(gitCommit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
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

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Motion Wave's UI framework runs its own tests, separate from MotionLab
 * Studio's. The two products share a repository and nothing else (ADR-0003), so
 * they share no test configuration either: MotionLab's suite runs under jsdom
 * with its own setup files, and a framework that has to compile for a phone and
 * a WebAssembly sandbox should not be quietly acquiring a DOM to pass its tests.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dev-dist',
      'coverage',
      'playwright-report',
      'test-results',
      'node_modules',
      // Third-party plugin bundles, served verbatim. They are somebody else's
      // build output — linting or reformatting them would both be meaningless
      // and would break the `import.meta.url` asset resolution they rely on.
      'public/plugins',
      // Emscripten's generated module. Build output, not source — and it is
      // written for several environments at once, so it references `process`
      // and `URL` unguarded by design.
      'motionwave/wasm/dist/**',
      // Built by `npm run build:panel`, and the worklet copy `build.sh` drops
      // beside it. Both are outputs, not sources.
      'motionwave/ui/dev/dist/**',
      'motionwave/ui/dev/public/motionwave.worklet.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Build scripts and node-side configs run under Node.
    files: ['scripts/**/*.mjs', '*.config.{ts,js}', 'playwright.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // QA/audit scripts are Node programs that also contain browser code inside
    // page.evaluate() callbacks, so they legitimately reference both.
    files: ['scripts/audit-*.mjs', 'scripts/*-audit.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Audio worklets run in `AudioWorkletGlobalScope`, which is neither the
    // window nor a worker: it has no DOM, no timers and no fetch, and its own
    // globals are the two below. Linted rather than ignored, because a real
    // mistake in a processor is a mistake on the audio thread.
    files: ['public/worklets/*.js', 'motionwave/ui/dev/public/shaper_worklet.js'],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        sampleRate: 'readonly',
        currentTime: 'readonly',
        // Motion Wave's processor only: `addModule` evaluates the core's
        // classic build in this scope before the processor's own script, so the
        // factory is a global here and nowhere else.
        createMotionWaveCore: 'readonly',
      },
    },
  },
);

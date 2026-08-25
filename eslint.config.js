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
      // Built by `npm run build:panel`, and the copies
      // `scripts/sync-motionwave-assets.mjs` drops beside it. All outputs.
      //
      // The processor is linted at its *source*, `motionwave/ui/worklet/`, and
      // ignored at its two copies — a real mistake on the audio thread is worth
      // catching, and catching it three times in three identical files is not.
      'motionwave/ui/dev/dist/**',
      'motionwave/ui/dev/public/motionwave.worklet.js',
      'motionwave/ui/dev/public/unit_worklet.js',
      'public/worklets/motionwave.worklet.js',
      'public/worklets/unit_worklet.js',
      // Emscripten's own output, tracked so the app builds without a C++
      // toolchain. It is one line of minified glue declaring several hundred
      // wasm exports, and linting it reports every one of them as an unused
      // variable — 114 errors that say nothing about any code anybody wrote.
      // It arrived untracked by this list in a98dd5e and has been failing
      // `npm run lint` ever since.
      'motionwave/wasm/prebuilt/**',
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
    // Stress is named here too: it is the same shape of program.
    files: [
      'scripts/audit-*.mjs',
      'scripts/*-audit.mjs',
      'scripts/stress.mjs',
      'scripts/reachability.mjs',
      'scripts/soak.mjs',
      'scripts/soak/*.mjs',
    ],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Audio worklets run in `AudioWorkletGlobalScope`, which is neither the
    // window nor a worker: it has no DOM, no timers and no fetch, and its own
    // globals are the two below. Linted rather than ignored, because a real
    // mistake in a processor is a mistake on the audio thread.
    files: ['public/worklets/*.js', 'motionwave/ui/worklet/*.js'],
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

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
);

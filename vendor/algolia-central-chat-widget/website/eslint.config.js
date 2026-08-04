import {
  commonIgnores,
  complexityRules,
  qualityRules,
  typeAwareRules,
  js,
  tseslint,
  globals,
  sonarjs,
  prettierConfig,
} from '../eslint.config.base.js';

/**
 * The demo site is three different runtimes in one folder: browser ES modules
 * served straight out of `public/`, Node build scripts, and the Vite config.
 */
export default tseslint.config(
  {
    ignores: [
      ...commonIgnores,
      // Compiled widget bundles and vendored copies are not ours to lint.
      'public/widget-bundles/**',
      'public/vendor/**',
      '.vite/**',
    ],
  },

  js.configs.recommended,

  // ── Browser ES modules shipped as-is from public/ ───────────────────────────
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: { sonarjs },
    rules: {
      ...complexityRules,
      ...qualityRules,
    },
  },

  // ── The demo's context engine ───────────────────────────────────────────────
  {
    files: ['public/context/**/*.js'],
    rules: {
      // This module's running commentary is the point: it narrates persona
      // switches and concierge decisions so the demo can be debugged live from
      // the browser console. Every log here is prefixed `[context-engine]`.
      'no-console': 'off',
    },
  },

  // ── Node build scripts ──────────────────────────────────────────────────────
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { sonarjs },
    rules: {
      ...complexityRules,
      ...qualityRules,
      'no-console': 'off',
    },
  },

  // ── Vite config (type-aware) ────────────────────────────────────────────────
  {
    files: ['vite.config.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    plugins: { sonarjs },
    rules: {
      ...complexityRules,
      ...qualityRules,
      ...typeAwareRules,
      'no-console': 'off',
    },
  },

  prettierConfig,
);

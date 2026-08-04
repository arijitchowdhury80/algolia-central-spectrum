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
} from './eslint.config.base.js';

/**
 * Root project: the Node build/publish scripts, the dev watcher, and the
 * Playwright suite. Each sub-project owns its own `eslint.config.js`, so they
 * are ignored here to keep `npm run lint` at the root from linting them twice.
 */
export default tseslint.config(
  {
    ignores: [
      ...commonIgnores,
      'algolia-chat/**',
      'chat-central/**',
      'website/**',
      'playwright-report/**',
      'test-results/**',
      'blob-report/**',
      'scripts/agent-backups/**',
      'scripts/judge-agent-backups/**',
    ],
  },

  js.configs.recommended,

  // ── Node scripts and the dev watcher (plain ESM, no type information) ───────
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { sonarjs },
    rules: {
      ...complexityRules,
      ...qualityRules,
      // These are CLI tools whose output *is* the console.
      'no-console': 'off',
    },
  },

  // ── Playwright config and specs (type-aware) ────────────────────────────────
  {
    files: ['tests/**/*.ts', 'playwright.config.ts'],
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
      // A spec body is a linear arrange/act/assert script: length limits push
      // toward indirection that makes a failing test harder to read. Branch
      // complexity still applies, since a branchy test is a test with a bug.
      'max-lines-per-function': 'off',
      'max-statements': 'off',
      'max-lines': 'off',
      'sonarjs/no-identical-functions': 'off',
      'no-console': 'off',
      // describe > test > page.evaluate > callback is four deep before a spec
      // has done anything, so the default budget would flag correct code.
      'max-nested-callbacks': ['error', 4],

      // Everything returned by `page.evaluate` crosses a JSON boundary and
      // arrives as `any`. Satisfying these rules would mean a cast at every
      // call site, which asserts a shape without checking it — no more safe
      // than the `any`, just noisier. The promise rules below stay on: a
      // missing `await` is the classic Playwright flake.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },

  prettierConfig,
);

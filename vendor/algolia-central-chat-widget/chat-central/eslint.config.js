import { createBaseConfig, tseslint, globals } from '../eslint.config.base.js';

export default tseslint.config(
  ...createBaseConfig({
    tsconfigRootDir: import.meta.dirname,
    files: ['src/**/*.{ts,tsx}'],
    react: true,
    env: 'browser',
  }),

  // ── Vitest suites ───────────────────────────────────────────────────────────
  {
    files: ['src/**/__tests__/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'max-lines-per-function': 'off',
      'max-statements': 'off',
      'max-lines': 'off',
      'sonarjs/no-identical-functions': 'off',
      'no-console': 'off',
    },
  },

  // ── Vite / build config files (Node, no type-checking) ──────────────────────
  {
    files: ['*.config.{ts,js}'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);

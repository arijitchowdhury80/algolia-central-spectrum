import { createBaseConfig, tseslint, globals } from '../eslint.config.base.js';

export default tseslint.config(
  ...createBaseConfig({
    tsconfigRootDir: import.meta.dirname,
    files: ['src/**/*.{ts,tsx}'],
    react: true,
    env: 'browser',
    // Prebuilt bundles copied in for the demo host page.
    ignores: ['public/**'],
  }),

  // ── Vite / build config files (Node, no type-checking) ──────────────────────
  {
    files: ['*.config.{ts,js}', 'postcss.config.js'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);

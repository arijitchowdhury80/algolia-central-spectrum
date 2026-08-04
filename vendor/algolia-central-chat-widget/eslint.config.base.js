import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import sonarjs from 'eslint-plugin-sonarjs';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Shared ESLint configuration for every project in this repo.
 *
 * Sub-projects import this file directly, so the plugins above always resolve
 * from the repo-root `node_modules` regardless of which project ESLint runs in.
 */

/**
 * Complexity budget.
 *
 * `complexity: 8` sits below McCabe's classic limit of 10: past ~8 branches a
 * function needs enough test cases that splitting it is nearly always cheaper.
 * Cognitive complexity weighs *nesting* rather than raw branch count, so the
 * two together catch both "long flat switch" and "deeply nested conditionals".
 */
export const complexityRules = {
  complexity: ['error', 8],
  'sonarjs/cognitive-complexity': ['error', 15],
  'max-depth': ['error', 3],
  'max-nested-callbacks': ['error', 3],
  'max-params': ['error', 4],
  'max-statements': ['error', 25],
  'max-lines-per-function': [
    'error',
    { max: 100, skipBlankLines: true, skipComments: true, IIFEs: true },
  ],
  'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
  'sonarjs/no-identical-functions': 'error',
  'sonarjs/no-collapsible-if': 'error',
  'sonarjs/prefer-immediate-return': 'error',
  'sonarjs/no-nested-template-literals': 'error',
};

/** Correctness and readability rules applied to every project. */
export const qualityRules = {
  'no-else-return': 'error',
  'no-unneeded-ternary': 'error',
  'no-lonely-if': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-var': 'error',
  'prefer-const': 'error',
  'prefer-arrow-callback': 'error',
  'object-shorthand': ['error', 'properties'],
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  'no-duplicate-imports': 'error',
  'no-param-reassign': ['error', { props: false }],
};

/** Rules that only make sense once type information is available. */
export const typeAwareRules = {
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/consistent-type-imports': [
    'error',
    { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
  ],
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  '@typescript-eslint/await-thenable': 'error',
};

/** React rules, applied only by projects that opt in. */
export const reactRules = {
  ...reactPlugin.configs.recommended.rules,
  ...reactHooksPlugin.configs.recommended.rules,
  'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
  'react/react-in-jsx-scope': 'off',
  'react/prop-types': 'off',
};

/** Ignored in every project; extend per-project rather than replacing. */
export const commonIgnores = ['**/dist/**', '**/node_modules/**', '**/*.tsbuildinfo'];

/**
 * Build the shared config array for a project.
 *
 * @param {object} options
 * @param {string} options.tsconfigRootDir Directory holding the project's tsconfig; enables type-aware linting.
 * @param {string[]} [options.files] Globs for the project's type-aware source files.
 * @param {boolean} [options.react] Enable the React plugin set.
 * @param {'browser'|'node'} [options.env] Which set of globals the source files run against.
 * @param {string[]} [options.ignores] Extra ignore globs on top of {@link commonIgnores}.
 * @returns {import('typescript-eslint').ConfigArray}
 */
export function createBaseConfig({
  tsconfigRootDir,
  files = ['src/**/*.{ts,tsx}'],
  react = false,
  env = 'browser',
  ignores = [],
}) {
  return tseslint.config(
    { ignores: [...commonIgnores, ...ignores] },

    js.configs.recommended,

    {
      files,
      extends: [...tseslint.configs.recommendedTypeChecked],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
        globals: { ...globals[env] },
      },
      plugins: {
        sonarjs,
        ...(react
          ? {
              react: reactPlugin,
              'react-hooks': reactHooksPlugin,
              'react-refresh': reactRefreshPlugin,
            }
          : {}),
      },
      ...(react ? { settings: { react: { version: 'detect' } } } : {}),
      rules: {
        ...(react ? reactRules : {}),
        ...complexityRules,
        ...qualityRules,
        ...typeAwareRules,
      },
    },

    // Prettier last so it can switch off every formatting-related rule above.
    prettierConfig,
  );
}

export { js, tseslint, globals, sonarjs, prettierConfig };

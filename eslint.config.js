import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules', '202604_*']),
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-useless-escape': 'warn',
      'no-irregular-whitespace': 'warn',
      'no-misleading-character-class': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/static-components': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
  {
    files: ['functions/**/*.js', 'services/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.commonjs,
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-useless-escape': 'warn',
      'no-control-regex': 'warn',
      'preserve-caught-error': 'warn',
    },
  },
])

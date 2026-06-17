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
      // react-hooks/refs(v6 실험): 이벤트핸들러 팩토리 패턴을 렌더중 ref접근으로 오탐 → warn
      'react-hooks/refs': 'warn',
      // react-refresh: 컴포넌트+훅 동일파일 export는 개발모드 HMR 경고일 뿐(런타임 무관) → warn
      'react-refresh/only-export-components': 'warn',
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

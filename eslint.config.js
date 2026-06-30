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
      // lucide 아이콘이 전역 생성자(Map·Set·Image)와 같은 이름으로 들어오면 `new Map()`이 죽는다(V6.79.3).
      // 별칭(as) 없이 들여오는 경우만 차단 — `import { Map as MapIcon }`은 정상 통과.
      'no-restricted-syntax': ['error',
        { selector: "ImportDeclaration[source.value='lucide-react'] ImportSpecifier[imported.name='Map'][local.name='Map']", message: 'lucide `Map`이 전역 Map 생성자를 가립니다. 별칭으로: import { Map as MapIcon }' },
        { selector: "ImportDeclaration[source.value='lucide-react'] ImportSpecifier[imported.name='Image'][local.name='Image']", message: 'lucide `Image`가 전역 Image 생성자를 가립니다. 별칭으로: import { Image as ImageIcon }' },
        { selector: "ImportDeclaration[source.value='lucide-react'] ImportSpecifier[imported.name='Set'][local.name='Set']", message: 'lucide `Set`이 전역 Set 생성자를 가립니다. 별칭으로: import { Set as SetIcon }' },
      ],
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

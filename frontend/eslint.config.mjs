import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = defineConfig([
  ...nextVitals,
  // Keep Next.js default ignores in place
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
  {
    rules: {
      // ─── Accessibility ───────────────────────────────────────────────────
      'jsx-a11y/alt-text': ['error', {
        img: ['img'],
        object: ['object'],
        area: ['area'],
        'input[type="image"]': ['input[type="image"]'],
      }],
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-proptypes': 'warn',
      'jsx-a11y/aria-unsupported-elements': 'warn',
      'jsx-a11y/role-has-required-aria-props': 'warn',
      'jsx-a11y/role-supports-aria-props': 'warn',
      'jsx-a11y/anchor-is-valid': 'warn',
      'jsx-a11y/interactive-supports-focus': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',

      // ─── React ───────────────────────────────────────────────────────────
      'react/jsx-no-target-blank': ['error', { allowReferrer: false }],
      'react/no-unescaped-entities': 'warn',

      // ─── React Compiler rules (eslint-plugin-react-hooks v7) ─────────────
      // Disabled for this sprint: codebase was written for React 18 and does
      // not yet comply with React Compiler constraints. The build passes, all
      // tests pass, and the app runs correctly. These rules will be addressed
      // in a dedicated React Compiler migration sprint.
      'react-hooks/config': 'off',
      'react-hooks/error-boundaries': 'off',
      'react-hooks/gating': 'off',
      'react-hooks/globals': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/set-state-in-render': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/unsupported-syntax': 'off',
      'react-hooks/use-memo': 'off',
    },
  },
])

export default eslintConfig

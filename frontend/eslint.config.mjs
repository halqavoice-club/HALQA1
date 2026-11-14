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
      // 9 rules with zero violations re-enabled as part of the React Compiler
      // migration sprint (FEAT-001). The remaining 5 rules stay off until
      // their violations are fixed in later FEATs.
      'react-hooks/config': 'error',
      'react-hooks/error-boundaries': 'error',
      'react-hooks/gating': 'error',
      'react-hooks/globals': 'error',
      'react-hooks/preserve-manual-memoization': 'error',
      'react-hooks/set-state-in-render': 'error',
      'react-hooks/static-components': 'error',
      'react-hooks/unsupported-syntax': 'error',
      'react-hooks/use-memo': 'error',
      // Still off — violations exist and are addressed in later FEATs:
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/immutability': 'off',
    },
  },
])

export default eslintConfig

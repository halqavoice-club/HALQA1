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
      'react/jsx-no-target-blank': ['error', { allowReferrer: false }],
      'react/no-unescaped-entities': 'warn',
    },
  },
])

export default eslintConfig

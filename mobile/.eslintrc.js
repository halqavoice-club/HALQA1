module.exports = {
  root: true,
  extends: ['expo', 'eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    'react/react-in-jsx-scope': 'off',
  },
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
};

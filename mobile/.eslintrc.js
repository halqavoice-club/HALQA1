module.exports = {
  root: true,
  extends: ['expo', 'eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    'react/react-in-jsx-scope': 'off',
    // Downgrade to warn — large codebase has many unused imports that are
    // intentionally left in during active development
    'no-unused-vars': 'warn',
    'no-empty': 'warn',
    'no-undef': 'warn',
    // react-native-svg type stub exists but package not installed — suppress unresolved error
    'import/no-unresolved': ['warn', { ignore: ['react-native-svg', 'expo-performance'] }],
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

/**
 * Mobile Jest configuration
 *
 * Uses react-native's own preset instead of jest-expo.
 * jest-expo@48 calls Object.defineProperty on UIManager which is null in
 * React Native 0.81, crashing every test suite before any test runs.
 *
 * The three test files (auth, offline, backgroundSync) only mock
 * expo-secure-store, axios/api, and MMKV — they have no native UI tests
 * and don't need the full jest-expo native module setup.
 */
module.exports = {
  preset: 'react-native',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['./jest-setup.js'],
  transformIgnorePatterns: [
    // Transform these packages from ESM/native to CommonJS for Node.js
    'node_modules/(?!(react-native|@react-native|@react-navigation|expo|@expo|' +
    'react-native-gesture-handler|react-native-reanimated|expo-status-bar|' +
    'react-native-safe-area-context|react-native-screens|react-native-mmkv|' +
    'react-native-flash-message|expo-background-fetch|expo-task-manager|' +
    'expo-modules-core|expo-secure-store|expo-constants)/)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Mock native packages that crash in Node.js
    '^react-native-reanimated$':              '<rootDir>/__mocks__/react-native-reanimated.js',
    '^expo-secure-store$':                    '<rootDir>/__mocks__/expo-secure-store.js',
    '^react-native-mmkv$':                    '<rootDir>/__mocks__/react-native-mmkv.js',
    '^expo-background-fetch$':                '<rootDir>/__mocks__/expo-background-fetch.js',
    '^expo-task-manager$':                    '<rootDir>/__mocks__/expo-task-manager.js',
    '^@react-native-community/netinfo$':      '<rootDir>/__mocks__/@react-native-community/netinfo.js',
    '^react-native-flash-message$':           '<rootDir>/__mocks__/react-native-flash-message.js',
  },
  testMatch: [
    '**/__tests__/**/*.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)',
    '**/src/tests/**/*.test.[jt]s?(x)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/.expo/'],
  cacheDirectory: '.jest/cache',
};

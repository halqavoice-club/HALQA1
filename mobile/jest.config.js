module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['./jest-setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-navigation|@react-native|expo|@expo|react-native-gesture-handler|react-native-reanimated|expo-status-bar)/)'
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testPathIgnorePatterns: ['/node_modules/', '/.expo/'],
  cacheDirectory: '.jest/cache',
};

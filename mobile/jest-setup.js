// jest-setup.js — runs after the test framework is installed (setupFilesAfterEnv)

// Extend Jest matchers with react-native-specific matchers
try {
  require('@testing-library/jest-native/extend-expect');
} catch (e) {
  // Optional — only needed for component render tests
}

// Set up gesture handler mocks
try {
  require('react-native-gesture-handler/jestSetup');
} catch (e) {
  // Optional — only needed when gesture handler is used in tested components
}

// Silence Reanimated worklet init warning in test output
global.__reanimatedWorkletInit = () => {};

// Silence window.alert (used in some confirmation dialogs)
global.alert = jest.fn();
